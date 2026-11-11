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
  it("recovers from credential acquisition failure without retaining a broken connecting owner", async () => {
    let connections = 0;
    const url = await server((socket) => {
      connections++;
      socket.on("message", (data) => socket.send(JSON.stringify({ requestId: JSON.parse(data.toString()).requestId, message: emptyPage })));
    });
    const transport = client(url, { token: vi.fn().mockRejectedValueOnce(new Error("Credentials offline")).mockReturnValue("test-only") });
    await expect(transport.pull("account", 0, 10)).rejects.toThrow("Credentials offline");
    await expect(transport.pull("account", 0, 10)).resolves.toMatchObject({ next: 0 });
    expect(connections).toBe(1);
  });

  it("rejects every lost RPC and restores watched subscriptions on the replacement socket", async () => {
    let connections = 0, pending = 0;
    const restored: unknown[] = [];
    const url = await server((socket) => {
      const current = ++connections;
      socket.on("message", (data) => {
        const { requestId, message } = JSON.parse(data.toString());
        if (message.type === "subscribe") {
          if (current === 2) restored.push(message.streams);
          socket.send(JSON.stringify({ requestId, message: { type: "subscribed", streams: message.streams } }));
        } else if (current === 1) { if (++pending === 2) socket.close(1011, "Reset"); }
        else socket.send(JSON.stringify({ requestId, message: emptyPage }));
      });
    });
    const transport = client(url);
    await transport.subscribe(["account", "run:r"]);
    const result = await Promise.allSettled([transport.pull("account", 0, 10), transport.pull("account", 0, 10)]);
    expect(result.map((entry) => entry.status)).toEqual(["rejected", "rejected"]);
    await expect(transport.pull("account", 0, 10)).resolves.toMatchObject({ next: 0 });
    expect(restored).toEqual([["account", "run:r"]]);
  });

  it("retires token waiters immediately and reconnects without waiting for the old credential read", async () => {
    let release!: (token: string) => void, rejected = false, connections = 0;
    const token = vi.fn().mockImplementationOnce(() => new Promise<string>((resolve) => { release = resolve; })).mockReturnValue("test-only");
    const url = await server((socket) => {
      connections++;
      socket.on("message", (data) => socket.send(JSON.stringify({ requestId: JSON.parse(data.toString()).requestId, message: emptyPage })));
    });
    const transport = client(url, { token });
    const old = transport.pull("account", 0, 10).catch(() => { rejected = true; });
    try {
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      transport.disconnect();
      await expect(transport.pull("account", 0, 10)).resolves.toMatchObject({ next: 0 });
      expect(rejected).toBe(true);
      expect(connections).toBe(1);
    } finally { release("old-token"); await old; }
  });

  it("shares connection acquisition with a request started by its connecting notification", async () => {
    let connections = 0, nested: Promise<unknown> | undefined, entering = false;
    const url = await server((socket) => {
      connections++;
      socket.on("message", (data) => socket.send(JSON.stringify({ requestId: JSON.parse(data.toString()).requestId, message: emptyPage })));
    });
    const transport = client(url, { requestTimeoutMs: 150, onStatusChange(status) {
      if (status === "connecting" && !entering) { entering = true; nested = transport.pull("account", 0, 10); }
    } });
    const first = transport.pull("account", 0, 10);
    // Observe both failures immediately so a broken acquisition cannot escape as an unhandled rejection.
    const results = await Promise.allSettled([first, Promise.resolve().then(() => nested)]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(connections).toBe(1);
  });

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
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    transport.close(); release("late-token"); await result;
  });
  it("requires encrypted transport outside loopback and keeps credentials out of URLs", () => {
    expect(() => client("ws://example.com/v1/log")).toThrow("wss");
    expect(() => client("wss://example.com/v1/log?token=secret")).toThrow("Authorization");
    expect(() => client("wss://name:secret@example.com/v1/log")).toThrow("Authorization");
  });
});
