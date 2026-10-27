import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { bridgeApprovalCode, bridgeBase64, type BridgeApprovalRequest } from "@mains/contracts/bridge-auth";
import { parseBridgeServerFrame } from "@mains/contracts/bridge-wire";
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
async function server(onConnection: (socket: WebSocket) => void, options: { autoPong?: boolean } = {}) {
  const listener = new WebSocketServer({ host: "127.0.0.1", port: 0, ...options }); servers.push(listener);
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
  it("keeps an idle socket alive with protocol pings without any extra application requests", async () => {
    let pings = 0, requests = 0;
    const statuses: string[] = [];
    const url = await server((socket) => {
      socket.on("ping", () => pings++);
      socket.on("message", (data) => { requests++; socket.send(JSON.stringify({ requestId: JSON.parse(data.toString()).requestId, message: emptyPage })); });
    });
    const transport = client(url, { heartbeatIntervalMs: 20, heartbeatTimeoutMs: 100, onStatusChange: (s) => statuses.push(s) });
    await transport.pull("account", 0, 10);
    await vi.waitFor(() => expect(pings).toBeGreaterThanOrEqual(2), { interval: 5 });
    expect(requests).toBe(1); expect(statuses).toEqual(["connecting", "connected"]);
    transport.close(); const stoppedAt = pings;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(pings).toBe(stoppedAt);
  });
  it("detects a half-open idle socket even when no RPC is pending and rejects unrelated pongs", async () => {
    const statuses: string[] = [];
    let pings = 0;
    const url = await server((socket) => {
      socket.on("ping", () => { pings++; socket.pong("not-the-requested-nonce"); });
      socket.on("message", (data) => socket.send(JSON.stringify({ requestId: JSON.parse(data.toString()).requestId, message: emptyPage })));
    }, { autoPong: false });
    const transport = client(url, { heartbeatIntervalMs: 20, heartbeatTimeoutMs: 40, onStatusChange: (s) => statuses.push(s) });
    await transport.pull("account", 0, 10);
    await vi.waitFor(() => expect(statuses.at(-1)).toBe("offline"), { interval: 5, timeout: 1000 });
    expect(pings).toBe(1);
    await expect(transport.pull("account", 0, 10)).resolves.toMatchObject({ next: 0 });
  });
  it("cancels the old pong deadline when reconnecting so it cannot kill the replacement socket", async () => {
    let connected = 0, firstPing!: () => void, replacementPings = 0;
    const pinged = new Promise<void>((resolve) => { firstPing = resolve; }), statuses: string[] = [];
    const url = await server((socket) => {
      const connection = ++connected;
      socket.on("ping", (data) => { if (connection === 1) firstPing(); else { replacementPings++; socket.pong(data); } });
      socket.on("message", (data) => socket.send(JSON.stringify({ requestId: JSON.parse(data.toString()).requestId, message: emptyPage })));
    }, { autoPong: false });
    const transport = client(url, { heartbeatIntervalMs: 20, heartbeatTimeoutMs: 50, onStatusChange: (s) => statuses.push(s) });
    await transport.pull("account", 0, 10); await pinged; transport.disconnect();
    await transport.pull("account", 0, 10);
    await vi.waitFor(() => expect(replacementPings).toBeGreaterThanOrEqual(3), { interval: 5 });
    expect(statuses).toEqual(["connecting", "connected", "offline", "connecting", "connected"]);
    expect(connected).toBe(2);
  });
  it("requests an identity recheck for policy closure, without treating ordinary disconnects as revocation", async () => {
    let peer!: WebSocket;
    const recheck = vi.fn();
    const url = await server((socket) => {
      peer = socket;
      socket.on("message", (data) => socket.send(JSON.stringify({ requestId: JSON.parse(data.toString()).requestId, message: emptyPage })));
    });
    const transport = client(url, { onAccessChanged: recheck });
    await transport.pull("account", 0, 10); peer.close(1008, "Access changed");
    await vi.waitFor(() => expect(recheck).toHaveBeenCalledOnce());
    await transport.pull("account", 0, 10); peer.close(1011, "Reset");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(recheck).toHaveBeenCalledOnce();
  });
  it("delivers a 60-bit approval during a pending pull without dropping or reconnecting the replication socket", async () => {
    const publicKey = bridgeBase64(new Uint8Array(32).fill(7));
    const signingPublicKey = bridgeBase64(new Uint8Array(32).fill(8));
    const approval = { type: "approval", requestId: "request-B", backendId: "B", publicKey, signingPublicKey, label: "New device", platform: "darwin",
      code: await bridgeApprovalCode({ accountId: "account", backendId: "B", publicKey, signingPublicKey }), expiresAt: new Date(Date.now() + 600000).toISOString() };
    const approvals: BridgeApprovalRequest[] = [], statuses: string[] = [];
    let connections = 0, requests = 0;
    const url = await server((socket) => {
      connections++;
      socket.on("message", (data) => {
        if (requests++ === 0) socket.send(JSON.stringify(approval));
        socket.send(JSON.stringify({ requestId: JSON.parse(data.toString()).requestId, message: emptyPage }));
      });
    });
    const transport = client(url, { onApproval: (request) => approvals.push(request), onStatusChange: (status) => statuses.push(status) });
    await expect(transport.pull("account", 0, 100)).resolves.toEqual({ records: [], next: 0, hasMore: false });
    expect(approvals).toEqual([approval]);
    await expect(transport.pull("account", 0, 100)).resolves.toEqual({ records: [], next: 0, hasMore: false });
    expect(connections).toBe(1); expect(statuses).toEqual(["connecting", "connected"]);
  });
  it.each(["ABC234", "ABCDEFGHJKLM", "ABCD-EFGH-JKLO", "ABCD-EFGH-JKLM-", "abcd-efgh-jklm"])("rejects obsolete or malformed approval codes on the wire (%s)", (code) => {
    expect(() => parseBridgeServerFrame(JSON.stringify({ type: "approval", requestId: "request-B", backendId: "B",
      publicKey: bridgeBase64(new Uint8Array(32).fill(7)), label: "New device", platform: "darwin", code,
      expiresAt: "2026-10-17T12:00:00Z" }))).toThrow("Invalid Bridge approval");
  });
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
