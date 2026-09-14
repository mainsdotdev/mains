import type { ServiceResponse } from "../../../shared/ipc-kit/service-response";
import {
  buildSubprotocols,
  decodeWsMessage,
  encodeWsMessage,
} from "../../../shared/ipc-kit/ws-protocol";
import type { Transport, TransportStatus } from "./types";

/** Minimal subset of the browser `WebSocket` API that {@link WsTransport} uses. */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  readyState: number;
  onopen: ((ev?: unknown) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

const OPEN = 1;

export interface WsTransportOptions {
  /** Factory for the socket; defaults to the global `WebSocket`. Injectable for tests. */
  factory?: (url: string, protocols?: string[]) => WebSocketLike;
  /** Pairing token; sent as a WS subprotocol so the backend can authorize. */
  token?: string | null;
  /** How long an invoke waits for its response before rejecting. Default 30s. */
  invokeTimeoutMs?: number;
  /** Auto-reconnect after an unexpected close. Default true. */
  reconnect?: boolean;
  /** Base/max backoff for reconnect attempts. */
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  /** Schedules reconnect/backoff; defaults to setTimeout. Injectable for tests. */
  schedule?: (fn: () => void, ms: number) => void;
}

interface PendingInvoke {
  resolve: (result: ServiceResponse<unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Remote transport: speaks the WebSocket protocol (src/shared/ipc-kit/ws-protocol)
 * to a headless `mains serve` backend. Drop-in for {@link IpcTransport} — same
 * `Transport` contract, so swapping it in (via the transport registry) points the
 * whole UI at a remote backend with no call-site changes.
 *
 * The server broadcasts every event to connected clients; this transport
 * dispatches incoming events to local listeners by channel, so there is no
 * subscribe handshake (matching the Electron broadcast model).
 *
 * See docs/design/remote-backend.md.
 */
export class WsTransport implements Transport {
  readonly kind = "ws";

  private socket: WebSocketLike | null = null;
  private currentStatus: TransportStatus = "offline";
  private disposed = false;
  private reconnectAttempts = 0;

  private nextId = 1;
  private readonly pending = new Map<number, PendingInvoke>();
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
  private readonly statusListeners = new Set<(status: TransportStatus) => void>();
  /** Frames queued while the socket is not yet OPEN. */
  private readonly outbox: string[] = [];

  private readonly factory: (url: string, protocols?: string[]) => WebSocketLike;
  private readonly token: string | null;
  private readonly invokeTimeoutMs: number;
  private readonly reconnectEnabled: boolean;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly schedule: (fn: () => void, ms: number) => void;

  constructor(
    private readonly url: string,
    options: WsTransportOptions = {},
  ) {
    this.factory = options.factory ?? defaultFactory;
    this.token = options.token ?? null;
    this.invokeTimeoutMs = options.invokeTimeoutMs ?? 30_000;
    this.reconnectEnabled = options.reconnect ?? true;
    this.reconnectBaseMs = options.reconnectBaseMs ?? 500;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 10_000;
    this.schedule =
      options.schedule ?? ((fn, ms) => void setTimeout(fn, ms));
  }

  /** Open the connection. Safe to call once; reconnection is automatic. */
  connect(): void {
    if (this.disposed || this.socket) return;
    this.openSocket();
  }

  private openSocket(): void {
    this.setStatus(this.reconnectAttempts > 0 ? "reconnecting" : "connecting");
    let socket: WebSocketLike;
    try {
      socket = this.factory(this.url, buildSubprotocols(this.token));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus("connected");
      for (const frame of this.outbox.splice(0)) socket.send(frame);
    };
    socket.onmessage = (ev) => this.handleMessage(ev.data);
    socket.onerror = () => {
      // close handler drives reconnect; nothing extra needed here.
    };
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      this.failAllPending(new Error("WebSocket connection closed"));
      if (this.disposed) {
        this.setStatus("offline");
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (!this.reconnectEnabled || this.disposed) {
      this.setStatus("offline");
      return;
    }
    this.setStatus("reconnecting");
    const delay = Math.min(
      this.reconnectBaseMs * 2 ** this.reconnectAttempts,
      this.reconnectMaxMs,
    );
    this.reconnectAttempts += 1;
    this.schedule(() => {
      if (!this.disposed && !this.socket) this.openSocket();
    }, delay);
  }

  private handleMessage(data: unknown): void {
    let message;
    try {
      message = decodeWsMessage(typeof data === "string" ? data : String(data));
    } catch {
      return; // ignore malformed frames
    }
    if (message.kind === "response") {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      if (entry.timer) clearTimeout(entry.timer);
      this.pending.delete(message.id);
      entry.resolve(message.result);
    } else if (message.kind === "event") {
      const set = this.listeners.get(message.channel);
      if (!set) return;
      for (const listener of set) listener(message.payload);
    }
  }

  invoke(
    channel: string,
    args: unknown[] = [],
  ): Promise<ServiceResponse<unknown>> {
    if (this.disposed) {
      return Promise.reject(new Error("WsTransport has been disposed"));
    }
    const id = this.nextId++;
    return new Promise<ServiceResponse<unknown>>((resolve, reject) => {
      const timer =
        this.invokeTimeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(
                new Error(
                  `Invoke "${channel}" timed out after ${this.invokeTimeoutMs}ms`,
                ),
              );
            }, this.invokeTimeoutMs)
          : null;
      this.pending.set(id, { resolve, reject, timer });
      this.sendFrame(encodeWsMessage({ kind: "invoke", id, channel, args }));
    });
  }

  private sendFrame(frame: string): void {
    if (this.socket && this.socket.readyState === OPEN) {
      this.socket.send(frame);
    } else {
      this.outbox.push(frame);
    }
  }

  subscribe(channel: string, listener: (payload: unknown) => void): () => void {
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
    }
    set.add(listener);
    return () => {
      const current = this.listeners.get(channel);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(channel);
    };
  }

  status(): TransportStatus {
    return this.currentStatus;
  }

  onStatusChange(listener: (status: TransportStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Close the connection and stop reconnecting. */
  dispose(): void {
    this.disposed = true;
    this.failAllPending(new Error("WsTransport has been disposed"));
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
    this.setStatus("offline");
  }

  private failAllPending(error: Error): void {
    for (const entry of this.pending.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  private setStatus(status: TransportStatus): void {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    for (const listener of this.statusListeners) listener(status);
  }
}

function defaultFactory(url: string, protocols?: string[]): WebSocketLike {
  const Ctor = (
    globalThis as {
      WebSocket?: new (url: string, protocols?: string[]) => WebSocketLike;
    }
  ).WebSocket;
  if (!Ctor) {
    throw new Error("WebSocket is not available in this environment");
  }
  return new Ctor(url, protocols);
}
