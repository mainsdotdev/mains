import type { ModeId } from "./modes";

/**
 * Where a run lives and under which agent — what the renderer needs to put the
 * right space in front before opening it. The same fields the background-run
 * dock and the command menu jump with.
 */
export interface RunOpenTarget {
  runId: string;
  workspaceId: string | null;
  collectionId: string | null;
  spaceId: string | null;
  providerId: string;
  mode: ModeId;
}

/**
 * Something main asks the window to do on the user's behalf — a click on a
 * desktop notification, the menu bar (tray) menu, or the Dock menu. Main parks
 * it and pings; the window collects it (`app:consumeWindowRequest`), so a
 * request survives a window that had to be re-created first.
 *
 * Local only: the click happened on this Mac, so only this Mac's window reacts.
 * It never travels over WebSocket.
 */
export type WindowRequest =
  | { kind: "openRun"; run: RunOpenTarget }
  | { kind: "openWorkspace"; workspaceId: string }
  | { kind: "newChat" }
  | { kind: "navigate"; path: string };
