import { CHANNELS } from "@mains/contracts/channels";
import { handle } from "../../ipc-kit/handle";
import { ipcMain } from "../../ipc-kit/ipc-main";
import { bridgeService } from "./bridge.service";

const id = (value: unknown, label: string) => {
  if (typeof value !== "string" || !value || value.length > 256) throw new Error(`Invalid ${label}`);
  return value;
};
export function registerBridgeIpc(): void {
  ipcMain.handle(CHANNELS.bridge.getStatus, handle(() => bridgeService.getStatus()));
  ipcMain.handle(CHANNELS.bridge.syncNow, handle(() => bridgeService.syncNow()));
  ipcMain.handle(CHANNELS.bridge.watchRun, handle((runId: string, watcherId: string) => bridgeService.watchRun(id(runId, "run id"), id(watcherId, "watcher id"))));
  ipcMain.handle(CHANNELS.bridge.unwatchRun, handle((watcherId: string) => bridgeService.unwatchRun(id(watcherId, "watcher id"))));
}
export function unregisterBridgeIpc(): void {
  for (const channel of [CHANNELS.bridge.getStatus, CHANNELS.bridge.syncNow, CHANNELS.bridge.watchRun, CHANNELS.bridge.unwatchRun]) ipcMain.removeHandler(channel);
}
