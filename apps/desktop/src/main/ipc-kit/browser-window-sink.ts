import { BrowserWindow } from "electron";
import { registerEventSink, type EventSink } from "./event-bus";

/**
 * The local sink: broadcast every event to all open Electron BrowserWindows —
 * exactly what each call site did before the event bus existed.
 *
 * Electron is imported statically here (not in `event-bus.ts`) so the bus itself
 * stays usable in a headless process. Only `src/main/index.ts` pulls this in.
 */
export const browserWindowSink: EventSink = {
  kind: "browser-window",
  send(channel, payload) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  },
};

/**
 * Register the BrowserWindow sink so `emit` reaches the local renderer. Called
 * once at Electron startup. Idempotent (the sink is a singleton, so re-registering
 * is a no-op via the underlying Set). Returns an unregister function.
 */
export function registerBrowserWindowSink(): () => void {
  return registerEventSink(browserWindowSink);
}
