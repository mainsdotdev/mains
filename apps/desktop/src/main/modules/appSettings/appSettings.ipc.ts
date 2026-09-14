import { ipcMain } from "../../ipc-kit/ipc-main";
import { handle } from "../../ipc-kit/handle";
import { appSettingsService } from "./appSettings.service";
import { CHANNELS } from "../../../shared/ipc-kit/channels";

// ─────────────────────────────────────────────────────────────
// IPC Handlers — call service directly. appSettings has no
// controller layer because there's no coordination to add over
// the service (see CONTEXT.md "App settings").
// ─────────────────────────────────────────────────────────────
export function registerAppSettingsIpc() {
  ipcMain.handle(
    CHANNELS.appSettings.get,
    handle(() => appSettingsService.getSettings()),
  );
  ipcMain.handle(
    CHANNELS.appSettings.update,
    handle((patch: unknown) => appSettingsService.updateSettings(patch)),
  );
}

export function unregisterAppSettingsIpc() {
  ipcMain.removeHandler(CHANNELS.appSettings.get);
  ipcMain.removeHandler(CHANNELS.appSettings.update);
}
