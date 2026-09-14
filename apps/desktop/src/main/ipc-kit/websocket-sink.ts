import { encodeWsMessage } from "../../shared/ipc-kit/ws-protocol";
import type { EventScope, EventSink } from "./event-bus";

/** A connected client the sink can write event frames to. */
export interface WsClientConnection {
  readonly id: string;
  /** Events a paired device may receive; undefined = all (the shared token). */
  readonly eventChannels?: ReadonlySet<string>;
  send(data: string): void;
}

/**
 * Event sink that serializes bus events as {@link WsEventMessage} frames and
 * pushes them to connected WebSocket clients. The headless `mains serve` process
 * registers this (instead of the BrowserWindow sink) and adds/removes clients as
 * connections open and close.
 *
 * See docs/design/remote-backend.md (Pillar C).
 */
export class WebSocketSink implements EventSink {
  readonly kind = "websocket";
  private readonly clients = new Map<string, WsClientConnection>();

  addClient(client: WsClientConnection): void {
    this.clients.set(client.id, client);
  }

  removeClient(id: string): void {
    this.clients.delete(id);
  }

  clientCount(): number {
    return this.clients.size;
  }

  send(channel: string, payload: unknown, scope?: EventScope): void {
    const frame = encodeWsMessage({ kind: "event", channel, payload });
    for (const client of this.clients.values()) {
      // scope.clientId, when present, targets a single client (e.g. terminal
      // output); otherwise the event is broadcast to everyone.
      if (scope?.clientId && client.id !== scope.clientId) continue;
      // A paired device only receives the events on its allowlist — everything
      // else on the bus (terminal output, settings, window chrome) stays
      // between the desktop's own processes.
      if (client.eventChannels && !client.eventChannels.has(channel)) continue;
      try {
        client.send(frame);
      } catch {
        // A dead/closing socket must not break delivery to the others.
      }
    }
  }
}
