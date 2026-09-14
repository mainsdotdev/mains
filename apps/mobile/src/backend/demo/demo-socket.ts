import type { ServiceResponse, WsInvokeMessage } from "@mains/contracts/ws-protocol";

import type { CloseInfo, WebSocketLike } from "../ws-transport";

/** Answers one invoked channel; throws to produce a `success: false` reply. */
export interface DemoHandler {
  invoke(channel: string, args: unknown[]): unknown;
  /** Called with an emitter once the socket is open; pushes become events. */
  attach(emit: (channel: string, payload: unknown) => void): void;
  detach(): void;
}

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

/** How long a demo round trip takes: enough to feel like a network, no more. */
const LATENCY_MS = 30;

/**
 * The other end of the wire, played by the app itself. `WsTransport` accepts
 * any `WebSocketLike` through its factory option; this one hands every invoke
 * frame to the demo backend and frames its answers back, so the transport,
 * the supervisor, the sync layer and every screen run exactly as they do
 * against a real Mac — the demo begins and ends at the socket.
 */
export class DemoSocket implements WebSocketLike {
  readyState = CONNECTING;
  onopen: ((ev?: unknown) => void) | null = null;
  onclose: ((ev?: CloseInfo) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;

  constructor(private readonly handler: DemoHandler) {
    setTimeout(() => {
      if (this.readyState !== CONNECTING) return;
      this.readyState = OPEN;
      this.handler.attach((channel, payload) => {
        if (this.readyState !== OPEN) return;
        this.onmessage?.({ data: JSON.stringify({ kind: "event", channel, payload }) });
      });
      this.onopen?.();
    }, LATENCY_MS);
  }

  send(data: string): void {
    let message: WsInvokeMessage;
    try {
      message = JSON.parse(data) as WsInvokeMessage;
    } catch {
      return;
    }
    if (message.kind !== "invoke") return;
    setTimeout(() => {
      if (this.readyState !== OPEN) return;
      let result: ServiceResponse<unknown>;
      try {
        result = { success: true, data: this.handler.invoke(message.channel, message.args ?? []) };
      } catch (caught) {
        result = { success: false, error: caught instanceof Error ? caught.message : String(caught) };
      }
      this.onmessage?.({ data: JSON.stringify({ kind: "response", id: message.id, result }) });
    }, LATENCY_MS);
  }

  close(): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.handler.detach();
    this.onclose?.({ code: 1000, reason: "demo socket closed" });
  }
}
