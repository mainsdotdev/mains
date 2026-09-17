import { and, asc, desc, eq, max, sql } from "drizzle-orm";
import { getDb } from "../../db/client";
import { collectionSources, collections } from "../../db/schema";
import type {
  CollectionSourceRecord,
  CollectionSourceResponse,
  CollectionResponse,
  CreateCollectionPayload,
  ListCollectionsOptions,
  UpdateCollectionPayload,
} from "./collections.dto";
import {
  formatCollectionResponse,
  formatCollectionSourceResponse,
} from "./collections.dto";

export const collectionsRepo = {
  async list(options: ListCollectionsOptions): Promise<CollectionResponse[]> {
    const db = getDb();
    const conditions = [eq(collections.accountId, options.accountId)];
    if (!options.includeArchived) {
      conditions.push(eq(collections.isArchived, false));
    }
    const rows = await db
      .select()
      .from(collections)
      .where(and(...conditions))
      .orderBy(asc(collections.sortOrder), asc(collections.name));
    return rows.map(formatCollectionResponse);
  },

  async findById(id: string): Promise<CollectionResponse | null> {
    const db = getDb();
    const [row] = await db
      .select()
      .from(collections)
      .where(eq(collections.id, id))
      .limit(1);
    return row ? formatCollectionResponse(row) : null;
  },

  async insert(
    payload: CreateCollectionPayload & { id: string },
  ): Promise<void> {
    const db = getDb();
    const [row] = await db
      .select({ maxSortOrder: max(collections.sortOrder) })
      .from(collections)
      .where(eq(collections.accountId, payload.accountId));
    await db.insert(collections).values({
      id: payload.id,
      accountId: payload.accountId,
      name: payload.name,
      icon: payload.icon,
      sortOrder: (row?.maxSortOrder ?? -1) + 1,
    });
  },

  reorder(accountId: string, orderedIds: string[]): void {
    const db = getDb();
    db.transaction(() => {
      orderedIds.forEach((id, sortOrder) => {
        db.update(collections)
          .set({ sortOrder })
          .where(
            and(
              eq(collections.id, id),
              eq(collections.accountId, accountId),
            ),
          )
          .run();
      });
    });
  },

  async update(
    id: string,
    accountId: string,
    payload: UpdateCollectionPayload,
  ): Promise<CollectionResponse | null> {
    const db = getDb();
    const [row] = await db
      .update(collections)
      .set({ ...payload, updatedAt: sql`(unixepoch())` })
      .where(
        and(eq(collections.id, id), eq(collections.accountId, accountId)),
      )
      .returning();
    return row ? formatCollectionResponse(row) : null;
  },

  async setArchived(
    id: string,
    accountId: string,
    isArchived: boolean,
  ): Promise<CollectionResponse | null> {
    const db = getDb();
    const restoredSortOrder = isArchived
      ? undefined
      : (
          await db
            .select({ maxSortOrder: max(collections.sortOrder) })
            .from(collections)
            .where(eq(collections.accountId, accountId))
        )[0]?.maxSortOrder;
    const [row] = await db
      .update(collections)
      .set({
        isArchived,
        ...(isArchived
          ? {}
          : { sortOrder: (restoredSortOrder ?? -1) + 1 }),
        updatedAt: sql`(unixepoch())`,
      })
      .where(
        and(eq(collections.id, id), eq(collections.accountId, accountId)),
      )
      .returning();
    return row ? formatCollectionResponse(row) : null;
  },

  async remove(id: string, accountId: string): Promise<boolean> {
    const db = getDb();
    const deleted = await db
      .delete(collections)
      .where(
        and(eq(collections.id, id), eq(collections.accountId, accountId)),
      )
      .returning({ id: collections.id });
    return deleted.length > 0;
  },

  async listSources(collectionId: string): Promise<CollectionSourceResponse[]> {
    const rows = await this.listSourceRecords(collectionId);
    return rows.map(formatCollectionSourceResponse);
  },

  async listSourceRecords(collectionId: string): Promise<CollectionSourceRecord[]> {
    const db = getDb();
    return db
      .select()
      .from(collectionSources)
      .where(eq(collectionSources.collectionId, collectionId))
      .orderBy(desc(collectionSources.createdAt));
  },

  async findSourceById(id: string): Promise<CollectionSourceRecord | null> {
    const db = getDb();
    const [row] = await db
      .select()
      .from(collectionSources)
      .where(eq(collectionSources.id, id))
      .limit(1);
    return row ?? null;
  },

  async findSourceByHash(
    collectionId: string,
    contentHash: string,
  ): Promise<CollectionSourceResponse | null> {
    const db = getDb();
    const [row] = await db
      .select()
      .from(collectionSources)
      .where(
        and(
          eq(collectionSources.collectionId, collectionId),
          eq(collectionSources.contentHash, contentHash),
        ),
      )
      .limit(1);
    return row ? formatCollectionSourceResponse(row) : null;
  },

  async insertSource(payload: CollectionSourceRecord): Promise<void> {
    const db = getDb();
    await db.insert(collectionSources).values(payload);
  },

  async removeSource(id: string): Promise<void> {
    const db = getDb();
    await db.delete(collectionSources).where(eq(collectionSources.id, id));
  },
};
