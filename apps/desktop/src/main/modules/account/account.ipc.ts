import { ipcMain } from "../../ipc-kit/ipc-main";
import { handle } from "../../ipc-kit/handle";
import { accountService } from "./account.service";
import { CHANNELS } from "../../../shared/ipc-kit/channels";

// ─────────────────────────────────────────────────────────────
// IPC Handlers - Thin layer, just registers handlers
// ─────────────────────────────────────────────────────────────
export function registerAccountIpc() {
  ipcMain.handle(
    CHANNELS.account.get,
    handle(() => accountService.getAccount()),
  );
  ipcMain.handle(
    CHANNELS.account.update,
    handle((payload: unknown) => accountService.updateAccount(payload)),
  );
}

export function unregisterAccountIpc() {
  ipcMain.removeHandler(CHANNELS.account.get);
  ipcMain.removeHandler(CHANNELS.account.update);
}
