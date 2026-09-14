import { ipcMain } from "../../ipc-kit/ipc-main";
import { handle } from "../../ipc-kit/handle";
import { syncService } from "./sync.service";
import { CHANNELS } from "../../../shared/ipc-kit/channels";

// ─────────────────────────────────────────────────────────────
// IPC Handlers - Thin layer, just registers handlers
// ─────────────────────────────────────────────────────────────
export function registerSyncIpc() {
  ipcMain.handle(
    CHANNELS.sync.runEntitySync,
    handle((provider?: string) => syncService.runEntitySync(provider)),
  );

}

export function unregisterSyncIpc() {
  ipcMain.removeHandler(CHANNELS.sync.runEntitySync);
}
