import { IpcTransport } from "./ipc-transport";
import type { Transport } from "./types";

/**
 * Holds the renderer's active {@link Transport}. Every consumer (RTK Query's
 * base query, event-subscription hooks) reads the active transport through
 * {@link getTransport} rather than touching `window.api`/`ipcRenderer` directly,
 * so a future "remote backend" feature can swap the transport in one place via
 * {@link setTransport} without changing any call site.
 *
 * Defaults to {@link IpcTransport} (local, in-process). See
 * docs/design/remote-backend.md.
 */
let activeTransport: Transport = new IpcTransport();

type TransportListener = (transport: Transport) => void;
const listeners = new Set<TransportListener>();

export function getTransport(): Transport {
  return activeTransport;
}

/** Swap the active transport (e.g. point the UI at a remote backend). */
export function setTransport(next: Transport): void {
  if (next === activeTransport) return;
  activeTransport = next;
  for (const listener of listeners) listener(activeTransport);
}

/** Observe transport swaps. Returns an unsubscribe function. */
export function onTransportChange(listener: TransportListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reset to the default local transport. Primarily for tests. */
export function resetTransport(): void {
  setTransport(new IpcTransport());
}
