import { ipcMain as electronIpcMain } from "electron";
import {
  registerHandler,
  unregisterHandler,
  type IpcHandler,
} from "./handler-registry";

/**
 * Drop-in replacement for the parts of Electron's `ipcMain` that `*.ipc.ts`
 * modules use (`handle` / `removeHandler`). Every registration is ALSO recorded
 * in the transport-agnostic handler-registry, so the same handlers can be served
 * over WebSocket by a headless `mains serve` process.
 *
 * Migration is a one-line import change per `*.ipc.ts` — the `ipcMain.handle(...)`
 * / `ipcMain.removeHandler(...)` call sites stay byte-for-byte identical:
 *
 *   - import { ipcMain } from "electron";
 *   + import { ipcMain } from "../../ipc-kit/ipc-main";
 *
 * Electron is referenced only inside the methods (never at module load), so
 * importing a `*.ipc.ts` via a barrel does not require Electron to be present —
 * important for unit tests, which import service barrels but never call
 * `registerXxxIpc()`.
 *
 * See docs/design/remote-backend.md (Pillar B).
 */
export const ipcMain = {
  /** Register a handler: into the registry (for WS) and on the real ipcMain (for the renderer). */
  handle(channel: string, handler: IpcHandler): void {
    registerHandler(channel, handler);
    electronIpcMain.handle(
      channel,
      handler as Parameters<typeof electronIpcMain.handle>[1],
    );
  },

  /** Remove a handler from both the registry and the real ipcMain. */
  removeHandler(channel: string): void {
    unregisterHandler(channel);
    electronIpcMain.removeHandler(channel);
  },
};
