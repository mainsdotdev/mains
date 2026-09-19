import type { ModeId } from "./modes";

/**
 * The run a click on a desktop notification asked the window to show. Carries
 * what the renderer needs to put the right space in front before opening it —
 * the same fields the background-run dock and the command menu jump with.
 *
 * Local only: the notification fired on this Mac, so only this Mac's window
 * reacts. It never travels over WebSocket.
 */
export interface RunOpenRequest {
  runId: string;
  workspaceId: string | null;
  collectionId: string | null;
  spaceId: string | null;
  providerId: string;
  mode: ModeId;
}
