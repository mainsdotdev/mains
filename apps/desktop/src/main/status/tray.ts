import { Menu, Tray } from "electron";
import { statusActions } from "./status-actions";
import { refreshStatus, subscribeStatus } from "./status-feed";
import {
  buildTrayMenu,
  needsAttention,
  trayTitle,
  trayTooltip,
  type TraySnapshot,
} from "./status-menus";
import { loadTrayIcons, type TrayIcons } from "./tray-icon";

/**
 * The menu bar icon: a live count of running runs, a badge while something
 * waits on the user, and a menu to act on both without opening the window.
 * The menu is built when it opens, from a fresh snapshot, so elapsed times and
 * status lines are never stale.
 */

let tray: Tray | null = null;
let icons: TrayIcons | null = null;
let showingAttention = false;
let unsubscribe: (() => void) | null = null;

/** Title, tooltip and badge — what the menu bar shows without opening the menu. */
function applyToIcon(snapshot: TraySnapshot): void {
  if (!tray || tray.isDestroyed()) return;
  tray.setTitle(trayTitle(snapshot), { fontType: "monospacedDigit" });
  tray.setToolTip(trayTooltip(snapshot));
  const attention = needsAttention(snapshot);
  if (icons && attention !== showingAttention) {
    tray.setImage(attention ? icons.attention : icons.normal);
    showingAttention = attention;
  }
}

async function openMenu(): Promise<void> {
  const snapshot = await refreshStatus();
  if (!tray || tray.isDestroyed()) return;
  tray.popUpContextMenu(
    Menu.buildFromTemplate(buildTrayMenu(snapshot, statusActions, Date.now())),
  );
}

function openMenuQuietly(): void {
  openMenu().catch((error) => console.warn("[tray] opening the menu failed:", error));
}

/** Put the icon in the menu bar (idempotent). */
export function showTray(): void {
  if (tray) return;
  icons = loadTrayIcons();
  showingAttention = false;
  tray = new Tray(icons.normal);
  tray.setToolTip("Mains");
  // No `setContextMenu`: the menu is built fresh on every open, and either
  // button opens it — the window is one item away ("Show Mains").
  tray.on("click", openMenuQuietly);
  tray.on("right-click", openMenuQuietly);
  unsubscribe = subscribeStatus(applyToIcon);
}

/** Take the icon out of the menu bar (idempotent). */
export function hideTray(): void {
  unsubscribe?.();
  unsubscribe = null;
  tray?.destroy();
  tray = null;
}
