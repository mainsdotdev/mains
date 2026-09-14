import type { ServiceResponse } from "../../../shared/ipc-kit/service-response";

/**
 * Connection status of a transport. The local (Electron IPC) transport is always
 * `"connected"`; a future remote (WebSocket) transport reports the real socket
 * state so the UI can surface connecting/reconnecting/offline.
 */
export type TransportStatus =
  | "connected"
  | "connecting"
  | "reconnecting"
  | "offline";

/**
 * The single seam between the renderer and the mains backend.
 *
 * Every request/response call (`invoke`) and every push subscription
 * (`subscribe`) routes through a `Transport`. Today the only implementation is
 * {@link IpcTransport}, which targets the local main process over Electron IPC.
 * A remote backend is enabled by swapping in a WebSocket-backed implementation
 * with the same contract — no call site changes.
 *
 * See docs/design/remote-backend.md.
 */
export interface Transport {
  /** Stable identifier for the transport implementation, e.g. `"ipc"`. */
  readonly kind: string;

  /**
   * Invoke a `"domain:action"` channel with positional args and resolve the
   * {@link ServiceResponse} envelope. Mirrors `ipcRenderer.invoke(channel, ...args)`.
   */
  invoke(
    channel: string,
    args?: unknown[],
  ): Promise<ServiceResponse<unknown>>;

  /**
   * Subscribe to a push channel. The listener receives the payload only (no
   * event object). Returns an unsubscribe function.
   */
  subscribe(channel: string, listener: (payload: unknown) => void): () => void;

  /** Current connection status. */
  status(): TransportStatus;

  /** Observe status changes. Returns an unsubscribe function. */
  onStatusChange(listener: (status: TransportStatus) => void): () => void;
}

/**
 * Shape of the generic channel bridge that the preload exposes on
 * `window.mainTransport`. {@link IpcTransport} wraps this.
 */
export interface MainTransportBridge {
  invoke(channel: string, args: unknown[]): Promise<ServiceResponse<unknown>>;
  subscribe(channel: string, listener: (payload: unknown) => void): () => void;
}
