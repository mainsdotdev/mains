import { IpcTransport } from "./ipc-transport";
import { getTransport, setTransport } from "./registry";
import { WsTransport, type WsTransportOptions } from "./ws-transport";

let activeRemote: WsTransport | null = null;

function disposeActiveRemote(): void {
  if (activeRemote) {
    activeRemote.dispose();
    activeRemote = null;
  }
}

/**
 * Point the UI at a remote backend: open a WebSocket connection and make it the
 * active transport, so every RTK Query call and every {@link appEvents}
 * subscription follows it. Returns the transport so callers can observe its
 * status (connecting/connected/reconnecting/offline).
 *
 * Switching the active transport invalidates RTK Query's cache (wired in the
 * store), so the UI refetches from the new backend.
 */
export function connectRemoteBackend(
  url: string,
  options?: WsTransportOptions,
): WsTransport {
  disposeActiveRemote();
  const transport = new WsTransport(url, options);
  activeRemote = transport;
  transport.connect();
  setTransport(transport);
  return transport;
}

/** Return to the local (in-process) backend, disposing any remote connection. */
export function disconnectRemoteBackend(): void {
  disposeActiveRemote();
  if (getTransport().kind !== "ipc") {
    setTransport(new IpcTransport());
  }
}

/** The active remote transport, or null when running locally. */
export function getActiveRemote(): WsTransport | null {
  return activeRemote;
}
