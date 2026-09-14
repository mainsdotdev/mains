import { ipcMain } from "../../ipc-kit/ipc-main";
import { handle } from "../../ipc-kit/handle";
import { toolsService } from "./tools.service";
import { CHANNELS } from "../../../shared/ipc-kit/channels";
import type {
  CreateToolCallPayload,
  UpdateToolCallPayload,
} from "./tools.dto";

// ─────────────────────────────────────────────────────────────
// IPC Handlers
// ─────────────────────────────────────────────────────────────
export function registerToolsIpc(): void {
  // Tool Calls
  ipcMain.handle(
    CHANNELS.toolCalls.getByRun,
    handle((runId: string) => toolsService.getToolCallsByRun(runId)),
  );

  ipcMain.handle(
    CHANNELS.toolCalls.getByAccount,
    handle((accountId: string, limit?: number) =>
      toolsService.getToolCallsByAccount(accountId, limit),
    ),
  );

  ipcMain.handle(
    CHANNELS.toolCalls.create,
    handle((payload: CreateToolCallPayload) =>
      toolsService.createToolCall(payload),
    ),
  );

  ipcMain.handle(
    CHANNELS.toolCalls.update,
    handle((id: number, payload: UpdateToolCallPayload) =>
      toolsService.updateToolCall(id, payload),
    ),
  );

  ipcMain.handle(
    CHANNELS.toolCalls.start,
    handle((id: number) => toolsService.startToolCall(id)),
  );

  ipcMain.handle(
    CHANNELS.toolCalls.complete,
    handle((id: number, output: Record<string, unknown>, latencyMs?: number) =>
      toolsService.completeToolCall(id, output, latencyMs),
    ),
  );

  ipcMain.handle(
    CHANNELS.toolCalls.fail,
    handle((id: number, error: string) => toolsService.failToolCall(id, error)),
  );
}

export function unregisterToolsIpc(): void {
  [
    CHANNELS.toolCalls.getByRun,
    CHANNELS.toolCalls.getByAccount,
    CHANNELS.toolCalls.create,
    CHANNELS.toolCalls.update,
    CHANNELS.toolCalls.start,
    CHANNELS.toolCalls.complete,
    CHANNELS.toolCalls.fail,
  ].forEach((channel) => ipcMain.removeHandler(channel));
}
