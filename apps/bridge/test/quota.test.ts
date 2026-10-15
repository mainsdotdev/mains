import { randomBytes, randomUUID, createHash } from "node:crypto";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import type { BridgeQuota } from "@mains/contracts/bridge";
import type { BridgeClientMessage, BridgeEnvelope, BridgeRpcResponse, BridgeServerMessage } from "@mains/contracts/bridge-protocol";
import type { BridgeBlobPresignResult } from "@mains/contracts/bridge-blobs";
import { startLocalBridgeHub } from "./local-hub.mjs";

const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture(options: Parameters<typeof startLocalBridgeHub>[0] = { storageLimitBytes: 4096 }) {
  const hub = await startLocalBridgeHub(options); cleanup.push(() => hub.dispose());
  return hub;
}
type Hub = Awaited<ReturnType<typeof fixture>>;
const opaque = (id: string) => createHash("sha256").update(id).digest().subarray(0,16).toString("base64url");
function record(id: string, size = 64, op: "upsert" | "delete" = "upsert"): BridgeEnvelope {
  const base = { v: 1 as const, stream: "account" as const, rowKey: opaque(id), origin: "A", hlc: { physicalMs: Date.now(), counter: 0 } };
  return { header: op === "delete" ? { ...base, op } : { ...base, op, registerKey: opaque(id + "row") }, body: { nonce: randomBytes(24).toString("base64url"), payload: randomBytes(size).toString("base64url") } };
}
async function connect(hub: Hub, account: string, backend = "A") {
  const socket = new WebSocket(hub.wsUrl, { headers: { Authorization: `Bearer ${await hub.token(account, backend)}` } });
  cleanup.push(() => socket.terminate());
  const pending = new Map<string, (message: BridgeServerMessage) => void>();
  socket.on("message", (bytes) => {
    const frame = JSON.parse(bytes.toString()) as BridgeRpcResponse;
    if ("message" in frame) { pending.get(frame.requestId)?.(frame.message); pending.delete(frame.requestId); }
  });
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  return { socket, rpc(message: BridgeClientMessage): Promise<BridgeServerMessage> {
    return new Promise((resolve) => { const requestId = randomUUID(); pending.set(requestId, resolve); socket.send(JSON.stringify({ requestId, message })); });
  } };
}
async function request(hub: Hub, account: string, path: string, body?: unknown, backend = "A") {
  return fetch(new URL(path, hub.url), { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${await hub.token(account, backend)}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function usage(hub: Hub, account: string) { return (await request(hub, account, "/v1/quota")).json() as Promise<BridgeQuota>; }
const presign = (hub: Hub, account: string, blobId: string, size: number) => request(hub, account, "/v1/blobs/presign", { op: "put", blobs: [{ blobId, size }] });

describe("Bridge account quotas in real workerd, SQLite and R2", () => {
  it("charges only current registers, acknowledges partial batches and permits reads/deletes while full", async () => {
    const hub = await fixture(), account = randomUUID(), a = await connect(hub, account);
    const large = record("large", 2500), other = record("other", 900);
    expect(await a.rpc({ type: "push", stream: "account", records: [large, other] })).toMatchObject({ type: "ack", results: [{ seq: 1 }, { error: "quotaExceeded" }] });
    const before = await usage(hub, account); expect(before.usedBytes).toBe(Buffer.byteLength(JSON.stringify(large)));
    expect(await a.rpc({ type: "push", stream: "account", records: [large] })).toMatchObject({ results: [{ seq: 1 }] });
    expect((await usage(hub, account)).usedBytes).toBe(before.usedBytes);
    expect(await a.rpc({ type: "pull", stream: "account", after: 0, limit: 100 })).toMatchObject({ records: [{ seq: 1 }] });
    const deletion = record("large", 64, "delete");
    expect(await a.rpc({ type: "push", stream: "account", records: [deletion, other] })).toMatchObject({ results: [{ seq: 2 }, { seq: 3 }] });
    const after = await usage(hub, account);
    expect(after.usedBytes).toBe(Buffer.byteLength(JSON.stringify(deletion)) + Buffer.byteLength(JSON.stringify(other)));
    expect(after.usedBytes).toBeLessThan(before.usedBytes);
    expect(await a.rpc({ type: "push", stream: "account", records: [large] })).toMatchObject({ results: [{ deleted: deletion }] });
    a.socket.terminate(); await hub.restart(); expect(await usage(hub, account)).toEqual(after);
  });
  it("reserves concurrent uploads atomically, deduplicates retries and keeps accounts isolated", async () => {
    const hub = await fixture(), account = randomUUID(), first = randomBytes(32).toString("base64url"), second = randomBytes(32).toString("base64url");
    const replies = await Promise.all([presign(hub, account, first, 3000), presign(hub, account, second, 3000)]);
    expect(replies.map((entry) => entry.status).sort()).toEqual([200, 413]);
    const acceptedIndex = replies.findIndex((entry) => entry.ok), accepted = await replies[acceptedIndex].json() as BridgeBlobPresignResult;
    const id = acceptedIndex ? second : first, url = accepted.blobs[0].chunks[0].url;
    expect((await usage(hub, account))).toMatchObject({ usedBytes: 3040, reservedBytes: 3040, blobBytes: 0 });
    expect((await presign(hub, account, id, 3000)).status).toBe(200);
    expect((await usage(hub, account)).usedBytes).toBe(3040);
    const bytes = randomBytes(3040);
    expect((await fetch(url, { method: "PUT", body: bytes })).status).toBe(204);
    expect((await fetch(url, { method: "PUT", body: randomBytes(3040) })).status).toBe(204);
    expect(await usage(hub, account)).toMatchObject({ usedBytes: 3040, reservedBytes: 0, blobBytes: 3040 });
    expect((await presign(hub, randomUUID(), second, 3000)).status).toBe(200);
    await hub.restart(); expect(await usage(hub, account)).toMatchObject({ usedBytes: 3040, reservedBytes: 0 });
    const retry = await (await presign(hub, account, id, 3000)).json() as BridgeBlobPresignResult;
    expect(retry.blobs[0].chunks[0].exists).toBe(true);
  });
  it("releases expired reservations and reconciles a crash between an R2 PUT and its SQLite receipt", async () => {
    const hub = await fixture(), account = randomUUID(), id = randomBytes(32).toString("base64url");
    const signed = await (await presign(hub, account, id, 3000)).json() as BridgeBlobPresignResult;
    await hub.quotaSql(account, "UPDATE quota_chunks SET expires_at=0");
    expect((await usage(hub, account)).usedBytes).toBe(0);
    expect((await fetch(signed.blobs[0].chunks[0].url, { method: "PUT", body: randomBytes(3040) })).status).toBe(403);
    const next = await (await presign(hub, account, id, 3000)).json() as BridgeBlobPresignResult;
    const cap = new URL(next.blobs[0].chunks[0].url).searchParams.get("cap")!;
    const key = JSON.parse(Buffer.from(cap.split(".")[1], "base64url").toString()).key;
    await (await hub.bucket()).put(key, randomBytes(3040));
    await hub.quotaSql(account, "UPDATE quota_chunks SET expires_at=0");
    await hub.restart(); expect(await usage(hub, account)).toMatchObject({ usedBytes: 3040, reservedBytes: 0, blobBytes: 3040 });
  });
  it("limits writes per backend while leaving reads, tombstones and another backend available", async () => {
    const hub = await fixture({ writesPerMinute: 2 }), account = randomUUID(), a = await connect(hub, account);
    const one = record("one"), two = record("two");
    expect(await a.rpc({ type: "push", stream: "account", records: [one, two, record("three")] })).toMatchObject({ results: [{ seq: 1 }, { seq: 2 }, { error: "rateLimited" }] });
    expect(await a.rpc({ type: "pull", stream: "account", after: 0, limit: 100 })).toMatchObject({ records: [{ seq: 1 }, { seq: 2 }] });
    expect(await a.rpc({ type: "push", stream: "account", records: [record("one", 64, "delete")] })).toMatchObject({ results: [{ seq: 3 }] });
    expect((await presign(hub, account, randomBytes(32).toString("base64url"), 10)).status).toBe(429);
    expect((await usage(hub, account)).reservedBytes).toBe(0);
    expect((await request(hub, account, "/v1/blobs/presign", { op: "put", blobs: [{ blobId: randomBytes(32).toString("base64url"), size: 10 }] }, "B")).status).toBe(200);
  });
});
