import {
  buildSubprotocols,
  decodeWsMessage,
  encodeWsMessage,
  type ServiceResponse,
} from "@mains/contracts/ws-protocol";

/**
 * Port of mains's renderer `WsTransport` (src/renderer/lib/transport/
 * ws-transport.ts): the same invoke/subscribe/status contract over the same
 * frames, so the phone talks to a backend exactly the way the desktop's web
 * mode does. Two phone-specific additions: a close-event inspection hook so an
 * auth refusal stops the retry loop, and `lastClose` for the supervisor to
 * read the reason. Reconnect policy beyond that (offline, app state, endpoint
 * rotation) is the connection supervisor's job, not this class's.
 */

export type TransportStatus =
  | "connected"
  | "connecting"
  | "reconnecting"
  | "offline";

export interface CloseInfo {
  code?: number;
  reason?: string;
}

/** Minimal subset of the WebSocket API {@link WsTransport} uses. */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  readyState: number;
  onopen: ((ev?: unknown) => void) | null;
  onclose: ((ev?: CloseInfo) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

const OPEN = 1;
const CLOSED_MESSAGE = "WebSocket connection closed";
const DISPOSED_MESSAGE = "WsTransport has been disposed";

/**
 * True for the failures where the outcome is unknown — the socket went away
 * between send and reply. Safe to retry with the same commandId; anything else
 * (a timeout with the socket up, a refusal) is not.
 */
export function isConnectionLoss(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === CLOSED_MESSAGE || error.message === DISPOSED_MESSAGE)
  );
}

export interface WsTransportOptions {
  /** Factory for the socket; defaults to the global `WebSocket`. Injectable for tests. */
  factory?: (url: string, protocols?: string[]) => WebSocketLike;
  /** Device (or shared pairing) token; sent as a WS subprotocol so the backend can authorize. */
  token?: string | null;
  /** How long an invoke waits for its response before rejecting. Default 30s. */
  invokeTimeoutMs?: number;
  /** Auto-reconnect after an unexpected close. Default true. */
  reconnect?: boolean;
  /** Base/max backoff for reconnect attempts. */
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  /**
   * Inspect a close and decide whether reconnecting is pointless (e.g. the
   * backend refused the token). A fatal close parks the transport `offline`.
   */
  isFatalClose?: (info: CloseInfo) => boolean;
  /** Schedules reconnect/backoff; defaults to setTimeout. Injectable for tests. */
  schedule?: (fn: () => void, ms: number) => void;
}

interface PendingInvoke {
  resolve: (result: ServiceResponse<unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export class WsTransport {
  readonly kind = "ws";

  private socket: WebSocketLike | null = null;
  private currentStatus: TransportStatus = "offline";
  private disposed = false;
  private fatal = false;
  private reconnectAttempts = 0;
  private closeInfo: CloseInfo | null = null;

  private nextId = 1;
  private readonly pending = new Map<number, PendingInvoke>();
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
  private readonly statusListeners = new Set<(status: TransportStatus) => void>();
  private readonly closeListeners = new Set<(info: CloseInfo, fatal: boolean) => void>();
  /** Frames queued while the socket is not yet OPEN. */
  private readonly outbox: string[] = [];

  private readonly factory: (url: string, protocols?: string[]) => WebSocketLike;
  private readonly token: string | null;
  private readonly invokeTimeoutMs: number;
  private readonly reconnectEnabled: boolean;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly isFatalClose: ((info: CloseInfo) => boolean) | null;
  private readonly schedule: (fn: () => void, ms: number) => void;

  constructor(
    readonly url: string,
    options: WsTransportOptions = {},
  ) {
    this.factory = options.factory ?? defaultFactory;
    this.token = options.token ?? null;
    this.invokeTimeoutMs = options.invokeTimeoutMs ?? 30_000;
    this.reconnectEnabled = options.reconnect ?? true;
    this.reconnectBaseMs = options.reconnectBaseMs ?? 500;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 10_000;
    this.isFatalClose = options.isFatalClose ?? null;
    this.schedule = options.schedule ?? ((fn, ms) => void setTimeout(fn, ms));
  }

  /** Open the connection. Safe to call once; reconnection is automatic. */
  connect(): void {
    if (this.disposed || this.socket) return;
    this.openSocket();
  }

  /** The last close the socket reported, for diagnosing an `offline` status. */
  get lastClose(): CloseInfo | null {
    return this.closeInfo;
  }

  /** True once a close was judged fatal — the transport will not retry. */
  get isFatal(): boolean {
    return this.fatal;
  }

  /** Reconnect attempts since the last successful open. */
  get attempts(): number {
    return this.reconnectAttempts;
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
      this.closeInfo = null;
      this.setStatus("connected");
      for (const frame of this.outbox.splice(0)) socket.send(frame);
    };
    socket.onmessage = (ev) => this.handleMessage(ev.data);
    socket.onerror = () => {
      // close handler drives reconnect; nothing extra needed here.
    };
    socket.onclose = (ev) => {
      if (this.socket === socket) this.socket = null;
      const info: CloseInfo = { code: ev?.code, reason: ev?.reason };
      this.closeInfo = info;
      this.failAllPending(new Error(CLOSED_MESSAGE));
      if (this.disposed) {
        this.setStatus("offline");
        return;
      }
      const fatal = this.isFatalClose?.(info) ?? false;
      if (fatal) this.fatal = true;
      // Every close is reported, not just status flips: a supervisor counting
      // failed opens on one address needs to hear each one.
      for (const listener of this.closeListeners) listener(info, fatal);
      if (fatal) {
        this.setStatus("offline");
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (!this.reconnectEnabled || this.disposed || this.fatal) {
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
    options: { commandId?: string } = {},
  ): Promise<ServiceResponse<unknown>> {
    if (this.disposed) {
      return Promise.reject(new Error(DISPOSED_MESSAGE));
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
      this.sendFrame(
        encodeWsMessage({
          kind: "invoke",
          id,
          channel,
          args,
          ...(options.commandId ? { commandId: options.commandId } : {}),
        }),
      );
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
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /** Observe every socket close (before any reconnect is scheduled). */
  onClose(listener: (info: CloseInfo, fatal: boolean) => void): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  /** Close the connection and stop reconnecting. */
  dispose(): void {
    this.disposed = true;
    this.failAllPending(new Error(DISPOSED_MESSAGE));
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
