import { createHash, randomBytes, randomUUID } from "node:crypto";
import WebSocket from "ws";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { BRIDGE_BLOB_CHUNK_BYTES, BRIDGE_BLOB_GC_GRACE_MS, type BridgeBlobIdentity, type BridgeBlobPresignResult } from "@mains/contracts/bridge-blobs";
import { BRIDGE_IDLE_RETENTION_MS, type BridgeClientMessage, type BridgeEnvelope, type BridgeRpcResponse, type BridgeServerMessage } from "@mains/contracts/bridge-protocol";
import type { BridgeQuota } from "@mains/contracts/bridge";
import { startLocalBridgeHub } from "./local-hub.mjs";

let hub: Awaited<ReturnType<typeof startLocalBridgeHub>>;
const sockets: WebSocket[] = [];
beforeAll(async () => { hub = await startLocalBridgeHub(); });
afterEach(() => { for (const socket of sockets.splice(0)) socket.terminate(); });
afterAll(async () => { await hub?.dispose(); });
const opaque = (id: string) => createHash("sha256").update(id).digest().subarray(0,16).toString("base64url");
const blob = (size = 1024): BridgeBlobIdentity => ({ blobId: randomBytes(32).toString("base64url"), size });
function record(id: string, blobs: BridgeBlobIdentity[] | undefined = [], clock = 1): BridgeEnvelope {
  return { header: { v: 1, stream: "account", rowKey: opaque(id), registerKey: opaque(`${id}:row`), origin: "A", op: "upsert", hlc: { physicalMs: clock, counter: 0 }, ...(blobs === undefined ? {} : { blobs }) },
    body: { nonce: randomBytes(24).toString("base64url"), payload: randomBytes(64).toString("base64url") } };
}
function deletion(row: BridgeEnvelope): BridgeEnvelope {
  const { registerKey: _register, blobs: _blobs, retention: _retention, ...base } = row.header; void [_register, _blobs, _retention];
  return { ...row, header: { ...base, op: "delete" } };
}
async function client(account: string, backend = "A") {
  const socket = new WebSocket(hub.wsUrl, { headers: { Authorization: `Bearer ${await hub.token(account, backend)}` } });
  sockets.push(socket);
  const pending = new Map<string, { resolve(value: BridgeServerMessage): void; reject(error: Error): void }>();
  socket.on("message", (data) => {
    const frame = JSON.parse(data.toString()) as BridgeRpcResponse;
    const call = pending.get(frame.requestId); if (!call) return;
    pending.delete(frame.requestId);
    if ("error" in frame) call.reject(new Error(frame.error.message)); else call.resolve(frame.message);
  });
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  const rpc = (message: BridgeClientMessage) => new Promise<BridgeServerMessage>((resolve, reject) => {
    const requestId = randomUUID(); pending.set(requestId, { resolve, reject }); socket.send(JSON.stringify({ requestId, message }));
  });
  return {
    rpc,
    push(records: BridgeEnvelope[]) { return rpc({ type: "push", stream: records[0].header.stream, records }); },
    compact() { return rpc({ type: "compact" }); },
  };
}
async function request(account: string, path: string, body?: unknown) {
  return fetch(new URL(path, hub.url), { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${await hub.token(account, "A")}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function usage(account: string) {
  const response = await request(account, "/v1/quota");
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<BridgeQuota>;
}
async function presign(account: string, ref: BridgeBlobIdentity, op = "put") {
  const response = await request(account, "/v1/blobs/presign", { op, blobs: [ref] });
  expect(response.status).toBe(200);
  return (await response.json() as BridgeBlobPresignResult).blobs[0];
}
async function upload(account: string, ref: BridgeBlobIdentity) {
  const signed = await presign(account, ref), keys: string[] = [];
  for (const chunk of signed.chunks) {
    const payload = JSON.parse(Buffer.from(new URL(chunk.url).searchParams.get("cap")!.split(".")[1], "base64url").toString());
    keys.push(payload.key);
    const length = Math.min(BRIDGE_BLOB_CHUNK_BYTES, ref.size - chunk.index * BRIDGE_BLOB_CHUNK_BYTES) + 40;
    expect((await fetch(chunk.url, { method: "PUT", body: randomBytes(length) })).status).toBe(204);
  }
  return { signed, keys };
}
async function elapseGrace(account: string) {
  // Only the disposable local DO clock is advanced; production keeps its 24h grace.
  await hub.quotaSql(account, "UPDATE blob_objects SET delete_after=0 WHERE refs=0");
}
async function exists(keys: string[]) { return Promise.all(keys.map(async (key) => !!await (await hub.bucket()).head(key))); }

describe("R2 collection through the real local Worker/DO/R2 runtime", () => {
  it("reclaims deleted files from physical R2 and quota after grace, preserving every live/shared register", async () => {
    const account = randomUUID(), a = await client(account), shared = blob(), removed = blob(2048);
    const kept = await upload(account, shared), gone = await upload(account, removed);
    const first = record("first", [shared]), second = record("second", [shared]), file = record("removed", [removed]);
    await a.push([first, second, file]);
    expect(await usage(account)).toMatchObject({ blobBytes: shared.size + removed.size + 80, reservedBytes: 0 });
    await a.push([deletion(first), deletion(file)]);
    await a.compact();
    const grace = await hub.quotaSql(account, "SELECT refs,delete_after FROM blob_objects ORDER BY refs") as { refs: number; delete_after: number | null }[];
    expect(grace[0]).toMatchObject({ refs: 0 });
    expect(grace[0].delete_after!).toBeGreaterThan(Date.now() + BRIDGE_BLOB_GC_GRACE_MS - 5000);
    expect(grace[1]).toEqual({ refs: 1, delete_after: null });
    expect(await exists([...kept.keys, ...gone.keys])).toEqual([true, true]);
    const read = await presign(account, removed, "get");
    expect((await fetch(read.chunks[0].url)).status).toBe(200);
    await elapseGrace(account); await hub.evict(account); await a.compact();
    expect(await exists(gone.keys)).toEqual([false]); expect(await exists(kept.keys)).toEqual([true]);
    expect(await usage(account)).toMatchObject({ blobBytes: shared.size + 40, reservedBytes: 0 });
    const after = await usage(account);
    expect(after.usedBytes).toBe(after.recordBytes + shared.size + 40);
    expect((await fetch(read.chunks[0].url)).status).toBe(404);
    expect(await a.push([first])).toMatchObject({ results: [{ deleted: deletion(first) }] });
    await a.push([deletion(second)]); await a.compact(); await elapseGrace(account); await a.compact();
    expect(await usage(account)).toMatchObject({ blobBytes: 0, reservedBytes: 0 });
    expect(await exists(kept.keys)).toEqual([false]);
    const stable = await usage(account); await a.compact(); await hub.evict(account);
    expect(await usage(account)).toEqual(stable); // No double subtraction after retry/restart.
  });

  it("protects an attachment in another run and expires only idle mirror blobs", async () => {
    const account = randomUUID(), a = await client(account), shared = blob(), mirrorBlob = blob(512);
    const file = await upload(account, shared), mirrorFile = await upload(account, mirrorBlob);
    const roots = ["one", "two"].map((runId) => {
      const row = record(`root-${runId}`); return { ...row, header: { ...row.header, owner: "A", runId } };
    });
    await a.push(roots);
    const children = roots.map((root) => {
      const row = record("reused", [shared]); return { ...row, header: { ...row.header, owner: "A", runId: root.header.runId, stream: `run:${root.header.runId}` as const } };
    });
    for (const child of children) await a.push([child]);
    const row = record("mirror", [mirrorBlob]);
    const mirror: BridgeEnvelope = { ...row, header: { ...row.header, stream: "run:two", runId: "two", owner: "A", retention: "30d-idle" } };
    await a.push([mirror]); await a.push([deletion(roots[0])]); await a.compact(); await elapseGrace(account); await a.compact();
    expect(await exists(file.keys)).toEqual([true]);
    await hub.quotaSql(account, `UPDATE stream_activity SET last_activity=${Date.now() - BRIDGE_IDLE_RETENTION_MS - 1000} WHERE stream='run:two'`);
    await a.compact(); await elapseGrace(account); await a.compact();
    expect(await exists(mirrorFile.keys)).toEqual([false]); expect(await exists(file.keys)).toEqual([true]);
    expect(await usage(account)).toMatchObject({ blobBytes: shared.size + 40 });
  });

  it("retains superseded log blobs until compaction, then reclaims them while keeping the latest version", async () => {
    const account = randomUUID(), a = await client(account), old = blob(), latest = blob(1536);
    const oldFile = await upload(account, old), newFile = await upload(account, latest);
    await a.push([record("version", [old]), record("version", [latest], 2)]);
    await elapseGrace(account); // Log versions still hold roots, so neither is eligible.
    expect(await exists(oldFile.keys)).toEqual([true]);
    const page = await a.rpc({ type: "pull", stream: "account", after: 0, limit: 100 });
    expect(page).toMatchObject({ records: [{ seq: 1 }, { seq: 2 }] });
    await a.compact(); await elapseGrace(account); await a.compact();
    expect(await exists(oldFile.keys)).toEqual([false]); expect(await exists(newFile.keys)).toEqual([true]);
    expect(await usage(account)).toMatchObject({ blobBytes: latest.size + 40 });
  });

  it("collects abandoned multi-chunk uploads/reservations and refuses stale PUTs and dangling manifests", async () => {
    const account = randomUUID(), a = await client(account), ref = blob(BRIDGE_BLOB_CHUNK_BYTES + 100);
    const signed = await presign(account, ref);
    expect((await fetch(signed.chunks[0].url, { method: "PUT", body: randomBytes(BRIDGE_BLOB_CHUNK_BYTES + 40) })).status).toBe(204);
    expect(await a.push([record("incomplete", [ref])])).toMatchObject({ results: [{ error: "blobMissing" }] });
    expect(await usage(account)).toMatchObject({ blobBytes: BRIDGE_BLOB_CHUNK_BYTES + 40, reservedBytes: 140 });
    await a.compact(); expect((await usage(account)).blobBytes).toBeGreaterThan(0);
    await elapseGrace(account); await a.compact();
    expect(await usage(account)).toMatchObject({ blobBytes: 0, reservedBytes: 0, recordBytes: 0 });
    expect((await fetch(signed.chunks[1].url, { method: "PUT", body: randomBytes(140) })).status).toBe(403);
    expect(await a.push([record("incomplete", [ref])])).toMatchObject({ results: [{ error: "blobMissing" }] });
    const retried = await upload(account, ref);
    expect(await a.push([record("incomplete", [ref])])).toMatchObject({ results: [{ seq: 1 }] });
    await elapseGrace(account); await a.compact(); expect(await exists(retried.keys)).toEqual([true, true]);
  });

  it("renews an in-flight upload's grace and keeps identical blob ids isolated between accounts", async () => {
    const first = randomUUID(), second = randomUUID(), a = await client(first), b = await client(second), ref = blob();
    const one = await upload(first, ref), two = await upload(second, ref);
    await b.push([record("live", [ref])]);
    await elapseGrace(first); await presign(first, ref); await a.compact();
    expect(await exists(one.keys)).toEqual([true]);
    await elapseGrace(first); await a.compact();
    expect(await exists(one.keys)).toEqual([false]); expect(await exists(two.keys)).toEqual([true]);
    expect(await usage(first)).toMatchObject({ blobBytes: 0 }); expect(await usage(second)).toMatchObject({ blobBytes: ref.size + 40 });
  });

  it("protects a download started near collection until its signed read capability expires", async () => {
    const account = randomUUID(), a = await client(account), ref = blob(), file = await upload(account, ref);
    await elapseGrace(account);
    const read = await presign(account, ref, "get");
    await a.compact(); expect(await exists(file.keys)).toEqual([true]);
    const rows = await hub.quotaSql(account, "SELECT delete_after FROM blob_objects") as { delete_after: number }[];
    expect(rows[0].delete_after).toBeGreaterThan(Date.now() + 9 * 60_000);
    expect((await fetch(read.chunks[0].url)).status).toBe(200);
    await elapseGrace(account); await a.compact(); expect(await exists(file.keys)).toEqual([false]);
  });

  it("blocks GC for legacy manifests and upgrades only the original writer's exact clock", async () => {
    const account = randomUUID(), a = await client(account), b = await client(account, "B"), ref = blob(), orphan = blob();
    const live = await upload(account, ref), unused = await upload(account, orphan);
    const legacy = record("legacy"); delete legacy.header.blobs;
    await a.push([legacy]); await elapseGrace(account); await a.compact();
    expect(await exists(unused.keys)).toEqual([true]); // Its liveness is still unknown.
    const upgrade = { ...legacy, header: { ...legacy.header, blobs: [ref] } } as BridgeEnvelope;
    expect(await b.push([upgrade])).toMatchObject({ results: [{ error: "notOwner" }] });
    expect(await a.push([{ ...upgrade, header: { ...upgrade.header, hlc: { physicalMs: 0, counter: 0 } } }])).toMatchObject({ results: [{ seq: 1 }] });
    expect(await a.push([upgrade])).toMatchObject({ results: [{ seq: 2 }] });
    await a.compact();
    expect(await exists(live.keys)).toEqual([true]); expect(await exists(unused.keys)).toEqual([false]);
    expect(await usage(account)).toMatchObject({ blobBytes: ref.size + 40 });
    await hub.evict(account);
    expect(await hub.quotaSql(account, "SELECT legacy_records FROM blob_gc_state")).toEqual([{ legacy_records: 0 }]);
  });

  it("bounds each collection batch and drains the remainder through the real Durable Object alarm", async () => {
    const account = randomUUID(), a = await client(account);
    for (let i = 0; i < 33; i++) await upload(account, blob(1));
    await elapseGrace(account); await a.compact();
    expect((await usage(account)).blobBytes).toBe(41);
    // Status never performs collection; only the scheduled alarm can free this last blob.
    await expect.poll(async () => (await usage(account)).blobBytes, { timeout: 5000, interval: 100 }).toBe(0);
  });
});
