import { CHANNELS } from "@mains/contracts/channels";
import { handle } from "../../ipc-kit/handle";
import { ipcMain } from "../../ipc-kit/ipc-main";
import { bridgeService } from "./bridge.service";
import type { BridgeSignInInput } from "@mains/contracts/bridge-auth";

const id = (value: unknown, label: string) => {
  if (typeof value !== "string" || !value || value.length > 256) throw new Error(`Invalid ${label}`);
  return value;
};
export function registerBridgeIpc(): void {
  ipcMain.handle(CHANNELS.bridge.getAuthStatus, handle(() => bridgeService.getAuthStatus()));
  ipcMain.handle(CHANNELS.bridge.signIn, handle((input: BridgeSignInInput) => bridgeService.signIn(input)));
  ipcMain.handle(CHANNELS.bridge.signOut, handle((removeAccountObjects = false) => { if (typeof removeAccountObjects !== "boolean") throw new Error("Choose whether to remove synced items"); return bridgeService.signOut(removeAccountObjects); }));
  ipcMain.handle(CHANNELS.bridge.refreshAuth, handle(() => bridgeService.refreshAuth()));
  ipcMain.handle(CHANNELS.bridge.approveBackend, handle((input: Parameters<typeof bridgeService.approveBackend>[0]) => bridgeService.approveBackend(input)));
  ipcMain.handle(CHANNELS.bridge.rejectBackend, handle((requestId: string) => bridgeService.rejectBackend(id(requestId, "request id"))));
  ipcMain.handle(CHANNELS.bridge.requestApproval, handle(() => bridgeService.requestApproval()));
  ipcMain.handle(CHANNELS.bridge.revokeBackend, handle((backendId: string) => bridgeService.revokeBackend(id(backendId, "backend id"))));
  ipcMain.handle(CHANNELS.bridge.enterRecoveryCode, handle((code: string) => bridgeService.enterRecoveryCode(id(code, "recovery code"))));
  ipcMain.handle(CHANNELS.bridge.takeRecoveryCode, handle(() => bridgeService.takeRecoveryCode()));
  ipcMain.handle(CHANNELS.bridge.regenerateRecoveryCode, handle(() => bridgeService.regenerateRecoveryCode()));
  ipcMain.handle(CHANNELS.bridge.getStatus, handle(() => bridgeService.getStatus()));
  ipcMain.handle(CHANNELS.bridge.syncNow, handle(() => bridgeService.syncNow()));
  ipcMain.handle(CHANNELS.bridge.getProjectScopes, handle(() => bridgeService.getProjectScopes()));
  ipcMain.handle(CHANNELS.bridge.setProjectLocalOnly, handle((projectId: string, localOnly: boolean) => {
    if (typeof localOnly !== "boolean") throw new Error("Invalid project scope");
    return bridgeService.setProjectLocalOnly(id(projectId, "project id"), localOnly);
  }));
  ipcMain.handle(CHANNELS.bridge.includeLocalHistory, handle(() => bridgeService.includeLocalHistory()));
  ipcMain.handle(CHANNELS.bridge.watchRun, handle((runId: string, watcherId: string) => bridgeService.watchRun(id(runId, "run id"), id(watcherId, "watcher id"))));
  ipcMain.handle(CHANNELS.bridge.unwatchRun, handle((watcherId: string) => bridgeService.unwatchRun(id(watcherId, "watcher id"))));
}
export function unregisterBridgeIpc(): void {
  for (const channel of Object.values(CHANNELS.bridge)) ipcMain.removeHandler(channel);
}
