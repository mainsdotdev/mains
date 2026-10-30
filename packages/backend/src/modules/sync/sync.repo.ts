import { eq, and, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../../db/client";
import {
  entities,
  issues,
  issueStatuses,
  issueStatusMappings,
  signals,
  syncCursors,
} from "../../db/schema";
import { safeJsonParse } from "./sync.connection-utils";
import { isDefaultIssueStatusId } from "@mains/contracts/issue-status";
import type { EntityInput, SyncCursor, SyncJobStats } from "./sync.dto";

const DEFAULT_ACCOUNT_ID = "default";

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const stringOrNull = (value: unknown) => (typeof value === "string" && value ? value : null);

/**
 * The `issues` row a fetcher's issue metadata describes. Besides each
 * provider's own keys, every fetcher fills the shared row fields:
 * `identifier`, `priorityLevel` (or a numeric `priority`), `labelColors`,
 * `assigneeAvatarUrl`, `group` ({ name, color }) and `dueAt`.
 */
function issueValuesFromMeta(meta: Record<string, unknown>) {
  const closedAtDate = toDate(meta.closedAt || meta.completedAt);
  const group =
    meta.group && typeof meta.group === "object"
      ? (meta.group as { name?: unknown; color?: unknown })
      : null;
  const labelColors =
    meta.labelColors && typeof meta.labelColors === "object" && Object.keys(meta.labelColors).length > 0
      ? JSON.stringify(meta.labelColors)
      : null;

  return {
    provider: (meta.provider as string) || "unknown",
    state: (meta.state as string) || "open",
    stateId: typeof meta.stateId === "string" ? meta.stateId : null,
    // Fetchers map their provider's category onto a default status; anything
    // else (an older fetcher, a hand-made row) falls back on closedAt.
    statusId: isDefaultIssueStatusId(meta.statusId)
      ? meta.statusId
      : closedAtDate
        ? "done"
        : "todo",
    number: typeof meta.number === "number" ? meta.number : null,
    identifier: stringOrNull(meta.identifier),
    repo: (meta.repo as string) || null,
    assignee: (meta.assignee as string) || null,
    assigneeAvatarUrl: stringOrNull(meta.assigneeAvatarUrl),
    labels: Array.isArray(meta.labels) ? JSON.stringify(meta.labels) : null,
    labelColors,
    groupName: stringOrNull(group?.name),
    groupColor: stringOrNull(group?.color),
    dueAt: toDate(meta.dueAt),
    closedAt: closedAtDate,
    // Jira keeps its priority *name* under `priority`, so a normalized level
    // travels separately.
    priority:
      typeof meta.priorityLevel === "number"
        ? meta.priorityLevel
        : typeof meta.priority === "number"
          ? meta.priority
          : 0,
  };
}

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
        await this.upsertIssue(entityId, item.metadata as Record<string, unknown>, item.resourceId ?? null);
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

  async upsertIssue(
    entityId: string,
    meta: Record<string, unknown>,
    resourceId: string | null = null,
  ): Promise<void> {
    const db = getDb();
    const issueValues = this.withStatusMapping(issueValuesFromMeta(meta), resourceId);

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
        this.upsertIssueSync(entityId, item.metadata as Record<string, unknown>, item.resourceId ?? null);
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

  upsertIssueSync(
    entityId: string,
    meta: Record<string, unknown>,
    resourceId: string | null = null,
  ): void {
    const db = getDb();
    const issueValues = this.withStatusMapping(issueValuesFromMeta(meta), resourceId);

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

  // ─────────────────────────────────────────────────────────────
  // Incremental sync cursors
  // ─────────────────────────────────────────────────────────────
  getCursor(fetcherId: string, resourceId: string): Date | null {
    const row = getDb()
      .select({ syncedAt: syncCursors.syncedAt })
      .from(syncCursors)
      .where(and(eq(syncCursors.fetcherId, fetcherId), eq(syncCursors.resourceId, resourceId)))
      .get();
    return row?.syncedAt ?? null;
  },

  saveCursors(fetcherId: string, cursors: readonly SyncCursor[]): void {
    const db = getDb();
    for (const { resourceId, syncedAt } of cursors) {
      db.insert(syncCursors)
        .values({ fetcherId, resourceId, syncedAt })
        .onConflictDoUpdate({
          target: [syncCursors.fetcherId, syncCursors.resourceId],
          set: { syncedAt },
        })
        .run();
    }
  },

  /**
   * When the stalest still-open issue of a resource was last returned by a
   * fetch (every upsert touches `entities.updated_at`). Anything closed in the
   * provider since then has an update time after it — so a resource's first
   * incremental run asks for changes from here to catch closures that an
   * open-only fetch silently dropped.
   */
  oldestOpenIssueSeenAt(resourceId: string): Date | null {
    const row = getDb()
      .select({ seenAt: sql<number | null>`min(${entities.updatedAt})` })
      .from(issues)
      .innerJoin(entities, eq(issues.entityId, entities.id))
      .leftJoin(issueStatuses, eq(issues.statusId, issueStatuses.id))
      .where(
        and(
          eq(entities.resourceId, resourceId),
          eq(entities.isDeleted, false),
          sql`coalesce(${issueStatuses.category}, 'open') = 'open'`,
        ),
      )
      .get();
    return row?.seenAt ? new Date(row.seenAt * 1000) : null;
  },

  // ─────────────────────────────────────────────────────────────
  // Status mappings — the user's override of the automatic status
  // ─────────────────────────────────────────────────────────────
  /** A user mapping beats the fetcher's automatic status. */
  withStatusMapping<T extends { stateId: string | null; statusId: string }>(
    values: T,
    resourceId: string | null,
  ): T {
    if (!resourceId || !values.stateId) return values;
    const row = getDb()
      .select({ statusId: issueStatusMappings.statusId })
      .from(issueStatusMappings)
      .where(
        and(
          eq(issueStatusMappings.resourceId, resourceId),
          eq(issueStatusMappings.stateId, values.stateId),
        ),
      )
      .get();
    return row ? { ...values, statusId: row.statusId } : values;
  },

  listStatusMappings(resourceId: string): Map<string, string> {
    const rows = getDb()
      .select({ stateId: issueStatusMappings.stateId, statusId: issueStatusMappings.statusId })
      .from(issueStatusMappings)
      .where(eq(issueStatusMappings.resourceId, resourceId))
      .all();
    return new Map(rows.map((row) => [row.stateId, row.statusId]));
  },

  statusExists(statusId: string): boolean {
    return Boolean(
      getDb().select({ id: issueStatuses.id }).from(issueStatuses).where(eq(issueStatuses.id, statusId)).get(),
    );
  },

  /**
   * Map a resource's provider state onto a status — or, with null, drop the
   * mapping — and re-apply it to the issues already stored in that state, so
   * the inbox changes without waiting for a sync. Dropping it puts each issue
   * back on the automatic status its fetcher recorded. Returns how many issues
   * were updated.
   */
  setStatusMapping(resourceId: string, stateId: string, statusId: string | null): number {
    const db = getDb();
    return db.transaction(() => {
      if (statusId) {
        db.insert(issueStatusMappings)
          .values({ resourceId, stateId, statusId })
          .onConflictDoUpdate({
            target: [issueStatusMappings.resourceId, issueStatusMappings.stateId],
            set: { statusId, updatedAt: sql`(unixepoch())` },
          })
          .run();
      } else {
        db.delete(issueStatusMappings)
          .where(
            and(eq(issueStatusMappings.resourceId, resourceId), eq(issueStatusMappings.stateId, stateId)),
          )
          .run();
      }

      const affected = db
        .select({ entityId: issues.entityId, metadata: entities.metadata })
        .from(issues)
        .innerJoin(entities, eq(issues.entityId, entities.id))
        .where(and(eq(entities.resourceId, resourceId), eq(issues.stateId, stateId)))
        .all();
      for (const row of affected) {
        const next =
          statusId ??
          issueValuesFromMeta(safeJsonParse<Record<string, unknown>>(row.metadata, {})).statusId;
        db.update(issues).set({ statusId: next }).where(eq(issues.entityId, row.entityId)).run();
      }
      return affected.length;
    });
  },
};
