import { ipcMain, type WebContents } from "electron";
import { CHANNELS } from "@mains/contracts/channels";
import type { WindowRequest } from "../../shared/window-request";
import { handle } from "@mains/backend/ipc-kit";
import { getMainWindow, reopenMainWindow } from "./mainWindow";
import { createWindowRequestMailbox } from "../../shared/window-lifecycle";

const mailbox = createWindowRequestMailbox();

/**
 * Bring the window forward and hand it a request (open a run, start a chat, go
 * to a page). The request is parked until the renderer collects it: a window
 * that was closed is still loading when the click lands, so a push alone would
 * arrive before anyone listens. A newer request replaces an uncollected one.
 */
export function requestWindow(request: WindowRequest): void {
  const ticket = mailbox.park(request, Date.now());
  try {
    const window = reopenMainWindow();
    if (!window || window.isDestroyed()) { mailbox.cancel(ticket); return; }
    // A failed ping still leaves the request available for the mount collector.
    try { window.webContents.send(CHANNELS.app.windowRequest); }
    catch (error) { console.error("Unable to notify the window of a pending request:", error); }
  } catch (error) {
    mailbox.cancel(ticket);
    console.error("Unable to reopen the window for a pending request:", error);
  }
}

/** Hand the parked request to the window, once. */
export function consumeWindowRequest(): WindowRequest | null {
  return mailbox.take(Date.now());
}

/**
 * Local Electron IPC only — the click happened on this Mac, so a remote client
 * must never collect it. Deliberately kept off the WebSocket handler registry.
 */
export function registerWindowRequestIpc(): void {
  const consume = handle((sender: WebContents) => {
    if (sender !== getMainWindow()?.webContents) throw new Error("Only the main window can collect window requests");
    return consumeWindowRequest();
  });
  ipcMain.handle(CHANNELS.app.consumeWindowRequest, (event) => consume(event, event.sender));
}

export function unregisterWindowRequestIpc(): void {
  ipcMain.removeHandler(CHANNELS.app.consumeWindowRequest);
}
