import { eq, desc, and, sql, asc, gt, gte, inArray } from "drizzle-orm";
import { getDb } from "../../db/client";
import { safeJsonParse } from "../../db/utils";
import { runs, runContext, runArtifacts, toolCalls, runTurns } from "../../db/schema";
import type {
  CreateRunPayload,
  UpdateRunPayload,
  RunResponse,
  CreateRunContextPayload,
  RunContextResponse,
  CreateRunArtifactPayload,
  RunArtifactResponse,
  CreateToolCallPayload,
  UpdateToolCallPayload,
  ToolCallResponse,
  CreateRunTurnPayload,
  UpdateRunTurnPayload,
  RunTurnResponse,
  RunExperienceOptions,
  WorkspaceRunListOptions,
} from "./runs.dto";

// ─────────────────────────────────────────────────────────────
// Runs Repository
// ─────────────────────────────────────────────────────────────
export const runsRepo = {
  // ─────────────────────────────────────────────────────────────
  // Run Operations
  // ─────────────────────────────────────────────────────────────
  async findAllRuns(limit = 100, includeArchived = false): Promise<RunResponse[]> {
    const db = getDb();
    const query = db.select().from(runs);
    const rows = includeArchived
      ? await query.orderBy(desc(runs.createdAt)).limit(limit)
      : await query.where(eq(runs.isArchived, false)).orderBy(desc(runs.createdAt)).limit(limit);
    return rows.map(mapRunRowToResponse);
  },

  async findArchivedRuns(): Promise<RunResponse[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(runs)
      .where(eq(runs.isArchived, true))
      .orderBy(desc(runs.updatedAt));
    return rows.map(mapRunRowToResponse);
  },

  /**
   * The chat sidebar's list: newest-touched non-archived runs of one
   * provider/mode experience.
   */
  async findRecentRunsByExperience(
    options: RunExperienceOptions,
  ): Promise<RunResponse[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.providerId, options.providerId),
          eq(runs.accountId, options.accountId),
          eq(runs.mode, options.mode),
          eq(runs.isArchived, false),
        ),
      )
      .orderBy(desc(runs.updatedAt))
      .limit(options.limit ?? 50);
    return rows.map(mapRunRowToResponse);
  },

  /**
   * Every unfinished run, oldest first — the order the background-runs dock
   * stacks them in, so a card never jumps position while another run starts.
   */
  async findPendingRuns(): Promise<RunResponse[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(runs)
      .where(
        and(
          inArray(runs.status, ["queued", "running"]),
          eq(runs.isArchived, false),
        ),
      )
      .orderBy(asc(runs.createdAt));
    return rows.map(mapRunRowToResponse);
  },

  async findRunById(id: string): Promise<RunResponse | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(runs)
      .where(eq(runs.id, id))
      .limit(1);
    return rows[0] ? mapRunRowToResponse(rows[0]) : null;
  },

  async findRunsByAccount(accountId: string, limit = 100, includeArchived = false): Promise<RunResponse[]> {
    const db = getDb();
    const condition = includeArchived
      ? eq(runs.accountId, accountId)
      : and(eq(runs.accountId, accountId), eq(runs.isArchived, false));
    const rows = await db
      .select()
      .from(runs)
      .where(condition)
      .orderBy(desc(runs.createdAt))
      .limit(limit);
    return rows.map(mapRunRowToResponse);
  },

  async findRunsByWorkspace(
    workspaceId: string,
    options: WorkspaceRunListOptions & { includeArchived?: boolean } = {},
  ): Promise<RunResponse[]> {
    const db = getDb();
    const conditions = [eq(runs.workspaceId, workspaceId)];
    if (!options.includeArchived) conditions.push(eq(runs.isArchived, false));
    if (options.providerId) conditions.push(eq(runs.providerId, options.providerId));
    if (options.mode) conditions.push(eq(runs.mode, options.mode));
    const rows = await db
      .select()
      .from(runs)
      .where(and(...conditions))
      .orderBy(desc(runs.createdAt))
      .limit(options.limit ?? 100);
    return rows.map(mapRunRowToResponse);
  },

  async findRunsByStatus(
    accountId: string,
    status: "queued" | "running" | "succeeded" | "failed" | "canceled"
  ): Promise<RunResponse[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(runs)
      .where(and(eq(runs.accountId, accountId), eq(runs.status, status)))
      .orderBy(desc(runs.createdAt));
    return rows.map(mapRunRowToResponse);
  },

  async insertRun(payload: CreateRunPayload): Promise<string> {
    const db = getDb();
    await db.insert(runs).values({
      id: payload.id,
      accountId: payload.accountId,
      workspaceId: payload.workspaceId,
      collectionId: payload.collectionId,
      spaceId: payload.spaceId,
      providerId: payload.providerId,
      mode: payload.mode,
      model: payload.model,
      title: payload.title,
      goal: payload.goal,
      status: payload.status ?? "queued",
      systemPrompt: payload.systemPrompt,
      configSnapshot: payload.configSnapshot ? JSON.stringify(payload.configSnapshot) : null,
      toolPolicySnapshot: payload.toolPolicySnapshot
        ? JSON.stringify(payload.toolPolicySnapshot)
        : null,
    });
    return payload.id;
  },

  async updateRun(id: string, payload: UpdateRunPayload): Promise<RunResponse | null> {
    const db = getDb();
    const updateData: Record<string, unknown> = { updatedAt: sql`(unixepoch())` };

    if (payload.title !== undefined) updateData.title = payload.title;
    if (payload.goal !== undefined) updateData.goal = payload.goal;
    if (payload.status !== undefined) updateData.status = payload.status;
    if (payload.model !== undefined) updateData.model = payload.model;
    if (payload.systemPrompt !== undefined) updateData.systemPrompt = payload.systemPrompt;
    if (payload.configSnapshot !== undefined)
      updateData.configSnapshot = JSON.stringify(payload.configSnapshot);
    if (payload.toolPolicySnapshot !== undefined)
      updateData.toolPolicySnapshot = JSON.stringify(payload.toolPolicySnapshot);
    if (payload.startedAt !== undefined) updateData.startedAt = payload.startedAt;
    if (payload.endedAt !== undefined) updateData.endedAt = payload.endedAt;
    if (payload.lastError !== undefined) updateData.lastError = payload.lastError;
    if (payload.stopReason !== undefined) updateData.stopReason = payload.stopReason;
    if (payload.sessionId !== undefined) updateData.sessionId = payload.sessionId;

    await db.update(runs).set(updateData).where(eq(runs.id, id));
    return this.findRunById(id);
  },

  async deleteRun(id: string): Promise<void> {
    const db = getDb();
    await db.delete(runs).where(eq(runs.id, id));
  },

  async deleteRunsByWorkspaceId(workspaceId: string): Promise<void> {
    const db = getDb();
    await db.delete(runs).where(eq(runs.workspaceId, workspaceId));
  },

  /**
   * Deliberately does not touch `updatedAt`. That column is what the chat
   * sidebar prints as the row's age *and* sorts on, so it has to keep meaning
   * "when this conversation last moved". Filing a chat under a project is
   * organizing, not talking — bumping it here made an untouched chat jump to
   * the top reading "now". (Archive/unarchive still bump: the archive list
   * sorts on the same column, and a restored chat has to be findable.)
   */
  async moveToCollection(
    id: string,
    collectionId: string | null,
  ): Promise<RunResponse | null> {
    const db = getDb();
    await db
      .update(runs)
      .set({ collectionId })
      .where(eq(runs.id, id));
    return this.findRunById(id);
  },

  async archiveRun(id: string): Promise<RunResponse | null> {
    const db = getDb();
    await db
      .update(runs)
      .set({ isArchived: true, updatedAt: sql`(unixepoch())` })
      .where(eq(runs.id, id));
    return this.findRunById(id);
  },

  async unarchiveRun(id: string): Promise<RunResponse | null> {
    const db = getDb();
    await db
      .update(runs)
      .set({ isArchived: false, updatedAt: sql`(unixepoch())` })
      .where(eq(runs.id, id));
    return this.findRunById(id);
  },

  // ─────────────────────────────────────────────────────────────
  // Run Context Operations
  // ─────────────────────────────────────────────────────────────
  async findContextByRun(runId: string): Promise<RunContextResponse[]> {
    const db = getDb();
    const rows = await db.select().from(runContext).where(eq(runContext.runId, runId));
    return rows.map(mapContextRowToResponse);
  },

  async insertContext(payload: CreateRunContextPayload): Promise<number> {
    const db = getDb();
    const result = await db
      .insert(runContext)
      .values({
        runId: payload.runId,
        kind: payload.kind,
        ref: payload.ref,
        content: payload.content,
        entityId: payload.entityId,
        contentHash: payload.contentHash,
        metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
      })
      .returning({ id: runContext.id });
    return result[0]?.id ?? 0;
  },

  async deleteContext(id: number): Promise<void> {
    const db = getDb();
    await db.delete(runContext).where(eq(runContext.id, id));
  },

  // ─────────────────────────────────────────────────────────────
  // Run Artifact Operations
  // ─────────────────────────────────────────────────────────────
  /**
   * Artifacts are insert-only, so `sinceId` (exclusive) yields just the rows
   * appended since the caller's last sync. Ordered by id (= insertion order).
   */
  async findArtifactsByRun(
    runId: string,
    sinceId?: number,
  ): Promise<RunArtifactResponse[]> {
    const db = getDb();
    const where =
      sinceId != null
        ? and(eq(runArtifacts.runId, runId), gt(runArtifacts.id, sinceId))
        : eq(runArtifacts.runId, runId);
    const rows = await db
      .select()
      .from(runArtifacts)
      .where(where)
      .orderBy(asc(runArtifacts.id));
    return rows.map(mapArtifactRowToResponse);
  },

  async findArtifactById(id: number): Promise<RunArtifactResponse | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(runArtifacts)
      .where(eq(runArtifacts.id, id))
      .limit(1);
    return rows[0] ? mapArtifactRowToResponse(rows[0]) : null;
  },

  async insertArtifact(payload: CreateRunArtifactPayload): Promise<number> {
    const db = getDb();
    const result = await db
      .insert(runArtifacts)
      .values({
        runId: payload.runId,
        kind: payload.kind,
        path: payload.path,
        content: payload.content,
        blobData: payload.blobData,
        entityId: payload.entityId,
        contentHash: payload.contentHash,
        metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
      })
      .returning({ id: runArtifacts.id });
    return result[0]?.id ?? 0;
  },

  async deleteArtifact(id: number): Promise<void> {
    const db = getDb();
    await db.delete(runArtifacts).where(eq(runArtifacts.id, id));
  },


  // ─────────────────────────────────────────────────────────────
  // Tool Call Operations
  // ─────────────────────────────────────────────────────────────
  /**
   * Tool calls are updated in place (status/output), so the incremental cursor
   * is `updatedAt` not `id`. `>=` (not `>`) because `updated_at` is second-grained:
   * a row updated in the same second as the cursor must still be returned, or an
   * in-place update landing in that second would be lost. The cost is that the
   * boundary second is re-fetched each poll; the renderer absorbs it for free —
   * `mergeRunEvents` keeps the existing object when a re-fetched row is
   * value-identical and returns the same array reference when nothing changed,
   * so the overlap causes no re-render (see run-event-mappers.ts).
   */
  async findToolCallsByRun(
    runId: string,
    sinceUpdatedAt?: Date,
  ): Promise<ToolCallResponse[]> {
    const db = getDb();
    const where =
      sinceUpdatedAt != null
        ? and(eq(toolCalls.runId, runId), gte(toolCalls.updatedAt, sinceUpdatedAt))
        : eq(toolCalls.runId, runId);
    const rows = await db
      .select()
      .from(toolCalls)
      .where(where)
      .orderBy(asc(toolCalls.id));
    return rows.map(mapToolCallRowToResponse);
  },

  async insertToolCall(payload: CreateToolCallPayload): Promise<number> {
    const db = getDb();
    const result = await db
      .insert(toolCalls)
      .values({
        accountId: payload.accountId,
        runId: payload.runId,
        providerId: payload.providerId,
        toolCallId: payload.toolId,
        parentToolCallId: payload.parentToolCallId,
        toolName: payload.toolName,
        status: payload.status ?? "queued",
        input: payload.input ? JSON.stringify(payload.input) : null,
        startedAt: payload.startedAt,
        updatedAt: sql`(unixepoch())`,
      })
      .returning({ id: toolCalls.id });
    return result[0]?.id ?? 0;
  },

  async updateToolCall(id: number, payload: UpdateToolCallPayload): Promise<void> {
    const db = getDb();
    const updateData: Record<string, unknown> = {};

    if (payload.status !== undefined) updateData.status = payload.status;
    if (payload.input !== undefined) updateData.input = JSON.stringify(payload.input);
    if (payload.output !== undefined) updateData.output = JSON.stringify(payload.output);
    if (payload.error !== undefined) updateData.error = payload.error;
    if (payload.startedAt !== undefined) updateData.startedAt = payload.startedAt;
    if (payload.endedAt !== undefined) updateData.endedAt = payload.endedAt;
    if (payload.latencyMs !== undefined) updateData.latencyMs = payload.latencyMs;
    if (payload.costMicros !== undefined) updateData.costMicros = payload.costMicros;
    if (payload.metadata !== undefined) {
      // Metadata is extended by multiple owners over a tool call's lifetime
      // (renderer plan decision, then provider completion details). Merge
      // patches so the later completion cannot erase the earlier UI decision.
      updateData.metadata = sql`json_patch(COALESCE(${toolCalls.metadata}, '{}'), ${JSON.stringify(payload.metadata)})`;
    }
    updateData.updatedAt = sql`(unixepoch())`;

    await db.update(toolCalls).set(updateData).where(eq(toolCalls.id, id));
  },

  // ─────────────────────────────────────────────────────────────
  // Run Turn Operations
  // ─────────────────────────────────────────────────────────────
  async findTurnsByRun(runId: string): Promise<RunTurnResponse[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(runTurns)
      .where(eq(runTurns.runId, runId))
      .orderBy(asc(runTurns.turnIndex));
    return rows.map(mapTurnRowToResponse);
  },

  async findActiveTurnByRun(runId: string): Promise<RunTurnResponse | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(runTurns)
      .where(and(eq(runTurns.runId, runId), eq(runTurns.status, "active")))
      .orderBy(desc(runTurns.turnIndex))
      .limit(1);
    return rows[0] ? mapTurnRowToResponse(rows[0]) : null;
  },

  async insertTurn(payload: CreateRunTurnPayload): Promise<number> {
    const db = getDb();
    const result = await db
      .insert(runTurns)
      .values({
        runId: payload.runId,
        turnIndex: payload.turnIndex,
        promptContent: payload.promptContent,
        startedAt: payload.startedAt ?? new Date(),
        status: "active",
      })
      .returning({ id: runTurns.id });
    return result[0]?.id ?? 0;
  },

  async updateTurn(id: number, payload: UpdateRunTurnPayload): Promise<void> {
    const db = getDb();
    const updateData: Record<string, unknown> = {};

    if (payload.responseContent !== undefined) updateData.responseContent = payload.responseContent;
    if (payload.endedAt !== undefined) updateData.endedAt = payload.endedAt;
    if (payload.elapsedMs !== undefined) updateData.elapsedMs = payload.elapsedMs;
    if (payload.status !== undefined) updateData.status = payload.status;
    if (payload.inputTokens !== undefined) updateData.inputTokens = payload.inputTokens;
    if (payload.outputTokens !== undefined) updateData.outputTokens = payload.outputTokens;
    if (payload.cacheReadTokens !== undefined) updateData.cacheReadTokens = payload.cacheReadTokens;
    if (payload.cacheWriteTokens !== undefined) updateData.cacheWriteTokens = payload.cacheWriteTokens;
    if (payload.costMicros !== undefined) updateData.costMicros = payload.costMicros;
    if (payload.model !== undefined) updateData.model = payload.model;
    if (payload.modelUsage !== undefined) updateData.modelUsage = JSON.stringify(payload.modelUsage);
    if (payload.metadata !== undefined) updateData.metadata = JSON.stringify(payload.metadata);

    await db.update(runTurns).set(updateData).where(eq(runTurns.id, id));
  },

  async patchTurnMetadata(
    id: number,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const db = getDb();
    await db
      .update(runTurns)
      .set({
        metadata: sql`json_patch(COALESCE(${runTurns.metadata}, '{}'), ${JSON.stringify(metadata)})`,
      })
      .where(eq(runTurns.id, id));
  },

  async appendResponseContent(id: number, content: string): Promise<void> {
    const db = getDb();
    await db
      .update(runTurns)
      .set({
        responseContent: sql`COALESCE(${runTurns.responseContent}, '') || ${content}`,
      })
      .where(eq(runTurns.id, id));
  },

  async deleteTurnsByRun(runId: string): Promise<void> {
    const db = getDb();
    await db.delete(runTurns).where(eq(runTurns.runId, runId));
  },
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function mapRunRowToResponse(row: typeof runs.$inferSelect): RunResponse {
  return {
    id: row.id,
    accountId: row.accountId,
    workspaceId: row.workspaceId,
    collectionId: row.collectionId,
    spaceId: row.spaceId,
    providerId: row.providerId,
    mode: row.mode,
    model: row.model,
    title: row.title,
    goal: row.goal,
    status: row.status,
    systemPrompt: row.systemPrompt,
    configSnapshot: safeJsonParse(row.configSnapshot),
    toolPolicySnapshot: safeJsonParse(row.toolPolicySnapshot),
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    lastError: row.lastError,
    stopReason: row.stopReason,
    sessionId: row.sessionId,
    isArchived: row.isArchived,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapContextRowToResponse(row: typeof runContext.$inferSelect): RunContextResponse {
  return {
    id: row.id,
    runId: row.runId,
    kind: row.kind,
    ref: row.ref,
    content: row.content,
    entityId: row.entityId,
    contentHash: row.contentHash,
    metadata: safeJsonParse(row.metadata),
    createdAt: row.createdAt,
  };
}

function mapArtifactRowToResponse(row: typeof runArtifacts.$inferSelect): RunArtifactResponse {
  return {
    id: row.id,
    runId: row.runId,
    kind: row.kind,
    path: row.path,
    content: row.content,
    blobData: row.blobData as Buffer | null,
    entityId: row.entityId,
    contentHash: row.contentHash,
    metadata: safeJsonParse(row.metadata),
    createdAt: row.createdAt,
  };
}

function mapTurnRowToResponse(row: typeof runTurns.$inferSelect): RunTurnResponse {
  return {
    id: row.id,
    runId: row.runId,
    turnIndex: row.turnIndex,
    promptContent: row.promptContent,
    responseContent: row.responseContent,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    elapsedMs: row.elapsedMs,
    status: row.status,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    costMicros: row.costMicros,
    model: row.model,
    modelUsage: safeJsonParse(row.modelUsage),
    metadata: safeJsonParse(row.metadata),
    createdAt: row.createdAt,
  };
}

function mapToolCallRowToResponse(row: typeof toolCalls.$inferSelect): ToolCallResponse {
  return {
    id: row.id,
    accountId: row.accountId,
    runId: row.runId,
    providerId: row.providerId,
    toolId: row.toolCallId,
    parentToolCallId: row.parentToolCallId,
    toolName: row.toolName,
    status: row.status,
    input: safeJsonParse(row.input),
    output: safeJsonParse(row.output),
    error: row.error,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    latencyMs: row.latencyMs,
    costMicros: row.costMicros,
    metadata: safeJsonParse(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
