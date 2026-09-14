import { getTransport, onTransportChange } from "./registry";

type EventListener = (payload: unknown) => void;

interface Subscription {
  channel: string;
  listener: EventListener;
  off: () => void;
}

const subscriptions = new Set<Subscription>();
let watchingTransport = false;

/**
 * When the active transport is swapped (local ↔ remote), re-bind every live
 * subscription onto the new transport so listeners keep receiving events without
 * the caller re-subscribing.
 */
function ensureRebindOnTransportChange(): void {
  if (watchingTransport) return;
  watchingTransport = true;
  onTransportChange((transport) => {
    for (const sub of subscriptions) {
      sub.off();
      sub.off = transport.subscribe(sub.channel, sub.listener);
    }
  });
}

/**
 * Subscribe to a backend event on a `"domain:action"` channel through the active
 * transport (local Electron IPC by default, or a remote WebSocket backend). The
 * subscription survives transport swaps. Returns an unsubscribe function.
 *
 * Use this only for events the backend emits (runs/providers/workspace). Local
 * shell events (window fullscreen, terminal output, app self-update) stay on
 * `window.api.*` because they always come from the local main process, even when
 * the backend is remote. See docs/design/remote-backend.md.
 */
export function subscribeEvent(
  channel: string,
  listener: EventListener,
): () => void {
  ensureRebindOnTransportChange();
  const sub: Subscription = {
    channel,
    listener,
    off: getTransport().subscribe(channel, listener),
  };
  subscriptions.add(sub);
  return () => {
    sub.off();
    subscriptions.delete(sub);
  };
}
