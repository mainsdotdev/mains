import { afterEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { decodeWsMessage, MAX_DEVICE_MESSAGE_BYTES } from "@mains/contracts/ws-protocol";
import { clearHandlers, registerHandler } from "./handler-registry";
import { WebSocketSink } from "./websocket-sink";
import { serveConnection, type WsConnection } from "./ws-server";

function fakeConn(id: string) {
  let onMsg: ((data: string) => void) | null = null;
  let onClose: (() => void) | null = null;
  const sent: string[] = [];
  const conn: WsConnection & {
    sent: string[];
    emit: (data: string) => void;
    fireClose: () => void;
  } = {
    id,
    sent,
    send: (data) => sent.push(data),
    onMessage: (cb) => {
      onMsg = cb;
    },
    onClose: (cb) => {
      onClose = cb;
    },
    emit: (data) => onMsg?.(data),
    fireClose: () => onClose?.(),
  };
  return conn;
}

const invokeFrame = (id: number, channel: string, args: unknown[]) =>
  JSON.stringify({ kind: "invoke", id, channel, args });

describe("serveConnection", () => {
  afterEach(() => {
    clearHandlers();
    vi.useRealTimers();
  });

  it.each(["read", "reserve"])("does not execute a command after a receipt %s failure", async (stage) => {
    const run = vi.fn(async () => ({ success: true as const, data: "executed" }));
    registerHandler("runs:continue", run);
    const conn = Object.assign(fakeConn("phone"), { deviceId: "device-read-failure" });
    const receipts = { find: stage === "read" ? vi.fn().mockRejectedValue(new Error("Database unavailable")) : vi.fn().mockResolvedValue(null),
      reserve: vi.fn().mockRejectedValue(new Error("Disk full")), record: vi.fn() };
    serveConnection(conn, new WebSocketSink(), { commandReceipts: receipts });
    conn.emit(JSON.stringify({ kind: "invoke", id: 1, channel: "runs:continue", args: [], commandId: "retry" }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(run).not.toHaveBeenCalled();
    expect(decodeWsMessage(conn.sent[0])).toMatchObject({ kind: "response", result: { success: false } });
  });

  it("refuses device commands when durable delivery is unavailable", async () => {
    const run = vi.fn(async () => ({ success: true as const, data: "executed" }));
    registerHandler("runs:continue", run);
    const conn = Object.assign(fakeConn("phone"), { deviceId: "device-no-store", allowedChannels: new Set<string>(), commandChannels: new Set(["runs:continue"]) });
    serveConnection(conn, new WebSocketSink());
    conn.emit(JSON.stringify({ kind: "invoke", id: 1, channel: "runs:continue", args: [], commandId: "one-attempt" }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(run).not.toHaveBeenCalled();
    expect(decodeWsMessage(conn.sent[0])).toMatchObject({ result: { success: false } });
  });

  it("preserves an uncertain outcome across reconnect and restart when saving the result fails", async () => {
    const run = vi.fn(async () => ({ success: true as const, data: "executed" }));
    registerHandler("runs:continue", run);
    const rows = new Map<string, string>();
    const makeStore = () => ({
      find: async (_device: string, id: string) => rows.get(id) ?? null,
      reserve: async (_device: string, id: string, _channel: string, pending: string) => {
        if (rows.has(id)) return false;
        rows.set(id, pending); return true;
      },
      record: vi.fn().mockRejectedValue(new Error("Disk full")),
    });
    const store = makeStore();
    const frame = (id: number) => JSON.stringify({ kind: "invoke", id, channel: "runs:continue", args: [], commandId: "uncertain" });
    for (const [index, receipts] of [store, store, makeStore()].entries()) {
      const conn = Object.assign(fakeConn(`phone-${index}`), { deviceId: "device-write-failure" });
      serveConnection(conn, new WebSocketSink(), { commandReceipts: receipts });
      conn.emit(frame(index + 1));
      await new Promise((resolve) => setImmediate(resolve));
      expect(decodeWsMessage(conn.sent[0])).toMatchObject({ result: { success: false, error: expect.stringMatching(/unknown|uncertain/i) } });
    }
    expect(run).toHaveBeenCalledOnce();
  });

  it("joins a running command after losing its first connection and replays its saved result", async () => {
    let finish!: (value: { success: true; data: string }) => void;
    const run = vi.fn(() => new Promise<{ success: true; data: string }>((resolve) => { finish = resolve; }));
    registerHandler("runs:continue", run);
    const rows = new Map<string, string>();
    const receipts = {
      find: async (_device: string, id: string) => rows.get(id) ?? null,
      reserve: async (_device: string, id: string, _channel: string, result: string) => {
        if (rows.has(id)) return false;
        rows.set(id, result); return true;
      },
      record: vi.fn(async (_device: string, id: string, _channel: string, result: string) => { rows.set(id, result); }),
    };
    const first = Object.assign(fakeConn("old-socket"), { deviceId: "device-lost-reply" });
    const next = Object.assign(fakeConn("replacement"), { deviceId: "device-lost-reply" });
    const frame = (id: number) => JSON.stringify({ kind: "invoke", id, channel: "runs:continue", args: [], commandId: "same-command" });
    const sink = new WebSocketSink();
    serveConnection(first, sink, { commandReceipts: receipts });
    first.emit(frame(1));
    await new Promise((resolve) => setImmediate(resolve));
    first.fireClose();
    serveConnection(next, sink, { commandReceipts: receipts });
    next.emit(frame(2));
    await new Promise((resolve) => setImmediate(resolve));
    expect(run).toHaveBeenCalledOnce();
    finish({ success: true, data: "saved" });
    await new Promise((resolve) => setImmediate(resolve));
    expect(first.sent).toEqual([]);
    expect(decodeWsMessage(next.sent[0])).toMatchObject({ id: 2, result: { success: true, data: "saved" } });
    next.emit(frame(3));
    await new Promise((resolve) => setImmediate(resolve));
    expect(decodeWsMessage(next.sent[1])).toMatchObject({ id: 3, result: { success: true, data: "saved" } });
    expect(run).toHaveBeenCalledOnce();
    expect(receipts.record).toHaveBeenCalledOnce();
  });

  it("never writes or replays recovery material through persistent command receipts", async () => {
    const channel = CHANNELS.bridge.takeRecoveryCode;
    let taken = false;
    registerHandler(channel, async () => { const code = taken ? null : "one-use-recovery-secret"; taken = true; return { success: true, data: code }; });
    const conn = Object.assign(fakeConn("browser"), { deviceId: "web-session" });
    const receipts = { find: vi.fn().mockResolvedValue(null), reserve: vi.fn(), record: vi.fn().mockResolvedValue(undefined) };
    serveConnection(conn, new WebSocketSink(), { commandReceipts: receipts });
    const frame = (id: number) => JSON.stringify({ kind: "invoke", id, channel, args: [], commandId: "same-attempt" });
    conn.emit(frame(1)); await new Promise((resolve) => setImmediate(resolve));
    conn.emit(frame(2)); await new Promise((resolve) => setImmediate(resolve));
    expect(conn.sent.map((value) => decodeWsMessage(value))).toMatchObject([
      { result: { success: true, data: "one-use-recovery-secret" } }, { result: { success: true, data: null } },
    ]);
    expect(receipts.find).not.toHaveBeenCalled(); expect(receipts.record).not.toHaveBeenCalled();
  });

  it("rejects oversized device responses before transmission and leaves owner responses available", async () => {
    registerHandler("runs:getHistory", async () => ({ success: true, data: "😀".repeat(MAX_DEVICE_MESSAGE_BYTES / 4) }));
    const device = Object.assign(fakeConn("phone"), { deviceId: "paired", allowedChannels: new Set(["runs:getHistory"]) });
    const owner = fakeConn("desktop");
    const sink = new WebSocketSink();
    serveConnection(device, sink);
    serveConnection(owner, sink);
    device.emit(invokeFrame(1, "runs:getHistory", []));
    owner.emit(invokeFrame(2, "runs:getHistory", []));
    await Promise.resolve(); await Promise.resolve();
    expect(Buffer.byteLength(device.sent[0])).toBeLessThan(1024);
    expect(decodeWsMessage(device.sent[0])).toMatchObject({ kind: "response", id: 1, result: { success: false } });
    expect(decodeWsMessage(owner.sent[0])).toMatchObject({ kind: "response", id: 2, result: { success: true } });
  });

  it("registers the client with the sink and removes it on close", () => {
    const sink = new WebSocketSink();
    const conn = fakeConn("c1");

    serveConnection(conn, sink);
    expect(sink.clientCount()).toBe(1);

    conn.fireClose();
    expect(sink.clientCount()).toBe(0);
  });

  it("retires a silent socket within two heartbeat intervals and clears the watchdog", () => {
    vi.useFakeTimers();
    const conn = fakeConn("silent-phone");
    const ping = vi.fn(), terminate = vi.fn(() => conn.fireClose());
    let pong!: () => void;
    serveConnection(Object.assign(conn, { ping, terminate, onPong: (listener: () => void) => { pong = listener; } }), new WebSocketSink());
    vi.advanceTimersByTime(15_000); expect(ping).toHaveBeenCalledOnce();
    pong(); vi.advanceTimersByTime(15_000); expect(terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(15_000); expect(terminate).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(30_000); expect(terminate).toHaveBeenCalledOnce();
  });

  it("retires in-memory connection resources on close without serializing the signal", async () => {
    let signal: AbortSignal | undefined;
    registerHandler("voice:probe", async (ctx) => {
      signal = ctx.connectionSignal;
      return { success: true, data: ctx };
    });
    const conn = fakeConn("voice-phone");
    serveConnection(conn, new WebSocketSink());
    conn.emit(invokeFrame(1, "voice:probe", []));
    await Promise.resolve(); await Promise.resolve();
    expect(signal?.aborted).toBe(false);
    expect(decodeWsMessage(conn.sent[0])).toMatchObject({ result: { data: { clientId: "voice-phone" } } });
    expect(conn.sent[0]).not.toContain("connectionSignal");
    conn.fireClose();
    expect(signal?.aborted).toBe(true);
  });

  it("routes an invoke to the registry and replies with a response", async () => {
    registerHandler("entities:getById", async (ctx, id) => ({
      success: true,
      data: { id, clientId: (ctx as { clientId?: string }).clientId },
    }));
    const sink = new WebSocketSink();
    const conn = fakeConn("c1");
    serveConnection(conn, sink);

    conn.emit(invokeFrame(7, "entities:getById", ["e1"]));
    await Promise.resolve();
    await Promise.resolve();

    expect(conn.sent).toHaveLength(1);
    expect(decodeWsMessage(conn.sent[0])).toEqual({
      kind: "response",
      id: 7,
      result: { success: true, data: { id: "e1", clientId: "c1" } },
    });
  });

  it("replies with a failure for an unknown channel", async () => {
    const sink = new WebSocketSink();
    const conn = fakeConn("c1");
    serveConnection(conn, sink);

    conn.emit(invokeFrame(1, "nope:missing", []));
    await Promise.resolve();
    await Promise.resolve();

    const decoded = decodeWsMessage(conn.sent[0]) as {
      result: { success: boolean };
    };
    expect(decoded.result.success).toBe(false);
  });

  it("ignores malformed frames and non-invoke messages", async () => {
    const sink = new WebSocketSink();
    const conn = fakeConn("c1");
    serveConnection(conn, sink);

    conn.emit("not json");
    conn.emit(JSON.stringify({ kind: "event", channel: "x:y", payload: 1 }));
    await Promise.resolve();

    expect(conn.sent).toHaveLength(0);
  });
});
