import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { AtlasListOptions, AtlasMetadataPatch } from "@mains/contracts/atlas";
import { ATLAS_LIBRARY_PAGE_SIZE } from "@mains/contracts/atlas";
import { getDb } from "../../db/client";
import { atlasItems, atlasPageRevisions, atlasPageFileRefs, runs } from "../../db/schema";
import { mergeMetadata, readMetadata } from "./atlas.metadata";

export type AtlasRecord = typeof atlasItems.$inferSelect;
export type RevisionRecord = typeof atlasPageRevisions.$inferSelect;

export const atlasRepo = {
  list({ accountId, includePagePreview = false, kind, ids, trashed, collectionId,
    isFavorite, offset, limit }: AtlasListOptions) {
    // Read only a small excerpt, in the same query as the library. The indexed
    // item/version lookup excludes history and never loads full blocks JSON.
    const preview = includePagePreview
      ? sql<string | null>`substr(${atlasPageRevisions.markdown}, 1, 2400)`
      : sql<null>`NULL`;
    const query = getDb().select({ item: atlasItems, preview }).from(atlasItems).$dynamic();
    if (includePagePreview) query.leftJoin(atlasPageRevisions, and(
      eq(atlasPageRevisions.itemId, atlasItems.id),
      eq(atlasPageRevisions.id, atlasItems.currentRevisionId),
      eq(atlasItems.kind, "page"),
    ));
    const conditions = [eq(atlasItems.accountId, accountId)];
    if (kind) conditions.push(eq(atlasItems.kind, kind));
    if (ids) conditions.push(inArray(atlasItems.id, ids));
    if (trashed !== undefined) conditions.push(trashed ? isNotNull(atlasItems.trashedAt) : isNull(atlasItems.trashedAt));
    if (collectionId) conditions.push(eq(atlasItems.collectionId, collectionId));
    if (isFavorite !== undefined) conditions.push(eq(atlasItems.isFavorite, isFavorite));
    query.where(and(...conditions)).orderBy(desc(atlasItems.updatedAt), desc(atlasItems.id));
    if (offset !== undefined) query.offset(offset);
    if (limit !== undefined || offset !== undefined) query.limit(limit ?? ATLAS_LIBRARY_PAGE_SIZE);
    return query.all();
  },
  imageIdentities(accountId: string, collectionId?: string) {
    const conditions = [eq(atlasItems.accountId, accountId), eq(atlasItems.kind, "image"), isNull(atlasItems.trashedAt)];
    if (collectionId) conditions.push(eq(atlasItems.collectionId, collectionId));
    // Image identity is small; do not load storage paths, Page previews or the
    // rest of the account's inventory merely to prefer permanent copies.
    return getDb().select({ title: atlasItems.title, contentHash: atlasItems.contentHash })
      .from(atlasItems).where(and(...conditions)).all();
  },
  find(id: string, accountId: string) {
    return getDb().select().from(atlasItems)
      .where(and(eq(atlasItems.id, sql`coalesce((SELECT canonical_pk FROM bridge_aliases
        WHERE table_name='atlas_items' AND alias_pk=${id}),${id})`), eq(atlasItems.accountId, accountId))).get() ?? null;
  },
  bySource(accountId: string, sourceKey: string) {
    return getDb().select().from(atlasItems)
      .where(and(eq(atlasItems.accountId, accountId), eq(atlasItems.sourceKey, sourceKey))).get() ?? null;
  },
  byStorageKey(storageKey: string) {
    return getDb().select().from(atlasItems).where(eq(atlasItems.storageKey, storageKey)).get() ?? null;
  },
  hasFileManifest(id: string) {
    return !!getDb().get(sql`SELECT 1 FROM bridge_row_clock c, json_each(c.blob_refs_json) b
      WHERE c.table_name='atlas_items' AND (c.pk=${id} OR c.pk IN
        (SELECT alias_pk FROM bridge_aliases WHERE table_name='atlas_items' AND canonical_pk=${id})) AND c.register='content'
      AND json_extract(b.value,'$.column')='storage_key' LIMIT 1`);
  },
  insert(row: typeof atlasItems.$inferInsert) { getDb().insert(atlasItems).values(row).run(); },
  update(id: string, accountId: string, fields: Partial<typeof atlasItems.$inferInsert>, metadata?: AtlasMetadataPatch | null) {
    const db = getDb();
    db.transaction(() => {
      const next = { ...fields, updatedAt: new Date() };
      if (metadata !== undefined) {
        const item = atlasRepo.find(id, accountId);
        if (!item || item.kind !== "page" || item.trashedAt) throw new Error("Page unavailable");
        // Merge against the latest row, independently of Page content/version.
        next.metadata = mergeMetadata(item.metadata, metadata);
        const coverId = readMetadata(next.metadata)?.coverFileId;
        if (metadata?.coverFileId && coverId) {
          const cover = atlasRepo.find(coverId, accountId);
          if (!cover || cover.kind !== "image" || !cover.storageKey || cover.trashedAt)
            throw new Error("Page cover image is unavailable");
        }
      }
      db.update(atlasItems).set(next)
        .where(and(eq(atlasItems.id, id), eq(atlasItems.accountId, accountId))).run();
    });
  },
  /** Newest first. Summaries only, so a deep window stays cheap; history reads the recent part of it. */
  revisions(itemId: string, limit = 1000) {
    const r = atlasPageRevisions;
    return getDb().select({ id: r.id, itemId: r.itemId, title: r.title, version: r.version,
      schemaVersion: r.schemaVersion, actor: r.actor, sourceRunId: r.sourceRunId, createdAt: r.createdAt,
      parentRevisionId: r.parentRevisionId, mergedRevisionId: r.mergedRevisionId })
      .from(r).where(eq(r.itemId, itemId)).orderBy(desc(r.version)).limit(limit).all();
  },
  revision(itemId: string, version: number) {
    return getDb().select().from(atlasPageRevisions)
      .where(and(eq(atlasPageRevisions.itemId, itemId), eq(atlasPageRevisions.version, version))).get() ?? null;
  },
  revisionById(itemId: string, id: string) {
    return getDb().select().from(atlasPageRevisions)
      .where(and(eq(atlasPageRevisions.itemId, itemId), eq(atlasPageRevisions.id, id))).get() ?? null;
  },
  provenance(id: string) {
    return (getDb().get<{ backendId: string | null; backendLabel: string | null }>(sql`SELECT c.origin AS backendId, p.label AS backendLabel FROM bridge_row_clock c
      LEFT JOIN bridge_peers p ON p.backend_id=c.origin
      WHERE c.table_name='atlas_page_revisions' AND c.pk=${id} AND c.register='row'`)
      ?? { backendId: null, backendLabel: null }) as { backendId: string | null; backendLabel: string | null };
  },
  conflicts(itemId: string, currentId: string) {
    const r = atlasPageRevisions;
    return getDb().select().from(r).where(and(eq(r.itemId, itemId), sql`${r.id} <> ${currentId}`,
      sql`NOT EXISTS (SELECT 1 FROM atlas_page_revisions child WHERE child.item_id = ${itemId}
        AND (child.parent_revision_id = ${r.id} OR child.merged_revision_id = ${r.id}))`))
      .orderBy(desc(r.createdAt), desc(r.id)).all();
  },
  /** A Bridge clock means the hub or another backend may already hold this revision, so it is frozen. */
  replicated(revisionId: string) {
    return !!getDb().get(sql`SELECT 1 FROM bridge_row_clock WHERE table_name='atlas_page_revisions' AND pk=${revisionId} LIMIT 1`);
  },
  anyReplicated(itemId: string) {
    return !!getDb().get(sql`SELECT 1 FROM atlas_page_revisions r JOIN bridge_row_clock c
      ON c.table_name='atlas_page_revisions' AND c.pk=r.id WHERE r.item_id=${itemId} LIMIT 1`);
  },
  hasChildren(itemId: string, revisionId: string) {
    return !!getDb().get(sql`SELECT 1 FROM atlas_page_revisions WHERE item_id=${itemId}
      AND (parent_revision_id=${revisionId} OR merged_revision_id=${revisionId}) LIMIT 1`);
  },
  /**
   * `coalesce` lets the save rewrite the current revision in place instead of adding one, when nothing else
   * can depend on it: it is a leaf and has never been replicated. It still takes a new ordinal, so the
   * Page version keeps detecting concurrent writers.
   */
  commitPage(item: typeof atlasItems.$inferInsert, revision: typeof atlasPageRevisions.$inferInsert,
    expectedVersion: number, fileIds: string[], create = false, metadata?: AtlasMetadataPatch | null, coalesce = false) {
    const db = getDb();
    db.transaction(() => {
      const current = create ? null : atlasRepo.find(item.id, item.accountId);
      if (!create && (!current || current.version !== expectedVersion || current.trashedAt))
        throw new Error("This page changed elsewhere. Reload the latest version before saving.");
      if (revision.mergedRevisionId && (!current?.currentRevisionId ||
        !atlasRepo.conflicts(item.id, current.currentRevisionId).some((leaf) => leaf.id === revision.mergedRevisionId)))
        throw new Error("This conflict changed elsewhere. Reload the latest version before resolving.");
      // Ordinals belong to this database. A losing branch can have a larger one
      // than the current pointer, so current.version + 1 is not a free slot.
      const ordinal = db.select({ value: sql<number>`coalesce(max(${atlasPageRevisions.version}),0)+1` })
        .from(atlasPageRevisions).where(eq(atlasPageRevisions.itemId, item.id)).get()!.value;
      const head = coalesce && current?.currentRevisionId ? current.currentRevisionId : null;
      const rewrite = !!head && !atlasRepo.replicated(head) && !atlasRepo.hasChildren(item.id, head);
      const revisionId = rewrite ? head! : revision.id!;
      if (create) db.insert(atlasItems).values({ ...item, currentRevisionId: null, version: 0 }).run();
      if (rewrite) db.update(atlasPageRevisions).set({ title: revision.title, blocksJson: revision.blocksJson,
        markdown: revision.markdown, sourceRunId: revision.sourceRunId, version: ordinal })
        .where(and(eq(atlasPageRevisions.id, revisionId), eq(atlasPageRevisions.itemId, item.id))).run();
      else db.insert(atlasPageRevisions).values({ ...revision, version: ordinal,
        parentRevisionId: current?.currentRevisionId ?? null }).run();
      {
        const updated = db.update(atlasItems).set({ title: item.title, currentRevisionId: revisionId,
          version: ordinal, updatedAt: new Date() })
          .where(and(eq(atlasItems.id, item.id), eq(atlasItems.accountId, item.accountId),
            eq(atlasItems.version, create ? 0 : expectedVersion), sql`${atlasItems.trashedAt} IS NULL`)).run();
        if (!updated.changes) throw new Error("This page changed elsewhere. Reload the latest version before saving.");
      }
      // A rewritten head only adds references: a file dropped meanwhile stays protected until the revision goes.
      if (fileIds.length) db.insert(atlasPageFileRefs)
        .values([...new Set(fileIds.map((fileId) => {
          const file = atlasRepo.find(fileId, item.accountId);
          if (!file || file.kind === "page") throw new Error("Embedded Atlas file unavailable");
          return file.id;
        }))].map((fileId) => ({ revisionId, fileId }))).onConflictDoNothing().run();
      // A failed presentation write must roll back the revision and version too.
      if (metadata !== undefined) atlasRepo.update(item.id, item.accountId, {}, metadata);
    });
  },
  /**
   * Delete revisions, first pointing each surviving one at its nearest surviving ancestor. Without that a
   * survivor whose only children were deleted would read as an unresolved conflict branch.
   */
  prune(itemId: string, drop: string[], relink: { id: string; parentRevisionId: string | null; mergedRevisionId: string | null }[]) {
    const db = getDb();
    db.transaction(() => {
      // Replicated revisions cannot be changed or removed locally: other backends may build on them.
      if (atlasRepo.anyReplicated(itemId)) return;
      for (const { id, ...links } of relink)
        db.update(atlasPageRevisions).set(links).where(and(eq(atlasPageRevisions.id, id), eq(atlasPageRevisions.itemId, itemId))).run();
      for (let start = 0; start < drop.length; start += 500)
        db.delete(atlasPageRevisions).where(and(eq(atlasPageRevisions.itemId, itemId),
          inArray(atlasPageRevisions.id, drop.slice(start, start + 500)))).run();
    });
  },
  referenced(id: string) {
    const db = getDb();
    return !!db.select().from(atlasPageFileRefs).where(eq(atlasPageFileRefs.fileId, id)).limit(1).get()
      || !!db.select({ id: atlasItems.id }).from(atlasItems)
        .where(and(eq(atlasItems.kind, "page"), sql`json_extract(${atlasItems.metadata}, '$.coverFileId') IN
          (SELECT ${id} UNION SELECT alias_pk FROM bridge_aliases WHERE table_name='atlas_items' AND canonical_pk=${id})`)).limit(1).get();
  },
  remove(id: string, accountId: string) {
    const db = getDb();
    db.transaction(() => {
      // Current covers (including trashed Pages) and historical embeds survive
      // until their references are removed. Share the lock with metadata writes.
      if (atlasRepo.referenced(id)) throw new Error("This file is used by a Page or its revision history");
      db.delete(atlasItems).where(and(eq(atlasItems.id, id), eq(atlasItems.accountId, accountId))).run();
    });
  },
  generatedRuns(accountId: string, offset: number, limit: number, collectionId?: string) {
    const conditions = [eq(runs.accountId, accountId)];
    if (collectionId) conditions.push(eq(runs.collectionId, collectionId));
    return getDb().select({ id: runs.id, title: runs.title, collectionId: runs.collectionId, mode: runs.mode })
      .from(runs).where(and(...conditions)).orderBy(desc(runs.createdAt), desc(runs.id))
      .offset(offset).limit(limit).all();
  },

};
