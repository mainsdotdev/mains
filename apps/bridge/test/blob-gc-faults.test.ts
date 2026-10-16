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
  store; quota; collector; failure = null;
  initialize() {
    if (this.store) return;
    this.store = createHubStore(this.ctx.storage);
    this.quota = createBlobQuota(this.ctx.storage, this.env, () => this.store.recordBytes());
    this.collector = createBlobCollector(this.ctx.storage, { delete: async (keys) => {
      if (this.failure === "before") throw new Error("R2 unavailable");
      await this.env.BLOBS.delete(keys);
      if (this.failure === "after") throw new Error("crash before SQLite receipt");
    } });
  }
  async fetch(request) {
    this.initialize();
    await this.quota.status("test");
    const prefix = await bridgeAccountPrefix("test");
    const input = await request.json();
    this.failure = input.failure ?? null;
    if (input.op === "seed") {
      const key = prefix + "a".repeat(43) + "/0";
      await this.env.BLOBS.put(key, new Uint8Array(140));
      this.ctx.storage.sql.exec("INSERT INTO quota_chunks VALUES(?,140,1,0)", key);
      this.ctx.storage.sql.exec("UPDATE blob_objects SET delete_after=0");
    }
    if (input.op === "collect") {
      try { await this.collector.collect(); }
      catch (error) { return Response.json({ error: error.message }); }
    }
    const inventory = this.ctx.storage.sql.exec("SELECT blob_bytes,reserved_bytes FROM quota_usage").toArray()[0];
    const objects = (await this.env.BLOBS.list()).objects.length;
    const publishable = this.quota.hasBlobs([{ blobId: "a".repeat(43), size: 100 }]);
    return Response.json({ ...inventory, objects, publishable });
  }
}
export default { fetch(request, env) { return env.PROBE.get(env.PROBE.idFromName("test")).fetch(request); } };
`;

it("keeps failed deletes charged and retries the crash between R2 deletion and its receipt after eviction", async () => {
  const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd(), sourcefile: "gc-probe.ts" }, bundle: true, write: false,
    format: "esm", platform: "browser", target: "es2022", external: ["cloudflare:workers"] });
  const mf = new Miniflare(convertV4MiniflareOptions({ name: "gc-fault-test", modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-07-30", host: "127.0.0.1", port: 0, unsafeInspectDurableObjects: true,
    durableObjects: { PROBE: { className: "GcProbe", useSQLite: true } }, r2Buckets: { BLOBS: "gc-fault-test" } }));
  try {
    const url = await mf.ready;
    const call = async (input: object) => {
      const response = await fetch(url, { method: "POST", body: JSON.stringify(input) });
      expect(response.ok).toBe(true); return response.json();
    };
    expect(await call({ op: "seed" })).toEqual({ blob_bytes: 140, reserved_bytes: 0, objects: 1, publishable: true });
    expect(await call({ op: "collect", failure: "before" })).toEqual({ error: "R2 unavailable" });
    expect(await call({ op: "status" })).toEqual({ blob_bytes: 140, reserved_bytes: 0, objects: 1, publishable: false });
    expect(await call({ op: "collect", failure: "after" })).toEqual({ error: "crash before SQLite receipt" });
    expect(await call({ op: "status" })).toEqual({ blob_bytes: 140, reserved_bytes: 0, objects: 0, publishable: false });
    const ns = await mf.getDurableObjectNamespace("PROBE");
    await mf.unsafeEvictDurableObject("gc-fault-test", "GcProbe", { id: ns.idFromName("test").toString() });
    expect(await call({ op: "collect" })).toEqual({ blob_bytes: 0, reserved_bytes: 0, objects: 0, publishable: false });
    expect(await call({ op: "collect" })).toEqual({ blob_bytes: 0, reserved_bytes: 0, objects: 0, publishable: false });
  } finally { await mf.dispose(); }
});
