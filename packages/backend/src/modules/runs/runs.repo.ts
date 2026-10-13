import { randomUUID } from "crypto";
import { eq, desc, and, sql, asc, gt, gte, inArray, getTableColumns } from "drizzle-orm";
import { getDb } from "../../db/client";
import { safeJsonParse } from "../../db/utils";
import type { ReadRunHistoryContentPayload, ReadRunHistoryPayload, RunHistoryContentPage, RunHistoryCursor } from "@mains/contracts/runs";
import { historyEndAfter } from "@mains/contracts/run-history";
import { historyWindow, compareHistoryCursors as compareCursor } from "./run-history";
import type { SQLWrapper, SQL } from "drizzle-orm";
import {
  runs,
  runContext,
  runArtifacts,
  runAttachments,
  runAttachmentRefs,
  toolCalls,
  runTurns,
  runTurnChanges,
} from "../../db/schema";
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
  RunHistoryPage,
  RunTurnChangesSummary,
  RunTurnChangesDiffResponse,
  CreateRunTurnChangesPayload,
  TurnFileChange,
  RunExperienceOptions,
  WorkspaceRunListOptions,
} from "./runs.dto";

// ─────────────────────────────────────────────────────────────
// Runs Repository
// ─────────────────────────────────────────────────────────────
export const runsRepo = {
  findHistoryPage(request: ReadRunHistoryPayload): RunHistoryPage {
    const db = getDb();
    return db.transaction(() => {
      if (request.profile === "mobile") return findMobileHistoryPage(db, request);
      // Read only chronological keys for navigation, never historical bodies.
      const timeline = sql`SELECT ${artifactHistoryTime} AS timestamp, 'artifact' AS source, id FROM run_artifacts WHERE run_id = ${request.runId}
        UNION ALL SELECT created_at * 1000 AS timestamp, 'tool' AS source, id FROM tool_calls WHERE run_id = ${request.runId}`;
      const first = db.get<RunHistoryCursor>(sql`SELECT * FROM (${timeline}) ORDER BY timestamp, source, id LIMIT 1`);
      const last = db.get<RunHistoryCursor>(sql`SELECT * FROM (${timeline}) ORDER BY timestamp DESC, source DESC, id DESC LIMIT 1`);
      const anchors = db.all<RunHistoryCursor>(sql`SELECT ${artifactHistoryTime} AS timestamp, 'artifact' AS source, id
        FROM run_artifacts WHERE run_id = ${request.runId} AND kind = 'user-prompt' ORDER BY timestamp, id`);
      if (first && (!anchors[0] || compareCursor(first, anchors[0]) < 0)) anchors.unshift(first);
      const range = historyWindow(anchors, request);
      const artifacts = range.start ? db.select().from(runArtifacts).where(and(eq(runArtifacts.runId, request.runId),
        historyCut(artifactHistoryTime, "artifact", runArtifacts.id, range.start, false),
        range.end ? historyCut(artifactHistoryTime, "artifact", runArtifacts.id, range.end, true) : undefined)).all() : [];
      const calls = range.start ? db.select({ ...getTableColumns(toolCalls),
        ...(request.deferToolOutput ? { output: sql<string | null>`CASE
          WHEN lower(${toolCalls.toolName}) IN ('read', 'bash', 'shell')
            AND ${toolCalls.status} IN ('done', 'error', 'canceled')
            AND length(${toolCalls.output}) > 16384
            AND json_type(CASE WHEN json_valid(${toolCalls.metadata}) THEN ${toolCalls.metadata} ELSE '{}' END, '$.mcpApp') IS NULL
          THEN json_object('type', 'mains/deferred-tool-output', 'chars', length(${toolCalls.output}),
            'preview', substr(${toolCalls.output}, 1, 2000)) ELSE ${toolCalls.output} END` } : {}),
      }).from(toolCalls).where(and(eq(toolCalls.runId, request.runId),
        historyCut(sql`${toolCalls.createdAt} * 1000`, "tool", toolCalls.id, range.start, false),
        range.end ? historyCut(sql`${toolCalls.createdAt} * 1000`, "tool", toolCalls.id, range.end, true) : undefined)).all() : [];
      return {
        artifacts: artifacts.map(mapArtifactRowToResponse),
        toolCalls: calls.map(mapToolCallRowToResponse),
        turns: range.start ? selectRunTurns(request.runId, range.start, range.end) : [],
        ...range,
        last: last ?? null,
        hasOlder: !!(first && range.start && compareCursor(first, range.start) < 0),
        hasNewer: !!(last && range.end && compareCursor(last, range.end) >= 0),
      };
    });
  },
  findHistoryContent(request: ReadRunHistoryContentPayload): RunHistoryContentPage | null {
    const offset = request.offset ?? 0;
    const column = request.source === "artifact" ? runArtifacts.content
      : request.source === "tool-input" ? toolCalls.input : toolCalls.output;
    const table = request.source === "artifact" ? runArtifacts : toolCalls;
    const row = getDb().select({ text: sql<string>`coalesce(substr(${column}, ${offset + 1}, 8192), '')`,
      totalChars: sql<number>`coalesce(length(${column}), 0)` }).from(table)
      .where(and(eq(table.runId, request.runId), eq(table.id, request.id))).get();
    return row ? { ...row, offset, nextOffset: offset + 8192 < row.totalChars ? offset + 8192 : null } : null;
  },
  findToolOutput(runId: string, toolId: number): { output: unknown } | null {
    const row = getDb().select({ output: toolCalls.output }).from(toolCalls)
      .where(and(eq(toolCalls.runId, runId), eq(toolCalls.id, toolId))).get();
    return row ? { output: safeJsonParse(row.output) } : null;
  },
  // Originals have run-owned references, independent of transcript row deletion.
  listAttachments(runId: string) {
    return getDb().select({ attachment: runAttachments }).from(runAttachments)
      .innerJoin(runAttachmentRefs, eq(runAttachments.id, runAttachmentRefs.attachmentId))
      .where(eq(runAttachmentRefs.runId, runId)).all().map((row) => row.attachment);
  },

  listAttachmentPromptMetadata(runId: string) {
    const db = getDb();
    const ids = db.select({ id: runAttachmentRefs.attachmentId }).from(runAttachmentRefs)
      .where(eq(runAttachmentRefs.runId, runId));
    // Include the original conversation for references inherited by a fork.
    const owners = db.select({ id: runAttachmentRefs.runId }).from(runAttachmentRefs)
      .where(inArray(runAttachmentRefs.attachmentId, ids));
    return db.select({ metadata: runArtifacts.metadata }).from(runArtifacts)
      .where(and(sql`${runArtifacts.kind} = 'user-prompt'`, inArray(runArtifacts.runId, owners)))
      .all().map((row) => safeJsonParse<Record<string, unknown>>(row.metadata));
  },

  findAttachment(runId: string, attachmentId: string) {
    return getDb().select({ attachment: runAttachments }).from(runAttachments)
      .innerJoin(runAttachmentRefs, eq(runAttachments.id, runAttachmentRefs.attachmentId))
      .where(and(eq(runAttachmentRefs.runId, runId), eq(runAttachments.id, attachmentId)))
      .get()?.attachment ?? null;
  },

  findAttachmentForInput(runId: string, inputKey: string, ordinal: number) {
    return getDb().select({ attachment: runAttachments }).from(runAttachments)
      .innerJoin(runAttachmentRefs, eq(runAttachments.id, runAttachmentRefs.attachmentId))
      .where(and(eq(runAttachmentRefs.runId, runId), eq(runAttachmentRefs.inputKey, inputKey), eq(runAttachmentRefs.ordinal, ordinal)))
      .get()?.attachment ?? null;
  },

  findStoredAttachment(id: string) {
    return getDb().select().from(runAttachments).where(eq(runAttachments.id, id)).get() ?? null;
  },

  retainAttachment(runId: string, inputKey: string, ordinal: number, attachment: typeof runAttachments.$inferInsert) {
    getDb().transaction((tx) => {
      tx.insert(runAttachments).values(attachment).onConflictDoNothing().run();
      tx.insert(runAttachmentRefs).values({ runId, attachmentId: attachment.id, inputKey, ordinal }).onConflictDoNothing().run();
    });
  },

  inheritAttachmentRefs(sourceRunId: string, runId: string) {
    getDb().transaction((tx) => {
      if (!tx.select({ id: runs.id }).from(runs).where(eq(runs.id, sourceRunId)).get()) throw new Error("Source run not found");
      const refs = tx.select().from(runAttachmentRefs).where(eq(runAttachmentRefs.runId, sourceRunId)).all();
      for (const { attachmentId } of refs) {
        tx.insert(runAttachmentRefs).values({ runId, attachmentId, inputKey: `fork:${sourceRunId}:${attachmentId}`, ordinal: 0 }).onConflictDoNothing().run();
      }
    });
  },

  listUnreferencedAttachments() {
    return getDb().select().from(runAttachments)
      .where(sql`NOT EXISTS (SELECT 1 FROM run_attachment_refs WHERE attachment_id = ${runAttachments.id})`).limit(100).all();
  },

  claimUnreferencedAttachment(id: string) {
    return getDb().delete(runAttachments).where(and(eq(runAttachments.id, id),
      sql`NOT EXISTS (SELECT 1 FROM run_attachment_refs WHERE attachment_id = ${runAttachments.id})`))
      .returning().get() ?? null;
  },

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
   *
   * Pinned first — SQLite sorts NULLs last under DESC, so the ordering falls
   * out of the column itself. It also keeps a pinned chat inside the `limit`
   * window: pinning is a promise that the chat stays reachable, and one that
   * had gone quiet enough to fall past the cut would otherwise vanish from the
   * group the user pinned it into.
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
          options.spaceId ? eq(runs.spaceId, options.spaceId) : undefined,
          options.atlasPageId
            ? sql`json_extract(${runs.configSnapshot}, '$.atlasPageId') = ${options.atlasPageId}`
            : undefined,
        ),
      )
      .orderBy(...(options.atlasPageId
        ? [desc(runs.updatedAt), desc(runs.createdAt), desc(runs.id)]
        : [desc(runs.pinnedAt), desc(runs.updatedAt)]))
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

  async findRunIdsByWorkspaceId(workspaceId: string): Promise<string[]> {
    const rows = await getDb()
      .select({ id: runs.id })
      .from(runs)
      .where(eq(runs.workspaceId, workspaceId));
    return rows.map((row) => row.id);
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

  async updateRun(id: string, payload: UpdateRunPayload, options: { preserveConversationSettings?: boolean } = {}): Promise<RunResponse | null> {
    const db = getDb();
    // Remembering a composer preference is not new transcript activity.
    const settingsOnly = payload.conversationSettings !== undefined && Object.keys(payload).every((key) => key === "conversationSettings");
    const updateData: Record<string, unknown> = settingsOnly ? {} : { updatedAt: sql`(unixepoch())` };

    if (payload.title !== undefined) updateData.title = payload.title;
    if (payload.goal !== undefined) updateData.goal = payload.goal;
    if (payload.status !== undefined) updateData.status = payload.status;
    if (payload.model !== undefined) updateData.model = payload.model;
    if (payload.systemPrompt !== undefined) updateData.systemPrompt = payload.systemPrompt;
    if (payload.configSnapshot !== undefined) {
      updateData.configSnapshot = JSON.stringify(payload.configSnapshot);
      if (options.preserveConversationSettings) {
        // A queued message uses its captured settings; later composer edits
        // remain the preferences for the following message.
        updateData.configSnapshot = sql`json_set(${JSON.stringify(payload.configSnapshot)}, '$.conversationSettings',
          json(coalesce(json_extract(${runs.configSnapshot}, '$.conversationSettings'),
            json_extract(${JSON.stringify(payload.configSnapshot)}, '$.conversationSettings'))))`;
      }
    }
    if (payload.conversationSettings !== undefined) {
      updateData.configSnapshot = sql`json_set(coalesce(${updateData.configSnapshot ?? runs.configSnapshot}, '{}'),
        '$.conversationSettings', json(${JSON.stringify(payload.conversationSettings)}))`;
    }
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

  /**
   * Leaves `updatedAt` alone for the same reason `moveToCollection` does:
   * pinning is organizing, not talking, and bumping the column would shoot an
   * untouched chat to the top of the sidebar reading "now".
   */
  async setPinned(
    id: string,
    pinnedAt: Date | null,
  ): Promise<RunResponse | null> {
    const db = getDb();
    await db
      .update(runs)
      .set({ pinnedAt })
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
   * Artifact bodies are append-only; report phases can be confirmed later.
   * `sinceId` yields new rows only. History refreshes also read phase changes.
   * Ordered by id (= insertion order).
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

  findOutputArtifactKeys(runId: string): RunArtifactResponse[] {
    return getDb().select({ ...getTableColumns(runArtifacts), blobData: sql<null>`NULL`,
      content: sql<string | null>`CASE WHEN ${runArtifacts.kind} = 'user-prompt' THEN ${runArtifacts.content}
        WHEN ${runArtifacts.kind} = 'report' AND length(trim(${runArtifacts.content})) > 0 THEN '[message]' ELSE NULL END` })
      .from(runArtifacts).where(and(eq(runArtifacts.runId, runId),
        sql`${runArtifacts.kind} IN ('report', 'user-prompt', 'image', 'document', 'file')`))
      .orderBy(asc(runArtifacts.id)).all().map(mapArtifactRowToResponse);
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

  async setReportMessagePhase(
    runId: string,
    messageId: string,
    phase: "commentary" | "partial_answer" | "final_answer",
  ): Promise<boolean> {
    const rows = await getDb().update(runArtifacts).set({
      metadata: sql`json_patch(COALESCE(${runArtifacts.metadata}, '{}'), ${JSON.stringify({ messagePhase: phase })})`,
    }).where(and(
      eq(runArtifacts.runId, runId),
      eq(runArtifacts.kind, "report"),
      sql`json_extract(${runArtifacts.metadata}, '$.providerMessageId') = ${messageId}`,
      sql`COALESCE(json_extract(${runArtifacts.metadata}, '$.isFromSubagent'), 0) = 0`,
    )).returning({ id: runArtifacts.id });
    return rows.length > 0;
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

  /** Claude resume correlation, without reading historical tool inputs/outputs. */
  async findClaudeTaskAnchorsByRun(runId: string) {
    const taskId = sql<string | null>`COALESCE(json_extract(${toolCalls.metadata}, '$.task.taskId'), json_extract(${toolCalls.metadata}, '$.subagent.agentId'))`;
    return getDb().select({
      toolUseId: toolCalls.toolCallId,
      taskId,
      providerRunId: sql<string | null>`json_extract(${toolCalls.metadata}, '$.task.providerRunId')`,
      parentTaskId: sql<string | null>`json_extract(${toolCalls.metadata}, '$.task.parentTaskId')`,
      taskType: sql<string | null>`json_extract(${toolCalls.metadata}, '$.task.taskType')`,
      subagentType: sql<string | null>`COALESCE(json_extract(${toolCalls.metadata}, '$.task.subagentType'), json_extract(${toolCalls.metadata}, '$.subagent.agentType'))`,
      isBackgrounded: sql<number | null>`json_extract(${toolCalls.metadata}, '$.task.isBackgrounded')`,
      ambient: sql<number | null>`json_extract(${toolCalls.metadata}, '$.task.ambient')`,
      status: sql<string | null>`json_extract(${toolCalls.metadata}, '$.task.status')`,
      phase: sql<string | null>`json_extract(${toolCalls.metadata}, '$.task.phase')`,
    }).from(toolCalls).where(and(eq(toolCalls.runId, runId), sql`${taskId} IS NOT NULL`, sql`${toolCalls.toolCallId} IS NOT NULL`))
      .orderBy(asc(toolCalls.id));
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
    if (payload.parentToolCallId !== undefined) updateData.parentToolCallId = payload.parentToolCallId;
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
    return selectRunTurns(runId);
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

  // ─────────────────────────────────────────────────────────────
  // Run Turn Changes
  // ─────────────────────────────────────────────────────────────
  async findTurnChangesByWorkspace(workspaceId: string, limit: number) {
    return getDb()
      .select({
        id: runTurnChanges.id,
        runId: runTurnChanges.runId,
        turnId: runTurnChanges.turnId,
        filesJson: runTurnChanges.filesJson,
        undoneAt: runTurnChanges.undoneAt,
        createdAt: runTurnChanges.createdAt,
        endedAt: runTurns.endedAt,
      })
      .from(runTurnChanges)
      .innerJoin(runs, eq(runTurnChanges.runId, runs.id))
      .innerJoin(runTurns, eq(runTurnChanges.turnId, runTurns.id))
      .where(eq(runs.workspaceId, workspaceId))
      .orderBy(
        desc(runTurns.endedAt),
        desc(runTurnChanges.createdAt),
        desc(runTurnChanges.turnId),
      )
      .limit(limit);
  },

  async findRunIdsWithTurnChanges(runIds: string[]) {
    if (runIds.length === 0) return [];
    return getDb()
      .selectDistinct({ runId: runTurnChanges.runId })
      .from(runTurnChanges)
      .where(inArray(runTurnChanges.runId, runIds));
  },

  async insertTurnChanges(payload: CreateRunTurnChangesPayload): Promise<string> {
    const db = getDb();
    const id = randomUUID();
    await db.insert(runTurnChanges).values({
      id,
      runId: payload.runId,
      turnId: payload.turnId,
      diffText: payload.diffText,
      filesJson: JSON.stringify(payload.files),
      additions: payload.additions,
      deletions: payload.deletions,
      truncated: payload.truncated,
    });
    return id;
  },

  async findTurnChanges(
    runId: string,
    turnId: number,
  ): Promise<RunTurnChangesDiffResponse | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(runTurnChanges)
      .where(and(eq(runTurnChanges.runId, runId), eq(runTurnChanges.turnId, turnId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { ...mapTurnChangesSummary(row), diffText: row.diffText };
  },

  async markTurnChangesUndone(id: string, undoneAt: Date): Promise<void> {
    const db = getDb();
    await db
      .update(runTurnChanges)
      .set({ undoneAt })
      .where(eq(runTurnChanges.id, id));
  },
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
// Voice transcripts retain the time speech began, rather than finalization.
const artifactHistoryTime = sql`CASE WHEN json_valid(${runArtifacts.metadata})
  AND json_extract(${runArtifacts.metadata}, '$.voice') = 1
  AND json_type(${runArtifacts.metadata}, '$.voiceStartedAt') IN ('integer', 'real')
  THEN CAST(json_extract(${runArtifacts.metadata}, '$.voiceStartedAt') AS INTEGER)
  ELSE ${runArtifacts.createdAt} * 1000 END`;

const MOBILE_HISTORY_ROWS = 200;
const MOBILE_HISTORY_BYTES = 1024 * 1024 - 16 * 1024;

/** Bound bodies in SQL, before SQLite materializes them or JSON is parsed. */
function mobileJson(column: SQLWrapper): SQL<string | null> {
  return sql`CASE WHEN length(${column}) > 16384
    THEN json_object('type', 'mains/deferred-tool-output', 'chars', length(${column}), 'preview', substr(${column}, 1, 2000))
    ELSE ${column} END`;
}

function mobileMetadata(column: SQLWrapper): SQL<string | null> {
  return sql`CASE WHEN length(${column}) <= 16384 THEN ${column}
    WHEN json_valid(${column}) THEN json_object(
      'source', substr(json_extract(${column}, '$.source'), 1, 512),
      'isFromSubagent', json(CASE WHEN json_extract(${column}, '$.isFromSubagent') = 1 THEN 'true' ELSE 'false' END),
      'parentToolUseId', substr(json_extract(${column}, '$.parentToolUseId'), 1, 512),
      'voice', json(CASE WHEN json_extract(${column}, '$.voice') = 1 THEN 'true' ELSE 'false' END),
      'voiceStartedAt', CASE WHEN json_type(${column}, '$.voiceStartedAt') IN ('integer', 'real')
        THEN json_extract(${column}, '$.voiceStartedAt') ELSE NULL END)
    ELSE NULL END`;
}

/** A prompt can contain unbounded tools: phone navigation uses chronological rows. */
function findMobileHistoryPage(db: ReturnType<typeof getDb>, request: ReadRunHistoryPayload): RunHistoryPage {
  const timeline = sql`SELECT ${artifactHistoryTime} AS timestamp, 'artifact' AS source, id FROM run_artifacts WHERE run_id = ${request.runId}
    UNION ALL SELECT created_at * 1000 AS timestamp, 'tool' AS source, id FROM tool_calls WHERE run_id = ${request.runId}`;
  const first = db.get<RunHistoryCursor>(sql`SELECT * FROM (${timeline}) ORDER BY timestamp, source, id LIMIT 1`);
  const last = db.get<RunHistoryCursor>(sql`SELECT * FROM (${timeline}) ORDER BY timestamp DESC, source DESC, id DESC LIMIT 1`);
  const newer = request.direction === "newer";
  const lower = newer || request.direction === "refresh" ? request.cursor : undefined;
  const upper = request.direction === "older" ? request.cursor : request.direction === "refresh" ? request.end : undefined;
  const time = sql`timestamp`, id = sql`id`;
  const keyCut = (cursor: RunHistoryCursor, before: boolean) => {
    const rank = Number(cursor.source === "tool");
    const currentRank = sql`CASE source WHEN 'tool' THEN 1 ELSE 0 END`;
    return before
      ? sql`(${time} < ${cursor.timestamp} OR (${time} = ${cursor.timestamp} AND (${currentRank} < ${rank} OR (${currentRank} = ${rank} AND ${id} < ${cursor.id}))))`
      : sql`(${time} > ${cursor.timestamp} OR (${time} = ${cursor.timestamp} AND (${currentRank} > ${rank} OR (${currentRank} = ${rank} AND ${id} >= ${cursor.id}))))`;
  };
  const order = newer ? sql`timestamp, source, id` : sql`timestamp DESC, source DESC, id DESC`;
  const keys = db.all<RunHistoryCursor>(sql`SELECT * FROM (${timeline}) WHERE ${and(
    lower ? keyCut(lower, false) : undefined, upper ? keyCut(upper, true) : undefined,
  ) ?? sql`1 = 1`} ORDER BY ${order} LIMIT ${MOBILE_HISTORY_ROWS}`);
  const artifactIds = keys.filter((key) => key.source === "artifact").map((key) => key.id);
  const toolIds = keys.filter((key) => key.source === "tool").map((key) => key.id);
  const metadata = mobileMetadata(runArtifacts.metadata);
  const artifacts = artifactIds.length ? db.select({ ...getTableColumns(runArtifacts),
    blobData: sql<Buffer | null>`NULL`, path: sql<string | null>`substr(${runArtifacts.path}, 1, 8192)`,
    content: sql<string | null>`substr(${runArtifacts.content}, 1, 8192)`,
    metadata: sql<string | null>`CASE WHEN length(${runArtifacts.content}) > 8192
      THEN json_set(CASE WHEN json_valid(${metadata}) THEN ${metadata} ELSE '{}' END,
        '$.mobileContentDeferred', json_object('chars', length(${runArtifacts.content}))) ELSE ${metadata} END`,
  }).from(runArtifacts).where(and(eq(runArtifacts.runId, request.runId), inArray(runArtifacts.id, artifactIds))).all().map(mapArtifactRowToResponse) : [];
  const calls = toolIds.length ? db.select({ ...getTableColumns(toolCalls), input: mobileJson(toolCalls.input),
    output: mobileJson(toolCalls.output), metadata: mobileMetadata(toolCalls.metadata),
    error: sql<string | null>`substr(${toolCalls.error}, 1, 8192)`,
    toolName: sql<string>`substr(${toolCalls.toolName}, 1, 512)`,
  }).from(toolCalls).where(and(eq(toolCalls.runId, request.runId), inArray(toolCalls.id, toolIds))).all().map(mapToolCallRowToResponse) : [];
  const byKey = new Map<string, RunArtifactResponse | ToolCallResponse>([
    ...artifacts.map((row) => [`artifact:${row.id}`, row] as const),
    ...calls.map((row) => [`tool:${row.id}`, row] as const),
  ]);
  // Rows are small, but many near-threshold rows or escaped Unicode can still
  // exceed the byte budget. Stop at a boundary that the next request can cross.
  let bytes = 0;
  const kept: RunHistoryCursor[] = [];
  for (const key of keys) {
    const row = byKey.get(`${key.source}:${key.id}`)!;
    const size = Buffer.byteLength(JSON.stringify(row));
    if (bytes + size > MOBILE_HISTORY_BYTES) break;
    bytes += size;
    kept.push(key);
  }
  if (newer) kept.sort(compareCursor);
  else kept.reverse();
  const keep = new Set(kept.map((key) => `${key.source}:${key.id}`));
  const start = kept[0] ?? null;
  const end = newer && kept.length && last && compareCursor(kept.at(-1)!, last) < 0
    ? historyEndAfter(kept.at(-1)!) : upper ?? null;
  // The phone uses the latest turn's model for legacy conversations. Keep the
  // small execution metadata, without a second copy of prompt/response bodies.
  const latestTurn = db.select({ ...getTableColumns(runTurns),
    promptContent: sql<string | null>`NULL`, responseContent: sql<string | null>`NULL`,
    metadata: sql<string | null>`NULL`, modelUsage: sql<string | null>`NULL`,
  }).from(runTurns).where(eq(runTurns.runId, request.runId)).orderBy(desc(runTurns.turnIndex)).limit(1).all();
  return { artifacts: artifacts.filter((row) => keep.has(`artifact:${row.id}`)),
    toolCalls: calls.filter((row) => keep.has(`tool:${row.id}`)), turns: latestTurn.map((row) => mapTurnRowToResponse(row)), start, end, last: last ?? null,
    hasOlder: !!(first && start && compareCursor(first, start) < 0),
    hasNewer: !!(last && end && compareCursor(last, end) >= 0) };
}

function historyCut(time: SQL, source: RunHistoryCursor["source"], id: SQLWrapper, cursor: RunHistoryCursor, before: boolean): SQL {
  const rank = Number(source === "tool"), boundaryRank = Number(cursor.source === "tool");
  return before
    ? sql`(${time} < ${cursor.timestamp} OR (${time} = ${cursor.timestamp} AND (${rank} < ${boundaryRank} OR (${rank} = ${boundaryRank} AND ${id} < ${cursor.id}))))`
    : sql`(${time} > ${cursor.timestamp} OR (${time} = ${cursor.timestamp} AND (${rank} > ${boundaryRank} OR (${rank} = ${boundaryRank} AND ${id} >= ${cursor.id}))))`;
}

function selectRunTurns(runId: string, start?: RunHistoryCursor, end?: RunHistoryCursor | null): RunTurnResponse[] {
  const time = sql`coalesce(${runTurns.startedAt}, ${runTurns.createdAt}) * 1000`;
  const rows = getDb().select({
    turn: runTurns,
    changes: { id: runTurnChanges.id, filesJson: runTurnChanges.filesJson, additions: runTurnChanges.additions,
      deletions: runTurnChanges.deletions, truncated: runTurnChanges.truncated, undoneAt: runTurnChanges.undoneAt },
  }).from(runTurns).leftJoin(runTurnChanges, eq(runTurnChanges.turnId, runTurns.id))
    .where(and(eq(runTurns.runId, runId),
      start ? sql`(${time} >= ${start.timestamp} OR ${runTurns.id} = (SELECT id FROM run_turns WHERE run_id = ${runId}
        AND coalesce(started_at, created_at) * 1000 <= ${start.timestamp} ORDER BY turn_index DESC LIMIT 1))` : undefined,
      end ? sql`${time} <= ${end.timestamp}` : undefined))
    .orderBy(asc(runTurns.turnIndex)).all();
  return rows.map((row) => mapTurnRowToResponse(row.turn, row.changes ? mapTurnChangesSummary(row.changes) : null));
}

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
    pinnedAt: row.pinnedAt,
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

function mapTurnChangesSummary(row: {
  id: string;
  filesJson: string;
  additions: number;
  deletions: number;
  truncated: boolean;
  undoneAt: Date | null;
}): RunTurnChangesSummary {
  return {
    id: row.id,
    files: (safeJsonParse(row.filesJson) as TurnFileChange[] | null) ?? [],
    additions: row.additions,
    deletions: row.deletions,
    truncated: row.truncated,
    undoneAt: row.undoneAt,
  };
}

function mapTurnRowToResponse(
  row: typeof runTurns.$inferSelect,
  changes: RunTurnChangesSummary | null = null,
): RunTurnResponse {
  return {
    changes,
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
