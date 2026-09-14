import { toolsRepo } from "./tools.repo";
import type {
  CreateToolCallPayload,
  UpdateToolCallPayload,
  ToolCallResponse,
} from "./tools.dto";

// ─────────────────────────────────────────────────────────────
// Tools Service
//
// Throw-style: methods return plain values and throw on failure; the
// ServiceResponse envelope is applied by handle() at the IPC seam.
// See CONTEXT.md "handle".
// ─────────────────────────────────────────────────────────────
export const toolsService = {
  // ─────────────────────────────────────────────────────────────
  // Tool Call Operations
  // ─────────────────────────────────────────────────────────────
  async getToolCallsByRun(runId: string): Promise<ToolCallResponse[]> {
    return toolsRepo.findToolCallsByRun(runId);
  },

  async getToolCallsByAccount(
    accountId: string,
    limit?: number,
  ): Promise<ToolCallResponse[]> {
    return toolsRepo.findToolCallsByAccount(accountId, limit);
  },

  async createToolCall(payload: CreateToolCallPayload): Promise<number> {
    return toolsRepo.insertToolCall(payload);
  },

  /** Row id of a run's tool call by its provider-stable toolCallId. */
  async findToolCallRowId(
    runId: string,
    toolCallId: string,
  ): Promise<number | null> {
    return toolsRepo.findToolCallRowIdByRunAndToolCallId(runId, toolCallId);
  },

  /** Row id of a run's oldest still-open tool call with the given name. */
  async findOpenToolCallRowId(
    runId: string,
    toolName: string,
  ): Promise<number | null> {
    return toolsRepo.findOpenToolCallRowIdByRunAndToolName(runId, toolName);
  },

  async updateToolCall(
    id: number,
    payload: UpdateToolCallPayload,
  ): Promise<void> {
    await toolsRepo.updateToolCall(id, payload);
  },

  async startToolCall(id: number): Promise<void> {
    return this.updateToolCall(id, { status: "running", startedAt: new Date() });
  },

  async completeToolCall(
    id: number,
    output: Record<string, unknown>,
    latencyMs?: number,
  ): Promise<void> {
    return this.updateToolCall(id, {
      status: "done",
      output,
      endedAt: new Date(),
      latencyMs,
    });
  },

  async failToolCall(id: number, error: string): Promise<void> {
    return this.updateToolCall(id, { status: "error", error, endedAt: new Date() });
  },
};
