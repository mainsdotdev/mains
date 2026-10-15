import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { createBridgeWebSocketTransport } from "./bridge.websocket";

const clients: ReturnType<typeof createBridgeWebSocketTransport>[] = [];
const servers: WebSocketServer[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const server of servers.splice(0)) {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
async function server(onConnection: (socket: WebSocket) => void) {
  const listener = new WebSocketServer({ host: "127.0.0.1", port: 0 }); servers.push(listener);
  listener.on("connection", onConnection);
  await new Promise<void>((resolve) => listener.once("listening", resolve));
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("Missing test listener");
  return `ws://127.0.0.1:${address.port}/v1/log`;
}
function client(url: string, extra: Partial<Parameters<typeof createBridgeWebSocketTransport>[0]> = {}) {
  const transport = createBridgeWebSocketTransport({ url, token: "test-only", ...extra }); clients.push(transport); return transport;
}
const emptyPage = { type: "records", stream: "account", records: [], next: 0, hasMore: false };

describe("Bridge WebSocket failure handling", () => {
  it.each([null, [], { error: null }, { message: null }, { message: { type: "records", stream: "account", records: [null], next: 1, hasMore: false } }])("rejects malformed hub replies without throwing out of the socket listener (%j)", async (malformed) => {
    const url = await server((socket) => socket.on("message", (data) => {
      const { requestId } = JSON.parse(data.toString());
      socket.send(JSON.stringify(malformed === null || Array.isArray(malformed) ? malformed : { requestId, ...malformed }));
    }));
    await expect(client(url).pull("account", 0, 100)).rejects.toThrow("Invalid Bridge hub response");
  });
  it("times out a lost reply and retries with a new connection", async () => {
    let connections = 0;
    const url = await server((socket) => {
      connections++;
      if (connections === 1) return;
      socket.on("message", (data) => socket.send(JSON.stringify({ requestId: JSON.parse(data.toString()).requestId, message: emptyPage })));
    });
    const transport = client(url, { requestTimeoutMs: 100 });
    await expect(transport.pull("account", 0, 100)).rejects.toThrow("timed out");
    expect(await transport.pull("account", 0, 100)).toEqual({ records: [], next: 0, hasMore: false });
    expect(connections).toBe(2);
  });
  it("can reconnect immediately after disconnect without an old close rejecting the new RPC", async () => {
    let connections = 0;
    const url = await server((socket) => {
      connections++;
      socket.on("message", (data) => socket.send(JSON.stringify({ requestId: JSON.parse(data.toString()).requestId, message: emptyPage })));
    });
    const transport = client(url); await transport.pull("account", 0, 100); transport.disconnect();
    expect(await transport.pull("account", 0, 100)).toMatchObject({ next: 0 }); expect(connections).toBe(2);
  });
  it("cancels a token lookup without opening a socket after the transport closes", async () => {
    let release!: (token: string) => void;
    const transport = client("ws://127.0.0.1:1/v1/log", { token: () => new Promise((resolve) => { release = resolve; }) });
    const result = expect(transport.pull("account", 0, 10)).rejects.toThrow("closed");
    transport.close(); release("late-token"); await result;
  });
  it("requires encrypted transport outside loopback and keeps credentials out of URLs", () => {
    expect(() => client("ws://example.com/v1/log")).toThrow("wss");
    expect(() => client("wss://example.com/v1/log?token=secret")).toThrow("Authorization");
    expect(() => client("wss://name:secret@example.com/v1/log")).toThrow("Authorization");
  });
});
