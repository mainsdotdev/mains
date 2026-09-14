import { afterEach, describe, expect, it, vi } from "vitest";
import { WsTransport, type WebSocketLike } from "./ws-transport";
import type { TransportStatus } from "./types";

class FakeSocket implements WebSocketLike {
  readyState = 0; // CONNECTING
  sent: string[] = [];
  onopen: ((ev?: unknown) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  // ── test drivers ──
  open(): void {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }
  emit(data: unknown): void {
    this.onmessage?.({ data });
  }
  serverClose(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

function harness(
  options: { invokeTimeoutMs?: number; reconnect?: boolean; token?: string } = {},
) {
  const sockets: FakeSocket[] = [];
  const scheduled: Array<{ fn: () => void; ms: number }> = [];
  const protocolsSeen: Array<string[] | undefined> = [];
  const transport = new WsTransport("ws://test", {
    factory: (_url, protocols) => {
      protocolsSeen.push(protocols);
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    token: options.token,
    schedule: (fn, ms) => scheduled.push({ fn, ms }),
    invokeTimeoutMs: options.invokeTimeoutMs ?? 0,
    reconnect: options.reconnect ?? true,
  });
  return { transport, sockets, scheduled, protocolsSeen };
}

const responseFrame = (id: number, data: unknown) =>
  JSON.stringify({ kind: "response", id, result: { success: true, data } });

describe("WsTransport", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers the pairing token as a subprotocol", () => {
    const withToken = harness({ token: "secret" });
    withToken.transport.connect();
    expect(withToken.protocolsSeen[0]).toEqual([
      "mains.v1",
      "mains.token.secret",
    ]);

    const without = harness();
    without.transport.connect();
    expect(without.protocolsSeen[0]).toEqual(["mains.v1"]);
  });

  it("transitions connecting → connected on open", () => {
    const { transport, sockets } = harness();
    const seen: TransportStatus[] = [];
    transport.onStatusChange((s) => seen.push(s));

    transport.connect();
    expect(transport.status()).toBe("connecting");

    sockets[0].open();
    expect(transport.status()).toBe("connected");
    expect(seen).toEqual(["connecting", "connected"]);
  });

  it("resolves an invoke when the matching response arrives", async () => {
    const { transport, sockets } = harness();
    transport.connect();
    sockets[0].open();

    const pending = transport.invoke("runs:execute", [{ a: 1 }]);
    expect(JSON.parse(sockets[0].sent[0])).toMatchObject({
      kind: "invoke",
      id: 1,
      channel: "runs:execute",
      args: [{ a: 1 }],
    });

    sockets[0].emit(responseFrame(1, "ok"));
    await expect(pending).resolves.toEqual({ success: true, data: "ok" });
  });

  it("queues invokes sent before the socket opens, then flushes", () => {
    const { transport, sockets } = harness();
    transport.connect();

    void transport.invoke("a:b");
    expect(sockets[0].sent).toHaveLength(0); // queued while connecting

    sockets[0].open();
    expect(sockets[0].sent).toHaveLength(1); // flushed on open
  });

  it("dispatches events to channel listeners and stops after unsubscribe", () => {
    const { transport, sockets } = harness();
    transport.connect();
    const seen: unknown[] = [];
    const off = transport.subscribe("runs:ephemeralEvent", (p) => seen.push(p));

    sockets[0].emit(
      JSON.stringify({ kind: "event", channel: "runs:ephemeralEvent", payload: 1 }),
    );
    expect(seen).toEqual([1]);

    off();
    sockets[0].emit(
      JSON.stringify({ kind: "event", channel: "runs:ephemeralEvent", payload: 2 }),
    );
    expect(seen).toEqual([1]);
  });

  it("ignores malformed frames and unknown response ids", async () => {
    const { transport, sockets } = harness();
    transport.connect();
    sockets[0].open();
    const pending = transport.invoke("a:b");

    expect(() => sockets[0].emit("not json")).not.toThrow();
    expect(() => sockets[0].emit(responseFrame(999, "x"))).not.toThrow();

    sockets[0].emit(responseFrame(1, "real"));
    await expect(pending).resolves.toEqual({ success: true, data: "real" });
  });

  it("rejects pending invokes and schedules a reconnect on close", async () => {
    const { transport, sockets, scheduled } = harness();
    transport.connect();
    sockets[0].open();
    const pending = transport.invoke("a:b");

    sockets[0].serverClose();

    await expect(pending).rejects.toThrow(/closed/);
    expect(transport.status()).toBe("reconnecting");
    expect(scheduled).toHaveLength(1);

    scheduled[0].fn(); // fire the backoff
    expect(sockets).toHaveLength(2); // a new socket was opened
  });

  it("does not reconnect when disabled", () => {
    const { transport, sockets, scheduled } = harness({ reconnect: false });
    transport.connect();
    sockets[0].open();

    sockets[0].serverClose();

    expect(transport.status()).toBe("offline");
    expect(scheduled).toHaveLength(0);
  });

  it("disposes: closes the socket, goes offline, rejects further invokes", async () => {
    const { transport, sockets } = harness();
    transport.connect();
    sockets[0].open();

    transport.dispose();

    expect(sockets[0].readyState).toBe(3);
    expect(transport.status()).toBe("offline");
    await expect(transport.invoke("a:b")).rejects.toThrow(/disposed/);
  });

  it("times out an invoke that never gets a response", async () => {
    vi.useFakeTimers();
    const { transport, sockets } = harness({
      invokeTimeoutMs: 1000,
      reconnect: false,
    });
    transport.connect();
    sockets[0].open();

    const pending = transport.invoke("a:b");
    const assertion = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });
});
