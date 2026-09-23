import { desc, eq, and, like, or, inArray, sql } from "drizzle-orm";
import { getDb } from "../../db/client";
import { entities, tasks, issues, signals } from "../../db/schema";
import { serializeLabels, serializeMetadata } from "./entities.utils";
import type {
  CreateEntityPayload,
  UpdateEntityPayload,
  CreateTaskPayload,
  UpdateTaskPayload,
  CreateIssuePayload,
  UpdateIssuePayload,
  CreateSignalPayload,
  UpdateSignalPayload,
  EntityQueryOptions,
  TaskQueryOptions,
  IssueQueryOptions,
  SignalQueryOptions,
  SearchOptions,
} from "./entities.dto";

// ─────────────────────────────────────────────────────────────
// Entities Repository
// ─────────────────────────────────────────────────────────────
export const entitiesRepo = {
  // ─────────────────────────────────────────────────────────────
  // Entity Operations
  // ─────────────────────────────────────────────────────────────
  async findAll(options: EntityQueryOptions = {}) {
    const db = getDb();
    const { kinds, kind, connectionIds, connectionId, limit = 50 } = options;

    const conditions = [];
    if (kinds && kinds.length > 0) {
      conditions.push(inArray(entities.kind, kinds));
    } else if (kind) {
      conditions.push(eq(entities.kind, kind));
    }
    if (connectionIds && connectionIds.length > 0) {
      conditions.push(inArray(entities.connectionId, connectionIds));
    } else if (connectionId) {
      conditions.push(eq(entities.connectionId, connectionId));
    }
    conditions.push(eq(entities.isDeleted, false));

    const whereClause =
      conditions.length > 1 ? and(...conditions) : conditions[0];

    return db
      .select()
      .from(entities)
      .where(whereClause)
      .orderBy(desc(entities.updatedAt))
      .limit(limit);
  },

  async findById(id: string) {
    const db = getDb();
    const items = await db
      .select()
      .from(entities)
      .where(eq(entities.id, id))
      .limit(1);
    return items[0] || null;
  },

  async insert(id: string, payload: CreateEntityPayload) {
    const db = getDb();
    await db.insert(entities).values({
      id,
      accountId: payload.accountId,
      kind: payload.kind,
      connectionId: payload.connectionId,
      resourceId: payload.resourceId,
      externalId: payload.externalId,
      url: payload.url,
      title: payload.title,
      body: payload.body,
      summary: payload.summary,
      metadata: serializeMetadata(payload.metadata),
      occurredAt: payload.occurredAt,
    });
    return this.findById(id);
  },

  async update(id: string, payload: UpdateEntityPayload) {
    const db = getDb();
    const updateData: Record<string, unknown> = {
      updatedAt: sql`(unixepoch())`,
    };

    if (payload.title !== undefined) updateData.title = payload.title;
    if (payload.body !== undefined) updateData.body = payload.body;
    if (payload.summary !== undefined) updateData.summary = payload.summary;
    if (payload.url !== undefined) updateData.url = payload.url;
    if (payload.isDeleted !== undefined) updateData.isDeleted = payload.isDeleted;
    if (payload.metadata !== undefined)
      updateData.metadata = serializeMetadata(payload.metadata);

    await db.update(entities).set(updateData).where(eq(entities.id, id));
    return this.findById(id);
  },

  async softDelete(id: string) {
    const db = getDb();
    await db
      .update(entities)
      .set({ isDeleted: true, updatedAt: sql`(unixepoch())` })
      .where(eq(entities.id, id));
  },

  async search(query: string, options: SearchOptions = {}) {
    const db = getDb();
    const { kind, limit = 20 } = options;
    const searchPattern = `%${query}%`;

    const conditions = [
      eq(entities.isDeleted, false),
      or(
        like(entities.title, searchPattern),
        like(entities.body, searchPattern),
        like(entities.summary, searchPattern)
      ),
    ];

    if (kind) {
      conditions.push(eq(entities.kind, kind));
    }

    return db
      .select()
      .from(entities)
      .where(and(...conditions))
      .orderBy(desc(entities.updatedAt))
      .limit(limit);
  },

  // ─────────────────────────────────────────────────────────────
  // Task Operations
  // ─────────────────────────────────────────────────────────────
  async findAllTasks(options: TaskQueryOptions = {}) {
    const db = getDb();
    const { status, limit = 50 } = options;

    const conditions = [eq(entities.isDeleted, false)];
    if (status) {
      conditions.push(eq(tasks.status, status));
    }

    return db
      .select({
        task: tasks,
        entity: entities,
      })
      .from(tasks)
      .innerJoin(entities, eq(tasks.entityId, entities.id))
      .where(and(...conditions))
      .orderBy(desc(tasks.priority), tasks.dueAt)
      .limit(limit);
  },

  async findTaskById(entityId: string) {
    const db = getDb();
    const items = await db
      .select({
        task: tasks,
        entity: entities,
      })
      .from(tasks)
      .innerJoin(entities, eq(tasks.entityId, entities.id))
      .where(eq(tasks.entityId, entityId))
      .limit(1);
    return items[0] || null;
  },

  async insertTask(entityId: string, payload: CreateTaskPayload) {
    const db = getDb();

    // Create entity first
    await db.insert(entities).values({
      id: entityId,
      accountId: payload.entity.accountId,
      kind: "task",
      connectionId: payload.entity.connectionId,
      resourceId: payload.entity.resourceId,
      externalId: payload.entity.externalId,
      url: payload.entity.url,
      title: payload.entity.title,
      body: payload.entity.body,
      summary: payload.entity.summary,
      metadata: serializeMetadata(payload.entity.metadata),
      occurredAt: payload.entity.occurredAt,
    });

    // Create task record
    await db.insert(tasks).values({
      entityId,
      status: payload.status || "todo",
      dueAt: payload.dueAt,
      priority: payload.priority || 0,
      labels: serializeLabels(payload.labels),
    });

    return this.findTaskById(entityId);
  },

  async updateTask(entityId: string, payload: UpdateTaskPayload) {
    const db = getDb();
    const updateData: Record<string, unknown> = {};

    if (payload.status !== undefined) updateData.status = payload.status;
    if (payload.dueAt !== undefined) updateData.dueAt = payload.dueAt;
    if (payload.priority !== undefined) updateData.priority = payload.priority;
    if (payload.labels !== undefined)
      updateData.labels = serializeLabels(payload.labels);

    if (Object.keys(updateData).length > 0) {
      await db.update(tasks).set(updateData).where(eq(tasks.entityId, entityId));
      await db
        .update(entities)
        .set({ updatedAt: sql`(unixepoch())` })
        .where(eq(entities.id, entityId));
    }

    return this.findTaskById(entityId);
  },

  // ─────────────────────────────────────────────────────────────
  // Issue Operations
  // ─────────────────────────────────────────────────────────────
  async findAllIssues(options: IssueQueryOptions = {}) {
    const db = getDb();
    const { provider, state, repo, limit = 50 } = options;

    const conditions = [eq(entities.isDeleted, false)];
    if (provider) conditions.push(eq(issues.provider, provider));
    if (state) conditions.push(eq(issues.state, state));
    if (repo) conditions.push(eq(issues.repo, repo));

    return db
      .select({
        issue: issues,
        entity: entities,
      })
      .from(issues)
      .innerJoin(entities, eq(issues.entityId, entities.id))
      .where(and(...conditions))
      .orderBy(
        sql`CASE WHEN ${issues.state} = 'open' THEN 0 ELSE 1 END`,
        desc(issues.number),
      )
      .limit(limit);
  },

  async findIssueById(entityId: string) {
    const db = getDb();
    const items = await db
      .select({
        issue: issues,
        entity: entities,
      })
      .from(issues)
      .innerJoin(entities, eq(issues.entityId, entities.id))
      .where(eq(issues.entityId, entityId))
      .limit(1);
    return items[0] || null;
  },

  async findIssuesByResourceIds(resourceIds: string[]) {
    if (resourceIds.length === 0) return [];
    const db = getDb();
    return db
      .select({
        issue: issues,
        entity: entities,
      })
      .from(issues)
      .innerJoin(entities, eq(issues.entityId, entities.id))
      .where(
        and(
          eq(entities.isDeleted, false),
          inArray(entities.resourceId, resourceIds),
        ),
      )
      .orderBy(issues.number);
  },

  async insertIssue(entityId: string, payload: CreateIssuePayload) {
    const db = getDb();

    // Create entity first
    await db.insert(entities).values({
      id: entityId,
      accountId: payload.entity.accountId,
      kind: "issue",
      connectionId: payload.entity.connectionId,
      resourceId: payload.entity.resourceId,
      externalId: payload.entity.externalId,
      url: payload.entity.url,
      title: payload.entity.title,
      body: payload.entity.body,
      summary: payload.entity.summary,
      metadata: serializeMetadata(payload.entity.metadata),
      occurredAt: payload.entity.occurredAt,
    });

    // Create issue record
    await db.insert(issues).values({
      entityId,
      provider: payload.provider,
      state: payload.state,
      number: payload.number,
      repo: payload.repo,
      assignee: payload.assignee,
      labels: serializeLabels(payload.labels),
      priority: payload.priority || 0,
    });

    return this.findIssueById(entityId);
  },

  async updateIssue(entityId: string, payload: UpdateIssuePayload) {
    const db = getDb();
    const updateData: Record<string, unknown> = {};

    if (payload.state !== undefined) updateData.state = payload.state;
    if (payload.assignee !== undefined) updateData.assignee = payload.assignee;
    if (payload.priority !== undefined) updateData.priority = payload.priority;
    if (payload.closedAt !== undefined) updateData.closedAt = payload.closedAt;
    if (payload.labels !== undefined)
      updateData.labels = serializeLabels(payload.labels);

    if (Object.keys(updateData).length > 0) {
      await db.update(issues).set(updateData).where(eq(issues.entityId, entityId));
      await db
        .update(entities)
        .set({ updatedAt: sql`(unixepoch())` })
        .where(eq(entities.id, entityId));
    }

    return this.findIssueById(entityId);
  },

  // ─────────────────────────────────────────────────────────────
  // Signal Operations
  // ─────────────────────────────────────────────────────────────
  async findAllSignals(options: SignalQueryOptions = {}) {
    const db = getDb();
    const { source, level, category, state, projectId, limit = 50 } = options;

    const conditions = [eq(entities.isDeleted, false)];
    if (source) conditions.push(eq(signals.source, source));
    if (level) conditions.push(eq(signals.level, level as any));
    if (category) conditions.push(eq(signals.category, category as any));
    if (state) conditions.push(eq(signals.state, state as any));
    if (projectId) conditions.push(eq(signals.projectId, projectId));

    return db
      .select({
        signal: signals,
        entity: entities,
      })
      .from(signals)
      .innerJoin(entities, eq(signals.entityId, entities.id))
      .where(and(...conditions))
      .orderBy(
        sql`CASE ${signals.level}
          WHEN 'fatal' THEN 0
          WHEN 'critical' THEN 1
          WHEN 'error' THEN 2
          WHEN 'warning' THEN 3
          WHEN 'info' THEN 4
          ELSE 5 END`,
        desc(signals.lastSeenAt),
      )
      .limit(limit);
  },

  async findSignalById(entityId: string) {
    const db = getDb();
    const items = await db
      .select({
        signal: signals,
        entity: entities,
      })
      .from(signals)
      .innerJoin(entities, eq(signals.entityId, entities.id))
      .where(eq(signals.entityId, entityId))
      .limit(1);
    return items[0] || null;
  },

  async insertSignal(entityId: string, payload: CreateSignalPayload) {
    const db = getDb();

    // Create entity first
    await db.insert(entities).values({
      id: entityId,
      accountId: payload.entity.accountId,
      kind: "signal",
      connectionId: payload.entity.connectionId,
      resourceId: payload.entity.resourceId,
      externalId: payload.entity.externalId,
      url: payload.entity.url,
      title: payload.entity.title,
      body: payload.entity.body,
      summary: payload.entity.summary,
      metadata: serializeMetadata(payload.entity.metadata),
      occurredAt: payload.entity.occurredAt,
    });

    // Create signal record
    await db.insert(signals).values({
      entityId,
      source: payload.source,
      level: payload.level || "error",
      category: payload.category || "bug",
      state: payload.state || "open",
      eventCount: payload.eventCount || 1,
      affectedUsers: payload.affectedUsers,
      firstSeenAt: payload.firstSeenAt || new Date(),
      lastSeenAt: payload.lastSeenAt || new Date(),
      stackTrace: payload.stackTrace,
      file: payload.file,
      function: payload.function,
      line: payload.line,
      assignee: payload.assignee,
      labels: serializeLabels(payload.labels),
      priority: payload.priority || 0,
      projectId: payload.projectId,
    });

    return this.findSignalById(entityId);
  },

  async updateSignal(entityId: string, payload: UpdateSignalPayload) {
    const db = getDb();
    const updateData: Record<string, unknown> = {};

    if (payload.level !== undefined) updateData.level = payload.level;
    if (payload.category !== undefined) updateData.category = payload.category;
    if (payload.state !== undefined) updateData.state = payload.state;
    if (payload.eventCount !== undefined) updateData.eventCount = payload.eventCount;
    if (payload.affectedUsers !== undefined) updateData.affectedUsers = payload.affectedUsers;
    if (payload.lastSeenAt !== undefined) updateData.lastSeenAt = payload.lastSeenAt;
    if (payload.stackTrace !== undefined) updateData.stackTrace = payload.stackTrace;
    if (payload.file !== undefined) updateData.file = payload.file;
    if (payload.function !== undefined) updateData.function = payload.function;
    if (payload.line !== undefined) updateData.line = payload.line;
    if (payload.assignee !== undefined) updateData.assignee = payload.assignee;
    if (payload.priority !== undefined) updateData.priority = payload.priority;
    if (payload.projectId !== undefined) updateData.projectId = payload.projectId;
    if (payload.resolvedAt !== undefined) updateData.resolvedAt = payload.resolvedAt;
    if (payload.labels !== undefined)
      updateData.labels = serializeLabels(payload.labels);

    if (Object.keys(updateData).length > 0) {
      await db.update(signals).set(updateData).where(eq(signals.entityId, entityId));
      await db
        .update(entities)
        .set({ updatedAt: sql`(unixepoch())` })
        .where(eq(entities.id, entityId));
    }

    return this.findSignalById(entityId);
  },

};
