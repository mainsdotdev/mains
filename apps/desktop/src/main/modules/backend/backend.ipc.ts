import { ipcMain } from "../../ipc-kit/ipc-main";
import type { IpcInvokeContext } from "../../ipc-kit";
import { CHANNELS } from "../../../shared/ipc-kit/channels";
import { ok, fail } from "../../../shared/ipc-kit/service-response";
import { backendService } from "./backend.service";

// Registered through the ipcMain shim (not raw Electron ipcMain) so the handler
// lands in the registry the WS router serves: a phone or another mains reaches
// `backend:describe` over the wire, and it is the first thing they ask.
//
// Hand-written rather than `handle()`: the invoke context says whether the
// caller is a paired device, whose descriptor lists only what it may use.
export function registerBackendIpc() {
  ipcMain.handle(CHANNELS.backend.describe, async (ctx: IpcInvokeContext) => {
    try {
      return ok(
        await backendService.describe({ pairedDevice: Boolean(ctx?.deviceId) }),
      );
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : "Failed to describe backend",
      );
    }
  });
}

export function unregisterBackendIpc() {
  ipcMain.removeHandler(CHANNELS.backend.describe);
}
