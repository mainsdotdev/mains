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
  });

  it("never writes or replays recovery material through persistent command receipts", async () => {
    const channel = CHANNELS.bridge.takeRecoveryCode;
    let taken = false;
    registerHandler(channel, async () => { const code = taken ? null : "one-use-recovery-secret"; taken = true; return { success: true, data: code }; });
    const conn = Object.assign(fakeConn("browser"), { deviceId: "web-session" });
    const receipts = { find: vi.fn().mockResolvedValue(null), record: vi.fn().mockResolvedValue(undefined) };
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
