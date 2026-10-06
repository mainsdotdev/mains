import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { AtlasMetadataPatch } from "@mains/contracts/atlas";
import { getDb } from "../../db/client";
import { atlasItems, atlasPageRevisions, atlasPageFileRefs, runs, runArtifacts } from "../../db/schema";
import { mergeMetadata, readMetadata } from "./atlas.metadata";

export type AtlasRecord = typeof atlasItems.$inferSelect;
export type RevisionRecord = typeof atlasPageRevisions.$inferSelect;

export const atlasRepo = {
  list(accountId: string, includePagePreview = false) {
    // Read only a small excerpt, in the same query as the library. The indexed
    // item/version lookup excludes history and never loads full blocks JSON.
    const preview = includePagePreview
      ? sql<string | null>`substr(${atlasPageRevisions.markdown}, 1, 2400)`
      : sql<null>`NULL`;
    const query = getDb().select({ item: atlasItems, preview }).from(atlasItems).$dynamic();
    if (includePagePreview) query.leftJoin(atlasPageRevisions, and(
      eq(atlasPageRevisions.itemId, atlasItems.id),
      eq(atlasPageRevisions.version, atlasItems.version),
      eq(atlasItems.kind, "page"),
    ));
    return query.where(eq(atlasItems.accountId, accountId))
      .orderBy(desc(atlasItems.updatedAt)).all();
  },
  find(id: string, accountId: string) {
    return getDb().select().from(atlasItems)
      .where(and(eq(atlasItems.id, id), eq(atlasItems.accountId, accountId))).get() ?? null;
  },
  bySource(accountId: string, sourceKey: string) {
    return getDb().select().from(atlasItems)
      .where(and(eq(atlasItems.accountId, accountId), eq(atlasItems.sourceKey, sourceKey))).get() ?? null;
  },
  byStorageKey(storageKey: string) {
    return getDb().select().from(atlasItems).where(eq(atlasItems.storageKey, storageKey)).get() ?? null;
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
  revisions(itemId: string) {
    const r = atlasPageRevisions;
    return getDb().select({ id: r.id, itemId: r.itemId, title: r.title, version: r.version,
      schemaVersion: r.schemaVersion, actor: r.actor, sourceRunId: r.sourceRunId, createdAt: r.createdAt })
      .from(r).where(eq(r.itemId, itemId)).orderBy(desc(r.version)).limit(100).all();
  },
  revision(itemId: string, version: number) {
    return getDb().select().from(atlasPageRevisions)
      .where(and(eq(atlasPageRevisions.itemId, itemId), eq(atlasPageRevisions.version, version))).get() ?? null;
  },
  commitPage(item: typeof atlasItems.$inferInsert, revision: typeof atlasPageRevisions.$inferInsert,
    expectedVersion: number, fileIds: string[], create = false) {
    const db = getDb();
    db.transaction(() => {
      if (create) db.insert(atlasItems).values(item).run();
      else {
        const updated = db.update(atlasItems).set({ title: item.title, version: revision.version, updatedAt: new Date() })
          .where(and(eq(atlasItems.id, item.id), eq(atlasItems.accountId, item.accountId),
            eq(atlasItems.version, expectedVersion), sql`${atlasItems.trashedAt} IS NULL`)).run();
        if (!updated.changes) throw new Error("This page changed elsewhere. Reload the latest version before saving.");
      }
      db.insert(atlasPageRevisions).values(revision).run();
      if (fileIds.length) db.insert(atlasPageFileRefs)
        .values(fileIds.map((fileId) => ({ revisionId: revision.id!, fileId }))).run();
    });
  },
  referenced(id: string) {
    const db = getDb();
    return !!db.select().from(atlasPageFileRefs).where(eq(atlasPageFileRefs.fileId, id)).limit(1).get()
      || !!db.select({ id: atlasItems.id }).from(atlasItems)
        .where(and(eq(atlasItems.kind, "page"), sql`json_extract(${atlasItems.metadata}, '$.coverFileId') = ${id}`)).limit(1).get();
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
  generatedArtifacts(runId: string) {
    return getDb().select({ path: runArtifacts.path, metadata: runArtifacts.metadata })
      .from(runArtifacts).where(and(eq(runArtifacts.runId, runId),
        inArray(runArtifacts.kind, ["file", "document", "image"]))).all();
  },
};
