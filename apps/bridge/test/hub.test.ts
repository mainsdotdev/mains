import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import WebSocket from "ws";
import type { BridgeClientMessage, BridgeEnvelope, BridgeRpcResponse, BridgeServerMessage, BridgeStream } from "@mains/contracts/bridge-protocol";
import { BRIDGE_IDLE_RETENTION_MS } from "@mains/contracts/bridge-protocol";
import { startLocalBridgeHub } from "./local-hub.mjs";

let hub: Awaited<ReturnType<typeof startLocalBridgeHub>>;
const sockets: WebSocket[] = [];
beforeAll(async () => { hub = await startLocalBridgeHub(); });
afterEach(() => { for (const socket of sockets.splice(0)) socket.terminate(); });
afterAll(async () => { await hub?.dispose(); });
const opaque = (id: string) => createHash("sha256").update(id).digest().subarray(0,16).toString("base64url");
function record(id: string, clock: number, op: "delete" | "upsert" = "upsert", register = "row", stream: BridgeStream = "account", owner?: string, runId?: string): BridgeEnvelope {
  const base = { v: 1 as const, stream, rowKey: opaque(id), hlc: { physicalMs: clock, counter: 0 }, origin: "A", ...(owner ? { owner } : {}), ...(runId ? { runId } : {}) };
  return { header: op === "delete" ? { ...base, op } : { ...base, op, registerKey: opaque(`${id}:${register}`) },
    body: { nonce: randomBytes(24).toString("base64url"), payload: randomBytes(64).toString("base64url") } };
}
async function connect(account: string, backend = "A") {
  const socket = new WebSocket(hub.wsUrl, { headers: { Authorization: `Bearer ${await hub.token(account, backend)}` } });
  sockets.push(socket);
  const pending = new Map<string, { resolve(value: BridgeServerMessage): void; reject(error: Error): void }>();
  socket.on("message", (data) => {
    const frame = JSON.parse(data.toString()) as BridgeRpcResponse;
    if (!("requestId" in frame)) return;
    const entry = pending.get(frame.requestId); if (!entry) return;
    pending.delete(frame.requestId);
    if ("error" in frame) entry.reject(new Error(frame.error.message)); else entry.resolve(frame.message);
  });
  socket.on("close", () => { for (const entry of pending.values()) entry.reject(new Error("closed")); pending.clear(); });
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  return {
    socket,
    rpc(message: BridgeClientMessage): Promise<BridgeServerMessage> {
      const requestId = randomUUID();
      return new Promise((resolve, reject) => { pending.set(requestId, { resolve, reject }); socket.send(JSON.stringify({ requestId, message })); });
    },
  };
}
async function log(client: Awaited<ReturnType<typeof connect>>, stream: BridgeStream = "account", after = 0) {
  const response = await client.rpc({ type: "pull", stream, after, limit: 1000 });
  if (response.type !== "records") throw new Error("Wrong response"); return response;
}

describe("Cloudflare SQLite Bridge hub", () => {
  it("expires idle ciphertext mirrors without losing history, tombstones or monotonic cursors", async () => {
    const account = randomUUID(), client = await connect(account), stream = "run:mirror" as const;
    const root = record("mirror-root", 1, "upsert", "row", "account", "A", "mirror");
    await client.rpc({ type: "push", stream: "account", records: [root] });
    const mirror = record("mirror-entry", 2, "upsert", "row", stream, "A", "mirror"); mirror.header.retention = "30d-idle";
    const history = record("history", 3, "upsert", "row", stream, "A", "mirror");
    const tombstone = record("deleted-entry", 4, "delete", "row", stream, "A", "mirror");
    await client.rpc({ type: "push", stream, records: [mirror, history, tombstone] });
    const sizeBefore = await hub.quotaSql(account, "SELECT length(envelope) n FROM latest"); expect(sizeBefore.length).toBe(3);
    await hub.quotaSql(account, `UPDATE stream_activity SET last_activity=${Date.now() - BRIDGE_IDLE_RETENTION_MS - 1000}`);
    const activeRoot = structuredClone(root); activeRoot.header.hlc.physicalMs = 5;
    await client.rpc({ type: "push", stream: "account", records: [activeRoot] }); await client.rpc({ type: "compact" });
    expect((await log(client, stream)).records).toHaveLength(3);
    await hub.quotaSql(account, `UPDATE stream_activity SET last_activity=${Date.now() - BRIDGE_IDLE_RETENTION_MS - 1000}`);
    await client.rpc({ type: "compact" });
    expect((await log(client, stream)).records.map((row) => row.envelope)).toEqual([history, tombstone]);
    expect((await log(client, stream, 3)).next).toBe(3);
    expect(await hub.quotaSql(account, "SELECT count(*) n FROM latest")).toMatchObject([{ n: 2 }]);
    // Expiry is not a permanent delete: the same owner can publish the same HLC.
    expect(await client.rpc({ type: "push", stream, records: [mirror] })).toMatchObject({ results: [{ seq: 4 }] });
    expect((await log(client, stream, 3)).records).toEqual([{ seq: 4, envelope: mirror }]);
    const invalid = structuredClone(root); invalid.header.retention = "30d-idle";
    await expect(client.rpc({ type: "push", stream: "account", records: [invalid] })).rejects.toThrow("closed");
  });

  it("requires configured signed dev authentication before selecting an account", async () => {
    expect((await fetch(new URL("/health", hub.url))).status).toBe(200);
    expect((await fetch(new URL("/v1/log", hub.url))).status).toBe(401);
    const response = await fetch(new URL("/v1/log", hub.url), { headers: { Authorization: `Bearer ${await hub.token("account", "A")}` } });
    expect(response.status).toBe(426);
  });
  it("compacts registers independently, preserves a whole lower-clock delete forever and keeps monotonic cursors", async () => {
    const account = randomUUID(), client = await connect(account);
    const content = record("item", 5, "upsert", "content"), metadata = record("item", 6, "upsert", "metadata"), newer = record("item", 7, "upsert", "content");
    await client.rpc({ type: "push", stream: "account", records: [content, metadata, newer] });
    const olderAck = await client.rpc({ type: "push", stream: "account", records: [content] }); expect(olderAck).toMatchObject({ type: "ack", results: [{ seq: 3 }] });
    await client.rpc({ type: "compact" });
    expect((await log(client)).records.map((r) => r.envelope)).toEqual([metadata, newer]);
    const tombstone = record("item", 1, "delete"); await client.rpc({ type: "push", stream: "account", records: [tombstone] }); await client.rpc({ type: "compact" });
    const page = await log(client, "account", 3); expect(page.records).toEqual([{ seq: 4, envelope: tombstone }]);
    expect(await client.rpc({ type: "push", stream: "account", records: [newer] })).toMatchObject({ type: "ack", results: [{ deleted: tombstone }] });
    const fresh = record("fresh-id", 8); await client.rpc({ type: "push", stream: "account", records: [fresh] });
    expect((await log(client, "account", 4)).records).toEqual([{ seq: 5, envelope: fresh }]);
  });
  it("binds run roots to owners and closes a deleted run's stream without reading a body", async () => {
    const account = randomUUID(), a = await connect(account), b = await connect(account, "B");
    const root = record("opaque-root", 1, "upsert", "row", "account", "A", "run-id");
    const child = record("opaque-turn", 2, "upsert", "row", "run:run-id", "A", "run-id");
    await a.rpc({ type: "push", stream: "account", records: [root] }); await a.rpc({ type: "push", stream: "run:run-id", records: [child] });
    const wrong = structuredClone(child); wrong.header.origin="B"; wrong.header.owner="B";
    expect(await b.rpc({ type: "push", stream: "run:run-id", records: [wrong] })).toMatchObject({ type: "ack", results: [{ error: "notOwner" }] });
    const tombstone = record("opaque-root", 0, "delete", "row", "account", "A", "run-id");
    await a.rpc({ type: "push", stream: "account", records: [tombstone] }); await a.rpc({ type: "compact" });
    expect((await log(a, "run:run-id")).records).toEqual([]);
    expect(await a.rpc({ type: "push", stream: "run:run-id", records: [child] })).toMatchObject({ type: "ack", results: [{ deleted: tombstone }] });
  });
  it("rejects a malformed encrypted batch before committing its valid prefix", async () => {
    const account = randomUUID(), client = await connect(account), valid = record("valid-prefix", 1), bad = record("bad", 2);
    bad.body.nonce = null;
    const closed = new Promise<number>((resolve) => client.socket.once("close", resolve));
    client.socket.send(JSON.stringify({ requestId: randomUUID(), message: { type: "push", stream: "account", records: [valid, bad] } }));
    expect(await closed).toBe(1008); expect((await log(await connect(account))).records).toEqual([]);
  });
  it("rejects binary and oversized frames while leaving the durable account usable", async () => {
    const account = randomUUID(), first = await connect(account);
    const closed = new Promise<number>((resolve) => first.socket.once("close", resolve)); first.socket.send(new Uint8Array([1,2])); expect(await closed).toBe(1009);
    const second = await connect(account), oversized = new Promise<number>((resolve) => second.socket.once("close", resolve));
    second.socket.send("x".repeat(16 * 1024 * 1024 + 1)); expect(await oversized).toBe(1009);
    expect((await log(await connect(account))).records).toEqual([]);
  });
});
