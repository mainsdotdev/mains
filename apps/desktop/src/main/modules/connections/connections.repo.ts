import { eq, and, desc, sql } from "drizzle-orm";
import { getDb } from "../../db/client";
import {
  connections,
  connectionTokens,
  connectionResources,
  connectionStates,
  entities,
} from "../../db/schema";

// ─────────────────────────────────────────────────────────────
// Connections Repository
// ─────────────────────────────────────────────────────────────
export const connectionsRepo = {
  // Connection queries
  async findById(connectionId: string) {
    const db = getDb();
    return db.select().from(connections).where(eq(connections.id, connectionId)).get();
  },

  async findByProvider(provider: string) {
    const db = getDb();
    return db.select().from(connections).where(eq(connections.provider, provider)).get();
  },

  async updateStatus(
    connectionId: string,
    status: "active" | "revoked" | "error" | "disabled",
    metadata: string
  ): Promise<void> {
    const db = getDb();
    await db
      .update(connections)
      .set({ status, metadata, updatedAt: sql`(unixepoch())` })
      .where(eq(connections.id, connectionId))
      .run();
  },

  async insert(data: {
    id: string;
    provider: string;
    type: string;
    status: "active" | "revoked" | "error" | "disabled";
    metadata: string;
  }) {
    const db = getDb();
    return db.insert(connections).values(data).returning().get();
  },

  // Token queries
  async findCurrentToken(connectionId: string) {
    const db = getDb();
    return db
      .select()
      .from(connectionTokens)
      .where(
        and(
          eq(connectionTokens.connectionId, connectionId),
          eq(connectionTokens.isCurrent, true)
        )
      )
      .get();
  },

  async findTokensByConnectionId(connectionId: string) {
    const db = getDb();
    return db.query.connectionTokens.findMany({
      where: eq(connectionTokens.connectionId, connectionId),
    });
  },

  async markTokensNotCurrent(connectionId: string): Promise<void> {
    const db = getDb();
    await db
      .update(connectionTokens)
      .set({ isCurrent: false })
      .where(eq(connectionTokens.connectionId, connectionId))
      .run();
  },

  /**
   * Atomically mark all existing tokens not current and insert a new one as
   * current. Prevents races where concurrent saves leave multiple current
   * rows.
   */
  rotateToken(data: {
    connectionId: string;
    accessTokenEnc: Buffer;
    refreshTokenEnc: Buffer | null;
    tokenType: string;
    expiresAt: Date | null;
    tokenHash: Buffer;
    keyVersion: number;
  }): void {
    const db = getDb();
    db.transaction(() => {
      db.update(connectionTokens)
        .set({ isCurrent: false })
        .where(eq(connectionTokens.connectionId, data.connectionId))
        .run();

      db.insert(connectionTokens)
        .values({ ...data, isCurrent: true })
        .run();
    });
  },

  // Resource queries
  async findResourcesByConnectionId(connectionId: string) {
    const db = getDb();
    return db
      .select()
      .from(connectionResources)
      .where(eq(connectionResources.connectionId, connectionId))
      .all();
  },

  async findResourcesByConnectionAndKind(
    connectionId: string,
    kind: string,
    selected?: boolean
  ) {
    const db = getDb();
    const conditions = [
      eq(connectionResources.connectionId, connectionId),
      eq(connectionResources.kind, kind),
    ];
    if (selected !== undefined) {
      conditions.push(eq(connectionResources.selected, selected));
    }
    return db
      .select()
      .from(connectionResources)
      .where(and(...conditions))
      .all();
  },

  async findSelectedResourcesByConnection(connectionId: string) {
    const db = getDb();
    return db
      .select()
      .from(connectionResources)
      .where(
        and(
          eq(connectionResources.connectionId, connectionId),
          eq(connectionResources.selected, true)
        )
      )
      .all();
  },

  async findResourceByExternalId(connectionId: string, externalId: string) {
    const db = getDb();
    return db
      .select()
      .from(connectionResources)
      .where(
        and(
          eq(connectionResources.connectionId, connectionId),
          eq(connectionResources.externalId, externalId)
        )
      )
      .get();
  },

  async insertResource(data: {
    id: string;
    connectionId: string;
    externalId: string;
    kind: string;
    name: string;
    url?: string | null;
    selected: boolean;
    metadata: string | null;
    lastSeenAt: Date;
  }): Promise<void> {
    const db = getDb();
    await db.insert(connectionResources).values(data);
  },

  async insertResources(
    data: Array<{
      id: string;
      connectionId: string;
      externalId: string;
      kind: string;
      name: string;
      url?: string | null;
      selected: boolean;
      metadata: string | null;
      lastSeenAt: Date;
    }>
  ): Promise<void> {
    const db = getDb();
    if (data.length > 0) {
      await db.insert(connectionResources).values(data).run();
    }
  },

  async updateResource(
    resourceId: string,
    data: {
      selected?: boolean;
      lastSeenAt?: Date;
      metadata?: string | null;
      name?: string;
      url?: string;
    }
  ): Promise<void> {
    const db = getDb();
    await db
      .update(connectionResources)
      .set(data)
      .where(eq(connectionResources.id, resourceId))
      .run();
  },

  async deleteResource(resourceId: string) {
    const db = getDb();
    await db
      .delete(entities)
      .where(eq(entities.resourceId, resourceId))
      .run();
    return db
      .delete(connectionResources)
      .where(eq(connectionResources.id, resourceId))
      .returning();
  },

  async deleteResourcesByConnectionId(connectionId: string): Promise<void> {
    const db = getDb();
    await db
      .delete(connectionResources)
      .where(eq(connectionResources.connectionId, connectionId))
      .run();
  },

  async deleteEntitiesByConnectionId(connectionId: string): Promise<void> {
    const db = getDb();
    await db
      .delete(entities)
      .where(eq(entities.connectionId, connectionId))
      .run();
  },

  // Connection state queries
  async findAllStates() {
    const db = getDb();
    return db
      .select({
        id: connectionStates.id,
        displayName: connectionStates.displayName,
        iconPath: connectionStates.iconPath,
        isConnected: connectionStates.isConnected,
        connectionId: connectionStates.connectionId,
        category: connectionStates.category,
        sortOrder: connectionStates.sortOrder,
        enabledFeatures: connectionStates.enabledFeatures,
        config: connectionStates.config,
      })
      .from(connectionStates)
      .orderBy(desc(connectionStates.sortOrder));
  },

  async findConnectionState(appId: string) {
    const db = getDb();
    return db.select().from(connectionStates).where(eq(connectionStates.id, appId)).get();
  },

  async updateConnectionState(
    appId: string,
    isConnected: boolean,
    connectionId: string | null
  ): Promise<void> {
    const db = getDb();
    await db
      .update(connectionStates)
      .set({ isConnected, connectionId, updatedAt: sql`(unixepoch())` })
      .where(eq(connectionStates.id, appId))
      .run();
  },

  async updateStateById(
    id: string,
    data: { isConnected: boolean; connectionId?: string | null }
  ): Promise<void> {
    const db = getDb();
    await db
      .update(connectionStates)
      .set({
        isConnected: data.isConnected,
        connectionId: data.connectionId ?? null,
        updatedAt: sql`(unixepoch())`,
      })
      .where(eq(connectionStates.id, id))
      .run();
  },

  async upsertConnectionState(
    appId: string,
    isConnected: boolean,
    connectionId: string | null
  ): Promise<void> {
    const db = getDb();
    await db
      .insert(connectionStates)
      .values({ id: appId, isConnected, connectionId })
      .onConflictDoUpdate({
        target: connectionStates.id,
        set: { isConnected, connectionId },
      })
      .run();
  },
};
