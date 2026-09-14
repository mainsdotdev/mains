import { describe, expect, it, vi } from "vitest";
import { decodeWsMessage } from "../../shared/ipc-kit/ws-protocol";
import { WebSocketSink, type WsClientConnection } from "./websocket-sink";

function fakeClient(id: string): WsClientConnection & { sent: string[] } {
  const sent: string[] = [];
  return { id, sent, send: (data) => sent.push(data) };
}

describe("WebSocketSink", () => {
  it("broadcasts an encoded event frame to every client", () => {
    const sink = new WebSocketSink();
    const a = fakeClient("a");
    const b = fakeClient("b");
    sink.addClient(a);
    sink.addClient(b);

    sink.send("runs:statusChanged", { runId: "r1" });

    for (const client of [a, b]) {
      expect(client.sent).toHaveLength(1);
      expect(decodeWsMessage(client.sent[0])).toEqual({
        kind: "event",
        channel: "runs:statusChanged",
        payload: { runId: "r1" },
      });
    }
  });

  it("targets a single client when scope.clientId is set", () => {
    const sink = new WebSocketSink();
    const a = fakeClient("a");
    const b = fakeClient("b");
    sink.addClient(a);
    sink.addClient(b);

    sink.send("terminal:data", { id: "t1", data: "x" }, { clientId: "b" });

    expect(a.sent).toHaveLength(0);
    expect(b.sent).toHaveLength(1);
  });

  it("stops delivering to a removed client", () => {
    const sink = new WebSocketSink();
    const a = fakeClient("a");
    sink.addClient(a);
    sink.removeClient("a");

    sink.send("x:y", 1);

    expect(a.sent).toHaveLength(0);
    expect(sink.clientCount()).toBe(0);
  });

  it("keeps delivering to other clients when one throws", () => {
    const sink = new WebSocketSink();
    const bad: WsClientConnection = {
      id: "bad",
      send: vi.fn(() => {
        throw new Error("socket dead");
      }),
    };
    const good = fakeClient("good");
    sink.addClient(bad);
    sink.addClient(good);

    expect(() => sink.send("x:y", 1)).not.toThrow();
    expect(good.sent).toHaveLength(1);
  });
});

describe("event allowlist", () => {
  it("delivers only allowlisted events to a device connection", () => {
    const sink = new WebSocketSink();
    const device: string[] = [];
    const desktop: string[] = [];
    sink.addClient({
      id: "device",
      eventChannels: new Set(["runs:statusChanged"]),
      send: (data) => device.push(data),
    });
    sink.addClient({ id: "desktop", send: (data) => desktop.push(data) });

    sink.send("runs:statusChanged", { runId: "r1" });
    sink.send("terminal:output", { data: "not for phones" });

    expect(desktop).toHaveLength(2);
    expect(device).toHaveLength(1);
    expect(device[0]).toContain("runs:statusChanged");
  });
});
