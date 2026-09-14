import { afterEach, describe, expect, it } from "vitest";
import { decodeWsMessage } from "../../shared/ipc-kit/ws-protocol";
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
