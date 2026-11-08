import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { expect, it } from "vitest";

// Faults exist only in this disposable workerd boundary. Production has no
// maintenance endpoint or bucket mocks; collection/receipts are the real helpers.
const source = `
import { DurableObject } from "cloudflare:workers";
import { createHubStore } from "./src/store.ts";
import { createBlobQuota, bridgeAccountPrefix } from "./src/quota.ts";
import { createBlobCollector } from "./src/blob-gc.ts";
export class GcProbe extends DurableObject {
  store; quota; collector; failure = null; deletes = 0;
  initialize() {
    if (this.store) return;
    this.store = createHubStore(this.ctx.storage);
    this.quota = createBlobQuota(this.ctx.storage, this.env, () => this.store.recordBytes());
    this.collector = createBlobCollector(this.ctx.storage, { get: (key) => this.env.BLOBS.get(key), delete: async (keys) => {
      this.deletes++;
      if (this.failure === "before" || this.failure === "first" && keys.some(key => key.includes('/'+'a'.repeat(43)+'/'))) throw new Error("R2 unavailable");
      await this.env.BLOBS.delete(keys);
      if (this.failure === "after") throw new Error("crash before SQLite receipt");
    } }, { head: (key) => this.env.ARCHIVE.head(key), put: async (...args) => {
      if (this.failure === "archive") throw new Error("Archive unavailable");
      return this.env.ARCHIVE.put(...args);
    } });
  }
  async fetch(request) {
    this.initialize();
    await this.quota.status("test");
    const prefix = await bridgeAccountPrefix("test");
    const input = await request.json();
    if (input.op === "attempts") return Response.json(this.deletes);
    if (input.op === "failReceipt") {
      this.ctx.storage.sql.exec(input.enabled ? "CREATE TRIGGER fail_deletion_receipt BEFORE DELETE ON blob_deletions BEGIN SELECT RAISE(ABORT,'Injected deletion receipt failure'); END" : "DROP TRIGGER IF EXISTS fail_deletion_receipt");
    }
    this.failure = input.failure ?? null;
    const identity = { accountId: 'test', backendId: 'A', expiresAt: Date.now()+3600000 };
    const key = prefix + (input.id ?? "a").repeat(43) + "/0";
    if (input.op === "reserve") await this.quota.reserve(identity, [{key,bytes:140}], Date.now()+600000);
    if (input.op === "put") await this.quota.put(identity, key, Date.now()+600000, new Uint8Array(140).fill(9), work => this.ctx.blockConcurrencyWhile(work));
    if (input.op === "seed") {
      const id = (input.id ?? "a").repeat(43);
      const key = prefix + id + "/0";
      await this.env.BLOBS.put(key, new Uint8Array(140));
      this.ctx.storage.sql.exec("INSERT INTO quota_chunks VALUES(?,140,1,0)", key);
      this.ctx.storage.sql.exec("UPDATE blob_objects SET delete_after=? WHERE blob_id=?", input.deadline ?? 0, id);
    }
    if (input.op === "collect") {
      const failure = await this.ctx.blockConcurrencyWhile(async () => {
        try { await this.collector.collect(); return null; }
        catch (error) { return error.message; }
      });
      if (failure) return Response.json({ error: failure });
    }
    const inventory = this.ctx.storage.sql.exec("SELECT blob_bytes,reserved_bytes FROM quota_usage").toArray()[0];
    const objects = (await this.env.BLOBS.list()).objects.length;
    const publishable = this.quota.hasBlobs([{ blobId: "a".repeat(43), size: 100 }]);
    const copies = (await this.env.ARCHIVE.list()).objects.length;
    return Response.json({ ...inventory, objects, copies, publishable });
  }
}
export default { fetch(request, env) { return env.PROBE.get(env.PROBE.idFromName("test")).fetch(request); } };
`;

async function fixture() {
  const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd(), sourcefile: "gc-probe.ts" }, bundle: true, write: false,
    format: "esm", platform: "browser", target: "es2022", external: ["cloudflare:workers"] });
  const mf = new Miniflare(convertV4MiniflareOptions({ name: "gc-fault-test", modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-07-30", host: "127.0.0.1", port: 0, unsafeInspectDurableObjects: true, bindings: { BRIDGE_DEV_AUTH: "true" },
    durableObjects: { PROBE: { className: "GcProbe", useSQLite: true } }, r2Buckets: { BLOBS: "gc-fault-test", ARCHIVE: "gc-fault-test-archive" } }));
  const url = await mf.ready;
  const call = async (input: object) => {
    const response = await fetch(url, { method: "POST", body: JSON.stringify(input) });
    expect(response.ok).toBe(true); return response.json();
  };
  return { mf, call };
}

it("keeps failed deletes charged and retries the crash between R2 deletion and its receipt after eviction", async () => {
  const { mf, call } = await fixture();
  try {
    expect(await call({ op: "seed" })).toEqual({ blob_bytes: 140, reserved_bytes: 0, objects: 1, copies: 0, publishable: true });
    expect(await call({ op: "collect", failure: "archive" })).toEqual({ error: "Archive unavailable" });
    expect(await call({ op: "status" })).toEqual({ blob_bytes: 140, reserved_bytes: 0, objects: 1, copies: 0, publishable: false });
    expect(await call({ op: "collect", failure: "before" })).toEqual({ error: "R2 unavailable" });
    expect(await call({ op: "status" })).toEqual({ blob_bytes: 140, reserved_bytes: 0, objects: 1, copies: 1, publishable: false });
    expect(await call({ op: "collect", failure: "after" })).toEqual({ error: "crash before SQLite receipt" });
    expect(await call({ op: "status" })).toEqual({ blob_bytes: 140, reserved_bytes: 0, objects: 0, copies: 1, publishable: false });
    const ns = await mf.getDurableObjectNamespace("PROBE");
    await mf.unsafeEvictDurableObject("gc-fault-test", "GcProbe", { id: ns.idFromName("test").toString() });
    expect(await call({ op: "collect" })).toEqual({ blob_bytes: 0, reserved_bytes: 0, objects: 0, copies: 1, publishable: false });
    expect(await call({ op: "collect" })).toEqual({ blob_bytes: 0, reserved_bytes: 0, objects: 0, copies: 1, publishable: false });
  } finally { await mf.dispose(); }
});

it("keeps one failed deletion charged without blocking other due blobs in the same batch", async () => {
  const { mf, call } = await fixture();
  try {
    await call({ op: "seed", id: "a", deadline: 0 });
    await call({ op: "seed", id: "b", deadline: 1 });
    expect(await call({ op: "collect", failure: "first" })).toEqual({ error: "R2 unavailable" });
    expect(await call({ op: "status" })).toEqual({ blob_bytes: 140, reserved_bytes: 0, objects: 1, copies: 2, publishable: false });
    expect(await call({ op: "attempts" })).toBe(2);
    expect(await call({ op: "collect", failure: "first" })).toEqual({ error: "R2 unavailable" });
    expect(await call({ op: "attempts" })).toBe(3);
    const bucket = await mf.getR2Bucket("BLOBS");
    expect((await bucket.list()).objects.map((object) => object.key.split("/")[1])).toEqual(["a".repeat(43)]);
    expect(await call({ op: "collect" })).toEqual({ blob_bytes: 0, reserved_bytes: 0, objects: 0, copies: 2, publishable: false });
  } finally { await mf.dispose(); }
});

it("finishes a pending deletion before reserving and republishing the same blob", async () => {
  const { mf, call } = await fixture();
  try {
    await call({ op: "seed" });
    expect(await call({ op: "collect", failure: "after" })).toEqual({ error: "crash before SQLite receipt" });
    expect(await call({ op: "status" })).toEqual({ blob_bytes: 140, reserved_bytes: 0, objects: 0, copies: 1, publishable: false });
    expect(await call({ op: "reserve" })).toEqual({ blob_bytes: 0, reserved_bytes: 140, objects: 0, copies: 1, publishable: false });
    expect(await call({ op: "put" })).toEqual({ blob_bytes: 140, reserved_bytes: 0, objects: 1, copies: 1, publishable: true });
    const objects = (await (await mf.getR2Bucket("BLOBS")).list()).objects;
    const bytes = await (await (await mf.getR2Bucket("BLOBS")).get(objects[0].key))!.arrayBuffer();
    expect(new Uint8Array(bytes).every((byte) => byte === 9)).toBe(true);
    expect(await call({ op: "collect" })).toEqual({ blob_bytes: 140, reserved_bytes: 0, objects: 1, copies: 1, publishable: true });
  } finally { await mf.dispose(); }
});

it("rolls back every SQL deletion effect and its quota change when the final receipt fails", async () => {
  const { mf, call } = await fixture();
  try {
    await call({ op: "seed" }); await call({ op: "failReceipt", enabled: true });
    expect(await call({ op: "collect" })).toMatchObject({ error: expect.stringContaining("Injected deletion receipt failure") });
    expect(await call({ op: "status" })).toEqual({ blob_bytes: 140, reserved_bytes: 0, objects: 0, copies: 1, publishable: false });
    await call({ op: "failReceipt", enabled: false });
    const ns = await mf.getDurableObjectNamespace("PROBE");
    await mf.unsafeEvictDurableObject("gc-fault-test", "GcProbe", { id: ns.idFromName("test").toString() });
    expect(await call({ op: "collect" })).toEqual({ blob_bytes: 0, reserved_bytes: 0, objects: 0, copies: 1, publishable: false });
    expect(await call({ op: "collect" })).toEqual({ blob_bytes: 0, reserved_bytes: 0, objects: 0, copies: 1, publishable: false });
  } finally { await mf.dispose(); }
});
