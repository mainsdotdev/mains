import { eq, and, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../../db/client";
import { entities, issues, signals } from "../../db/schema";
import type { EntityInput, SyncJobStats } from "./sync.dto";

const DEFAULT_ACCOUNT_ID = "default";

// ─────────────────────────────────────────────────────────────
// Repository - Database operations
// ─────────────────────────────────────────────────────────────
export interface UpsertEntityResult {
  status: "inserted" | "updated" | "error";
  entityId?: string;
  error?: string;
}

export const syncRepo = {
  async findEntityByUrl(url: string, connectionId: string | null): Promise<{ id: string } | null> {
    const db = getDb();
    const connectionFilter = connectionId
      ? eq(entities.connectionId, connectionId)
      : isNull(entities.connectionId);

    const result = await db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.url, url), connectionFilter))
      .limit(1);

    return result[0] ?? null;
  },

  async upsertEntity(
    item: EntityInput,
    accountId: string = DEFAULT_ACCOUNT_ID
  ): Promise<UpsertEntityResult> {
    try {
      const db = getDb();
      const existing = await this.findEntityByUrl(item.url, item.connectionId ?? null);

      const metadataJson = item.metadata ? JSON.stringify(item.metadata) : null;
      const occurredAt = item.occurredAt ? new Date(item.occurredAt) : new Date();

      let entityId: string;

      if (existing) {
        entityId = existing.id;
        await db.update(entities)
          .set({
            title: item.title,
            body: item.body,
            summary: item.summary,
            occurredAt,
            metadata: metadataJson,
            externalId: item.externalId || null,
            resourceId: item.resourceId || null,
            updatedAt: sql`(unixepoch())`,
          })
          .where(eq(entities.id, entityId));
      } else {
        entityId = nanoid();
        await db.insert(entities).values({
          id: entityId,
          accountId,
          kind: item.kind,
          title: item.title,
          url: item.url,
          body: item.body,
          summary: item.summary,
          occurredAt,
          connectionId: item.connectionId || null,
          resourceId: item.resourceId || null,
          externalId: item.externalId || null,
          metadata: metadataJson,
        });
      }

      // Upsert issues table for issue entities
      if (item.kind === "issue" && item.metadata && typeof item.metadata === "object") {
        await this.upsertIssue(entityId, item.metadata as Record<string, unknown>);
      }

      return { status: existing ? "updated" : "inserted", entityId };
    } catch (err) {
      console.error(`❌ Error upserting entity ${item.url}:`, err);
      return {
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  },

  async upsertIssue(entityId: string, meta: Record<string, unknown>): Promise<void> {
    const db = getDb();

    let closedAtDate: Date | null = null;
    const closedAtValue = meta.closedAt || meta.completedAt;
    if (closedAtValue) {
      closedAtDate = typeof closedAtValue === "string"
        ? new Date(closedAtValue)
        : closedAtValue instanceof Date
          ? closedAtValue
          : null;
    }

    const issueValues = {
      provider: (meta.provider as string) || "unknown",
      state: (meta.state as string) || "open",
      number: typeof meta.number === "number" ? meta.number : null,
      repo: (meta.repo as string) || null,
      assignee: (meta.assignee as string) || null,
      labels: Array.isArray(meta.labels) ? JSON.stringify(meta.labels) : null,
      closedAt: closedAtDate,
      priority: typeof meta.priority === "number" ? meta.priority : 0,
    };

    const existing = await db
      .select({ entityId: issues.entityId })
      .from(issues)
      .where(eq(issues.entityId, entityId))
      .limit(1);

    if (existing.length > 0) {
      await db.update(issues).set(issueValues).where(eq(issues.entityId, entityId));
    } else {
      await db.insert(issues).values({ entityId, ...issueValues });
    }
  },

  upsertEntities(
    items: EntityInput[],
    accountId: string = DEFAULT_ACCOUNT_ID
  ): SyncJobStats {
    const db = getDb();
    const stats: SyncJobStats = { inserted: 0, updated: 0, skipped: 0, errors: 0 };

    db.transaction(() => {
      for (const item of items) {
        const result = this.upsertEntitySync(item, accountId);
        const key = result.status === "error" ? "errors" : result.status;
        stats[key]++;
      }
    });

    return stats;
  },

  upsertEntitySync(
    item: EntityInput,
    accountId: string = DEFAULT_ACCOUNT_ID
  ): UpsertEntityResult {
    try {
      const db = getDb();
      const connectionId = item.connectionId ?? null;
      const connectionFilter = connectionId
        ? eq(entities.connectionId, connectionId)
        : isNull(entities.connectionId);

      const existing = db
        .select({ id: entities.id })
        .from(entities)
        .where(and(eq(entities.url, item.url), connectionFilter))
        .limit(1)
        .get();

      const metadataJson = item.metadata ? JSON.stringify(item.metadata) : null;
      const occurredAt = item.occurredAt ? new Date(item.occurredAt) : new Date();

      let entityId: string;

      if (existing) {
        entityId = existing.id;
        db.update(entities)
          .set({
            title: item.title,
            body: item.body,
            summary: item.summary,
            occurredAt,
            metadata: metadataJson,
            externalId: item.externalId || null,
            resourceId: item.resourceId || null,
            updatedAt: sql`(unixepoch())`,
          })
          .where(eq(entities.id, entityId))
          .run();
      } else {
        entityId = nanoid();
        db.insert(entities).values({
          id: entityId,
          accountId,
          kind: item.kind,
          title: item.title,
          url: item.url,
          body: item.body,
          summary: item.summary,
          occurredAt,
          connectionId: connectionId,
          resourceId: item.resourceId || null,
          externalId: item.externalId || null,
          metadata: metadataJson,
        }).run();
      }

      if (item.kind === "issue" && item.metadata && typeof item.metadata === "object") {
        this.upsertIssueSync(entityId, item.metadata as Record<string, unknown>);
      }

      if (item.kind === "signal" && item.metadata && typeof item.metadata === "object") {
        this.upsertSignalSync(entityId, item.metadata as Record<string, unknown>);
      }

      return { status: existing ? "updated" : "inserted", entityId };
    } catch (err) {
      console.error(`❌ Error upserting entity ${item.url}:`, err);
      return {
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  },

  upsertIssueSync(entityId: string, meta: Record<string, unknown>): void {
    const db = getDb();

    let closedAtDate: Date | null = null;
    const closedAtValue = meta.closedAt || meta.completedAt;
    if (closedAtValue) {
      closedAtDate = typeof closedAtValue === "string"
        ? new Date(closedAtValue)
        : closedAtValue instanceof Date
          ? closedAtValue
          : null;
    }

    const issueValues = {
      provider: (meta.provider as string) || "unknown",
      state: (meta.state as string) || "open",
      number: typeof meta.number === "number" ? meta.number : null,
      repo: (meta.repo as string) || null,
      assignee: (meta.assignee as string) || null,
      labels: Array.isArray(meta.labels) ? JSON.stringify(meta.labels) : null,
      closedAt: closedAtDate,
      priority: typeof meta.priority === "number" ? meta.priority : 0,
    };

    const existing = db
      .select({ entityId: issues.entityId })
      .from(issues)
      .where(eq(issues.entityId, entityId))
      .limit(1)
      .get();

    if (existing) {
      db.update(issues).set(issueValues).where(eq(issues.entityId, entityId)).run();
    } else {
      db.insert(issues).values({ entityId, ...issueValues }).run();
    }
  },

  upsertSignalSync(entityId: string, meta: Record<string, unknown>): void {
    const db = getDb();

    const parseDate = (val: unknown): Date | null => {
      if (!val) return null;
      if (val instanceof Date) return val;
      if (typeof val === "string") return new Date(val);
      return null;
    };

    type SignalLevel = "fatal" | "critical" | "error" | "warning" | "info";
    type SignalCategory = "crash" | "bug" | "alert" | "feedback" | "exception" | "other";
    type SignalState = "open" | "resolved" | "ignored" | "regressed";

    const signalValues = {
      source: (meta.source as string) || "unknown",
      level: ((meta.level as string) || "error") as SignalLevel,
      category: ((meta.category as string) || "bug") as SignalCategory,
      state: ((meta.state as string) || "open") as SignalState,
      eventCount: typeof meta.eventCount === "number" ? meta.eventCount : 1,
      affectedUsers: typeof meta.affectedUsers === "number" ? meta.affectedUsers : null,
      firstSeenAt: parseDate(meta.firstSeenAt),
      lastSeenAt: parseDate(meta.lastSeenAt) || new Date(),
      stackTrace: (meta.stackTrace as string) || null,
      file: (meta.file as string) || null,
      function: (meta.function as string) || null,
      line: typeof meta.line === "number" ? meta.line : null,
      assignee: (meta.assignee as string) || null,
      labels: Array.isArray(meta.labels) ? JSON.stringify(meta.labels) : null,
      priority: typeof meta.priority === "number" ? meta.priority : 0,
      projectId: (meta.projectId as string) || null,
    };

    const existing = db
      .select({ entityId: signals.entityId })
      .from(signals)
      .where(eq(signals.entityId, entityId))
      .limit(1)
      .get();

    if (existing) {
      db.update(signals).set(signalValues).where(eq(signals.entityId, entityId)).run();
    } else {
      db.insert(signals).values({ entityId, ...signalValues }).run();
    }
  },

};
