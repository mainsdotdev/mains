import { ipcMain } from "@mains/backend/ipc-kit/ipc-main";
import { handle } from "@mains/backend/ipc-kit";
import { CHANNELS } from "@mains/contracts/channels";
import { remoteBackendsService } from "./remoteBackends.service";

export function registerRemoteBackendsIpc(): void {
  ipcMain.handle(
    CHANNELS.remoteBackends.setToken,
    handle((id: string, token: string) => remoteBackendsService.setToken(id, token)),
  );
  ipcMain.handle(
    CHANNELS.remoteBackends.getToken,
    handle((id: string) => remoteBackendsService.getToken(id)),
  );
  ipcMain.handle(
    CHANNELS.remoteBackends.deleteToken,
    handle((id: string) => remoteBackendsService.deleteToken(id)),
  );
}

export function unregisterRemoteBackendsIpc(): void {
  ipcMain.removeHandler(CHANNELS.remoteBackends.setToken);
  ipcMain.removeHandler(CHANNELS.remoteBackends.getToken);
  ipcMain.removeHandler(CHANNELS.remoteBackends.deleteToken);
}
