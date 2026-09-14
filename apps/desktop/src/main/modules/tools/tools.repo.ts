import { eq, asc, desc, and, isNull, sql } from "drizzle-orm";
import { getDb } from "../../db/client";
import { safeJsonParse } from "../../db/utils";
import { toolCalls } from "../../db/schema";
import type {
  CreateToolCallPayload,
  UpdateToolCallPayload,
  ToolCallResponse,
} from "./tools.dto";

// ─────────────────────────────────────────────────────────────
// Tools Repository
// ─────────────────────────────────────────────────────────────
export const toolsRepo = {
  // ─────────────────────────────────────────────────────────────
  // Tool Call Operations
  // ─────────────────────────────────────────────────────────────
  async findToolCallsByRun(runId: string): Promise<ToolCallResponse[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.runId, runId))
      // Monotonic row ids, not second-grained createdAt: consumers (subagent
      // fold, flow ordering) treat this as execution order, and timestamp
      // ties would make it unstable across refetches.
      .orderBy(asc(toolCalls.id));
    return rows.map(mapToolCallRowToResponse);
  },

  async findToolCallsByAccount(
    accountId: string,
    limit = 100,
  ): Promise<ToolCallResponse[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.accountId, accountId))
      .orderBy(desc(toolCalls.createdAt))
      .limit(limit);
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
        toolName: payload.toolName,
        toolCallId: payload.toolCallId ?? null,
        parentToolCallId: payload.parentToolCallId ?? null,
        status: payload.status ?? "queued",
        metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
        input: payload.input ? JSON.stringify(payload.input) : null,
        updatedAt: sql`(unixepoch())`,
      })
      .returning({ id: toolCalls.id });
    return result[0]?.id ?? 0;
  },

  async updateToolCall(
    id: number,
    payload: UpdateToolCallPayload,
  ): Promise<void> {
    const db = getDb();
    const updateData: Record<string, unknown> = {};

    if (payload.status !== undefined) updateData.status = payload.status;
    if (payload.output !== undefined)
      updateData.output = JSON.stringify(payload.output);
    if (payload.error !== undefined) updateData.error = payload.error;
    if (payload.startedAt !== undefined)
      updateData.startedAt = payload.startedAt;
    if (payload.endedAt !== undefined) updateData.endedAt = payload.endedAt;
    if (payload.latencyMs !== undefined)
      updateData.latencyMs = payload.latencyMs;
    if (payload.costMicros !== undefined)
      updateData.costMicros = payload.costMicros;
    if (payload.metadata !== undefined) {
      updateData.metadata = sql`json_patch(COALESCE(${toolCalls.metadata}, '{}'), ${JSON.stringify(payload.metadata)})`;
    }
    updateData.updatedAt = sql`(unixepoch())`;

    await db.update(toolCalls).set(updateData).where(eq(toolCalls.id, id));
  },

  async findToolCallRowIdByRunAndToolCallId(
    runId: string,
    toolCallId: string,
  ): Promise<number | null> {
    const db = getDb();
    const rows = await db
      .select({ id: toolCalls.id })
      .from(toolCalls)
      .where(
        and(eq(toolCalls.runId, runId), eq(toolCalls.toolCallId, toolCallId)),
      )
      .limit(1);

    return rows[0]?.id ?? null;
  },

  async findOpenToolCallRowIdByRunAndToolName(
    runId: string,
    toolName: string,
  ): Promise<number | null> {
    const db = getDb();
    const rows = await db
      .select({ id: toolCalls.id })
      .from(toolCalls)
      .where(
        and(
          eq(toolCalls.runId, runId),
          eq(toolCalls.toolName, toolName),
          isNull(toolCalls.endedAt),
        ),
      )
      .orderBy(desc(toolCalls.startedAt))
      .limit(1);

    return rows[0]?.id ?? null;
  },
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function mapToolCallRowToResponse(
  row: typeof toolCalls.$inferSelect,
): ToolCallResponse {
  return {
    id: row.id,
    accountId: row.accountId,
    runId: row.runId,
    providerId: row.providerId,
    toolName: row.toolName,
    toolCallId: row.toolCallId ?? null,
    parentToolCallId: row.parentToolCallId ?? null,
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
  };
}
