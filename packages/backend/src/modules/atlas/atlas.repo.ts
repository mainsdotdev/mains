import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { AtlasListOptions, AtlasMetadataPatch, AtlasItemTag, AtlasTag } from "@mains/contracts/atlas";
import { ATLAS_LIBRARY_PAGE_SIZE } from "@mains/contracts/atlas";
import { getDb } from "../../db/client";
import { atlasItems, atlasPageRevisions, atlasPageFileRefs, atlasTags, atlasItemTags, runs } from "../../db/schema";
import { mergeMetadata, readMetadata } from "./atlas.metadata";

export type AtlasRecord = typeof atlasItems.$inferSelect;
export type RevisionRecord = typeof atlasPageRevisions.$inferSelect;

export const atlasRepo = {
  saveBookmark(id: string, accountId: string, fields: Partial<AtlasRecord> & { title: string }, tags?: string[]) {
    getDb().transaction(() => {
      if (atlasRepo.find(id, accountId)) atlasRepo.update(id, accountId, fields);
      else atlasRepo.insert({ id, accountId, kind: "bookmark", ...fields });
      if (tags) atlasRepo.setTags(id, accountId, tags, "user");
    });
  },
  classifyBookmark(id: string, accountId: string, tags: string[], metadata: string, bookmarkJob: string) {
    getDb().transaction(() => {
      atlasRepo.setTags(id, accountId, tags, "ai");
      atlasRepo.update(id, accountId, { metadata, bookmarkJob });
    });
  },
  itemTags(ids: string[], accountId: string): Map<string, AtlasItemTag[]> {
    const result = new Map<string, AtlasItemTag[]>();
    if (!ids.length) return result;
    const rows = getDb().select({ itemId: atlasItemTags.itemId, id: atlasTags.id, name: atlasTags.name, source: atlasItemTags.source })
      .from(atlasItemTags).innerJoin(atlasTags, eq(atlasTags.id, atlasItemTags.tagId))
      .innerJoin(atlasItems, eq(atlasItems.id, atlasItemTags.itemId))
      .where(and(inArray(atlasItemTags.itemId, ids), eq(atlasTags.accountId, accountId), eq(atlasItems.accountId, accountId),
        eq(atlasItemTags.isExcluded, false))).orderBy(atlasTags.normalizedName).all();
    for (const { itemId, ...tag } of rows) result.set(itemId, [...(result.get(itemId) ?? []), tag]);
    return result;
  },
  listTags(accountId: string, options?: { query: string; offset: number; limit: number }): AtlasTag[] {
    const query = getDb().select({ id: atlasTags.id, name: atlasTags.name,
      count: sql<number>`count(CASE WHEN ${atlasItems.trashedAt} IS NULL AND ${atlasItemTags.isExcluded}=0 THEN ${atlasItems.id} END)` })
      .from(atlasTags).leftJoin(atlasItemTags, eq(atlasTags.id, atlasItemTags.tagId))
      .leftJoin(atlasItems, and(eq(atlasItems.id, atlasItemTags.itemId), eq(atlasItems.accountId, accountId)))
      .where(and(eq(atlasTags.accountId, accountId), options?.query ? sql`instr(${atlasTags.normalizedName}, ${options.query}) > 0` : undefined))
      .groupBy(atlasTags.id).orderBy(atlasTags.normalizedName, atlasTags.id).$dynamic();
    if (options) query.offset(options.offset).limit(options.limit);
    return query.all();
  },
  /** Names and ids both resolve within this account. User removal records an
   * exclusion, so another enrichment cannot resurrect that relationship. */
  setTags(itemId: string, accountId: string, inputs: string[], source: "user" | "ai") {
    const db = getDb();
    db.transaction(() => {
      const item = atlasRepo.find(itemId, accountId);
      if (!item || item.trashedAt) throw new Error("Atlas item unavailable");
      const ids = inputs.map((input) => {
        const byId = db.select().from(atlasTags).where(eq(atlasTags.id, input)).get();
        if (byId && byId.accountId !== accountId) throw new Error("Tag belongs to a different account");
        const normalized = input.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
        const tag = db.select().from(atlasTags).where(and(eq(atlasTags.accountId, accountId),
          sql`(${atlasTags.id}=${input} OR ${atlasTags.normalizedName}=${normalized})`)).get();
        if (tag) return tag.id;
        const id = randomUUID();
        db.insert(atlasTags).values({ id, accountId, name: input.trim().replace(/\s+/g, " "), normalizedName: normalized }).run();
        return id;
      });
      if (source === "user") {
        const previous = db.select().from(atlasItemTags).where(eq(atlasItemTags.itemId, item.id)).all();
        for (const tag of previous) if (!ids.includes(tag.tagId)) db.update(atlasItemTags).set({ isExcluded: true })
          .where(and(eq(atlasItemTags.itemId, item.id), eq(atlasItemTags.tagId, tag.tagId))).run();
      } else {
        // Replace stale AI classifications while keeping authored tags and
        // explicit user exclusions independent of the latest model response.
        const previous = db.select().from(atlasItemTags).where(and(eq(atlasItemTags.itemId, item.id),
          eq(atlasItemTags.source, "ai"), eq(atlasItemTags.isExcluded, false))).all();
        for (const tag of previous) if (!ids.includes(tag.tagId)) db.delete(atlasItemTags)
          .where(and(eq(atlasItemTags.itemId, item.id), eq(atlasItemTags.tagId, tag.tagId))).run();
      }
      for (const tagId of new Set(ids)) {
        const old = db.select().from(atlasItemTags).where(and(eq(atlasItemTags.itemId, item.id), eq(atlasItemTags.tagId, tagId))).get();
        if (old && source === "ai") continue; // Preserve user provenance and exclusions.
        db.insert(atlasItemTags).values({ itemId: item.id, tagId, source, isExcluded: false })
          .onConflictDoUpdate({ target: [atlasItemTags.itemId, atlasItemTags.tagId], set: { source: old && !old.isExcluded ? old.source : source, isExcluded: false } }).run();
      }
      atlasRepo.update(item.id, accountId, {});
    });
  },
  renameTag(id: string, accountId: string, name: string) {
    const db = getDb(), normalizedName = name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
    const tag = db.select().from(atlasTags).where(and(eq(atlasTags.id, id), eq(atlasTags.accountId, accountId))).get();
    if (!tag) throw new Error("Tag not found");
    const same = db.select().from(atlasTags).where(and(eq(atlasTags.accountId, accountId), eq(atlasTags.normalizedName, normalizedName))).get();
    if (same && same.id !== id) throw new Error("A tag with this name already exists");
    db.update(atlasTags).set({ name: name.trim(), normalizedName }).where(eq(atlasTags.id, id)).run();
  },
  removeTag(id: string, accountId: string) {
    const result = getDb().delete(atlasTags).where(and(eq(atlasTags.id, id), eq(atlasTags.accountId, accountId))).run();
    if (!result.changes) throw new Error("Tag not found");
  },
  hasTag(itemId: string, tagId: string) {
    return !!getDb().select().from(atlasItemTags).where(and(eq(atlasItemTags.itemId, itemId),
      eq(atlasItemTags.tagId, tagId), eq(atlasItemTags.isExcluded, false))).get();
  },
  pendingBookmarks(offset = 0) {
    return getDb().select().from(atlasItems).where(and(eq(atlasItems.kind, "bookmark"), isNull(atlasItems.trashedAt),
      sql`CASE WHEN json_valid(${atlasItems.bookmarkJob}) THEN
        json_extract(${atlasItems.bookmarkJob}, '$.status') IN ('pending','running')
        AND json_extract(${atlasItems.bookmarkJob}, '$.nextAt') <= ${Date.now()} ELSE 0 END`))
      .orderBy(atlasItems.updatedAt, atlasItems.id).limit(50).offset(offset).all();
  },
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
    query.where(and(...conditions)).orderBy(...(trashed === true
      ? [desc(atlasItems.trashedAt), desc(atlasItems.updatedAt), desc(atlasItems.id)]
      : [desc(atlasItems.updatedAt), desc(atlasItems.id)]));
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
      const canonical = atlasRepo.find(id, accountId)?.id ?? id;
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
        .where(and(eq(atlasItems.id, canonical), eq(atlasItems.accountId, accountId))).run();
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
      const embedded = [...new Set(fileIds.map((fileId) => {
        const file = atlasRepo.find(fileId, item.accountId);
        if (!file || file.kind === "page") throw new Error("Embedded Atlas file unavailable");
        return file.id;
      }))];
      // A rewritten head is the only copy of this session, so its file list matches the page now.
      // A new revision only adds its own references and leaves earlier revisions untouched.
      if (rewrite) db.delete(atlasPageFileRefs).where(eq(atlasPageFileRefs.revisionId, revisionId)).run();
      if (embedded.length) db.insert(atlasPageFileRefs)
        .values(embedded.map((fileId) => ({ revisionId, fileId }))).onConflictDoNothing().run();
      // A failed presentation write must roll back the revision and version too.
      if (metadata !== undefined) atlasRepo.update(item.id, item.accountId, {}, metadata);
    });
  },
  /**
   * Delete revisions. A local page is relinked first, so a survivor whose children were removed does not
   * read as an unresolved conflict. A replicated page only accepts a prefix (`relink` empty): published
   * rows cannot be rewired, and the database nulls the one parent pointer the prefix was holding.
   */
  prune(itemId: string, drop: string[], relink: { id: string; parentRevisionId: string | null; mergedRevisionId: string | null }[]) {
    const db = getDb();
    db.transaction(() => {
      if (atlasRepo.anyReplicated(itemId) && relink.length) return;
      for (const { id, ...links } of relink)
        db.update(atlasPageRevisions).set(links).where(and(eq(atlasPageRevisions.id, id), eq(atlasPageRevisions.itemId, itemId))).run();
      for (let start = 0; start < drop.length; start += 500)
        db.delete(atlasPageRevisions).where(and(eq(atlasPageRevisions.itemId, itemId),
          inArray(atlasPageRevisions.id, drop.slice(start, start + 500)))).run();
      // The first publication of a survivor must not name a parent this delete just removed.
      // A row that has already been acknowledged is left alone: the receiver drops that parent itself.
      db.run(sql`UPDATE bridge_row_clock SET values_json=json_set(values_json,
        '$.parent_revision_id', (SELECT parent_revision_id FROM atlas_page_revisions WHERE id=bridge_row_clock.pk),
        '$.merged_revision_id', (SELECT merged_revision_id FROM atlas_page_revisions WHERE id=bridge_row_clock.pk))
        WHERE table_name='atlas_page_revisions' AND register='row' AND dirty=1 AND synced_seq IS NULL
          AND pk IN (SELECT id FROM atlas_page_revisions WHERE item_id=${itemId})`);
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
    // Only Work conversations feed Atlas automatically. Explicit saves resolve their run directly.
    const conditions = [eq(runs.accountId, accountId), eq(runs.mode, "work")];
    if (collectionId) conditions.push(eq(runs.collectionId, collectionId));
    return getDb().select({ id: runs.id, title: runs.title, collectionId: runs.collectionId, mode: runs.mode })
      .from(runs).where(and(...conditions)).orderBy(desc(runs.createdAt), desc(runs.id))
      .offset(offset).limit(limit).all();
  },

};
