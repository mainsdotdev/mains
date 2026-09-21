import {
  registerHandler,
  unregisterHandler,
  type IpcHandler,
} from "./handler-registry";

export interface IpcMainAdapter {
  handle(channel: string, handler: (...args: any[]) => unknown): void;
  removeHandler(channel: string): void;
}

let localAdapter: IpcMainAdapter | null = null;

/**
 * Attach the Electron IPC adapter. The standalone server deliberately leaves
 * this unset and registers handlers only in the transport-agnostic registry.
 */
export function configureIpcMainAdapter(
  adapter: IpcMainAdapter | null,
): () => void {
  const previous = localAdapter;
  localAdapter = adapter;
  return () => {
    localAdapter = previous;
  };
}

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
 * Electron is supplied as an adapter by the desktop entry point; this module
 * itself has no Electron dependency and is safe to load in the Node server.
 *
 * See docs/design/remote-backend.md (Pillar B).
 */
export const ipcMain = {
  /** Register a handler: into the registry (for WS) and on the real ipcMain (for the renderer). */
  handle(channel: string, handler: IpcHandler): void {
    registerHandler(channel, handler);
    localAdapter?.handle(channel, handler);
  },

  /** Remove a handler from both the registry and the real ipcMain. */
  removeHandler(channel: string): void {
    unregisterHandler(channel);
    localAdapter?.removeHandler(channel);
  },
};
