import { openSourceSync } from "./sync-lifecycle";
import { ipcMain } from "../../ipc-kit/ipc-main";
import { handle } from "../../ipc-kit/handle";
import { syncService } from "./sync.service";
import { CHANNELS } from "@mains/contracts/channels";
import type { SetIssueStatusMappingInput } from "@mains/contracts/issue-status";

// ─────────────────────────────────────────────────────────────
// IPC Handlers - Thin layer, just registers handlers
// ─────────────────────────────────────────────────────────────
export function registerSyncIpc() {
  openSourceSync();
  ipcMain.handle(
    CHANNELS.sync.runEntitySync,
    handle((provider?: string) => syncService.runEntitySync(provider)),
  );
  ipcMain.handle(
    CHANNELS.sync.listIssueStates,
    handle((resourceId: string) => syncService.listIssueStates(resourceId)),
  );
  ipcMain.handle(
    CHANNELS.sync.setIssueStatusMapping,
    handle((input: SetIssueStatusMappingInput) => syncService.setIssueStatusMapping(input)),
  );
}

export function unregisterSyncIpc() {
  ipcMain.removeHandler(CHANNELS.sync.runEntitySync);
  ipcMain.removeHandler(CHANNELS.sync.listIssueStates);
  ipcMain.removeHandler(CHANNELS.sync.setIssueStatusMapping);
}
