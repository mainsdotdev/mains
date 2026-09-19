import { ipcMain } from "electron";
import { CHANNELS } from "../../shared/ipc-kit/channels";
import type { WindowRequest } from "../../shared/window-request";
import { handle } from "../ipc-kit/handle";
import { reopenMainWindow } from "./mainWindow";

/** A click only counts if the window asks for it soon after. */
const REQUEST_TTL_MS = 60_000;

let parked: { request: WindowRequest; at: number } | null = null;

/**
 * Bring the window forward and hand it a request (open a run, start a chat, go
 * to a page). The request is parked until the renderer collects it: a window
 * that was closed is still loading when the click lands, so a push alone would
 * arrive before anyone listens. A newer request replaces an uncollected one.
 */
export function requestWindow(request: WindowRequest): void {
  const window = reopenMainWindow();
  if (!window) return;
  parked = { request, at: Date.now() };
  if (!window.isDestroyed()) window.webContents.send(CHANNELS.app.windowRequest);
}

/** Hand the parked request to the window, once. */
export function consumeWindowRequest(): WindowRequest | null {
  const current = parked;
  parked = null;
  if (!current || Date.now() - current.at > REQUEST_TTL_MS) return null;
  return current.request;
}

/**
 * Local Electron IPC only — the click happened on this Mac, so a remote client
 * must never collect it. Deliberately kept off the WebSocket handler registry.
 */
export function registerWindowRequestIpc(): void {
  ipcMain.handle(
    CHANNELS.app.consumeWindowRequest,
    handle(() => consumeWindowRequest()),
  );
}

export function unregisterWindowRequestIpc(): void {
  ipcMain.removeHandler(CHANNELS.app.consumeWindowRequest);
}
