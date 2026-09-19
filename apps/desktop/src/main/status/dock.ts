import { app, Menu } from "electron";
import { statusActions } from "./status-actions";
import { subscribeStatus } from "./status-feed";
import { buildDockMenu } from "./status-menus";

/**
 * The Dock icon's right-click menu. macOS reads it ahead of time (there is no
 * "about to open" hook to build it in), so it is replaced whenever the status
 * changes. Independent of the menu bar icon: it works with that one hidden.
 */

let unsubscribe: (() => void) | null = null;

export function startDockMenu(): void {
  if (unsubscribe || process.platform !== "darwin" || !app.dock) return;
  const dock = app.dock;
  unsubscribe = subscribeStatus((snapshot) => {
    dock.setMenu(Menu.buildFromTemplate(buildDockMenu(snapshot, statusActions)));
  });
}

export function stopDockMenu(): void {
  unsubscribe?.();
  unsubscribe = null;
}
