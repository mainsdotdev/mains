import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { afterEach, expect, it } from "vitest";
import type { BridgeEnvelope } from "@mains/contracts/bridge-protocol";
import type { BridgeQuota } from "@mains/contracts/bridge";
import { BRIDGE_IDLE_RETENTION_MS } from "@mains/contracts/bridge-protocol";

// Count workerd's real SQLite cursor metrics at the quota/push seam. No remote
// resources, wall-clock timings, SQL mocks or production instrumentation.
const source = `
import { DurableObject } from "cloudflare:workers";
import { createHubStore } from "./src/store.ts";
import { createBlobQuota } from "./src/quota.ts";
export class UsageProbe extends DurableObject {
  cursors = [];
  store; quota;
  initialize() {
    if (this.store) return;
    const storage = {
      sql: { exec: (...args) => { const cursor = this.ctx.storage.sql.exec(...args); this.cursors.push(cursor); return cursor; } },
      transactionSync: (fn) => this.ctx.storage.transactionSync(fn),
    };
    this.store = createHubStore(storage);
    this.quota = createBlobQuota(storage, this.env, () => this.store.recordBytes());
  }
  async fetch(request) {
    this.cursors = [];
    const input = await request.json();
    let value;
    if (input.op === "sql") value = this.ctx.storage.sql.exec(input.query, ...(input.args ?? [])).toArray();
    else {
      this.initialize();
      if (input.op === "push" || input.op === "rollback") {
        const quota = await this.quota.status("test");
        const push = () => this.store.push("A", input.stream ?? "account", input.records,
          { ...quota, blobBytes: quota.blobBytes + quota.reservedBytes });
        if (input.op === "push") value = push();
        else { try { this.ctx.storage.transactionSync(() => { push(); throw new Error("rollback"); }); } catch { value = "rolled back"; } }
      } else if (input.op === "compact") this.store.compact();
      else value = await this.quota.status("test");
    }
    return Response.json({ value, rowsRead: this.cursors.reduce((n, cursor) => n + cursor.rowsRead, 0),
      rowsWritten: this.cursors.reduce((n, cursor) => n + cursor.rowsWritten, 0) });
  }
}
export default { fetch(request, env) { return env.PROBE.get(env.PROBE.idFromName("test")).fetch(request); } };
`;
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function probe() {
  const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd(), sourcefile: "usage-probe.ts" }, bundle: true,
    write: false, format: "esm", platform: "browser", target: "es2022", external: ["cloudflare:workers"] });
  const mf = new Miniflare(convertV4MiniflareOptions({ name: "usage-test", modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-07-30", host: "127.0.0.1", port: 0, unsafeInspectDurableObjects: true,
    durableObjects: { PROBE: { className: "UsageProbe", useSQLite: true } }, r2Buckets: { BLOBS: "usage-test" },
    bindings: { BRIDGE_WRITES_PER_MINUTE: "100000" } }));
  cleanup.push(() => mf.dispose());
  const url = await mf.ready;
  async function call<T>(input: object): Promise<{ value: T; rowsRead: number; rowsWritten: number }> {
    const response = await fetch(url, { method: "POST", body: JSON.stringify(input) });
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<{ value: T; rowsRead: number; rowsWritten: number }>;
  }
  return {
    call,
    async sql(query: string, ...args: (string | number)[]) { return (await call<Record<string, unknown>[]>({ op: "sql", query, args })).value; },
    async evict() {
      const ns = await mf.getDurableObjectNamespace("PROBE");
      await mf.unsafeEvictDurableObject("usage-test", "UsageProbe", { id: ns.idFromName("test").toString() });
    },
  };
}
function record(id: string, clock = 1, size = 64) {
  return { header: { v: 1 as const, stream: "account" as const, rowKey: id, registerKey: id + ":row", origin: "A", op: "upsert" as const, hlc: { physicalMs: clock, counter: 0 } },
    body: { nonce: "opaque", payload: "x".repeat(size) } };
}
const deleted = (row: BridgeEnvelope): BridgeEnvelope => {
  const { registerKey: _register, ...header } = row.header; void _register;
  return { header: { ...header, op: "delete", hlc: { physicalMs: 0, counter: 0 } }, body: { nonce: "opaque", payload: "tombstone" } };
};
const size = (row: BridgeEnvelope) => Buffer.byteLength(JSON.stringify(row));

it("keeps first-upload reads linear and quota reads constant across records, chunks and DO eviction", async () => {
  const p = await probe(), count = 1157;
  let reads = 0, writes = 0;
  for (let start = 0; start < count; start += 100) {
    const records = Array.from({ length: Math.min(100, count - start) }, (_, i) => record(`row-${start + i}`));
    const result = await p.call<{ results: object[] }>({ op: "push", records });
    expect(result.value.results.every((result) => "seq" in result)).toBe(true);
    reads += result.rowsRead;
    writes += result.rowsWritten;
  }
  expect(reads).toBeLessThan(count * 20);
  // Many stored chunks and future reservations must not turn status or expiry
  // reconciliation into a scan. These writes use the real persistent schema.
  await p.sql(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<2000)
    INSERT INTO quota_chunks SELECT 'chunk-'||x,40,x%2,${Date.now() + 3_600_000} FROM n`);
  const first = await p.call<BridgeQuota>({ op: "status" });
  expect(first.value).toMatchObject({ blobBytes: 40_000, reservedBytes: 40_000 });
  expect(first.rowsRead).toBeLessThanOrEqual(8);
  let idleReads = 0;
  for (let i = 0; i < 10; i++) {
    const result = await p.call<BridgeQuota>({ op: "status" });
    expect(result.value).toEqual(first.value); expect(result.rowsWritten).toBe(0);
    idleReads += result.rowsRead;
  }
  expect(idleReads).toBeLessThanOrEqual(80);
  await p.evict();
  const restored = await p.call<BridgeQuota>({ op: "status" });
  expect(restored.value).toEqual(first.value);
  expect(restored.rowsRead).toBeLessThan(25);
  console.info("Local workerd quota metrics", { records: count, firstUploadRowsRead: reads, firstUploadRowsWritten: writes, quotaRowsRead: first.rowsRead, tenIdleQuotaRowsRead: idleReads, afterEvictionRowsRead: restored.rowsRead });
});

it("keeps exact usage through replacements, register deletes, run deletes, expiry and transaction rollback", async () => {
  const p = await probe();
  const push = (records: BridgeEnvelope[], stream = "account", op = "push") => p.call({ op, stream, records });
  const usage = async (expected: number) => expect((await p.call<BridgeQuota>({ op: "status" })).value.recordBytes).toBe(expected);
  const one = record("one"), metadata = { ...one, header: { ...one.header, registerKey: "one:metadata" } };
  await push([one, metadata]); await usage(size(one) + size(metadata));
  const bigger = record("one", 2, 1024), smaller = record("one", 3, 32);
  await push([bigger]); await usage(size(bigger) + size(metadata));
  await push([smaller, bigger, smaller]); await usage(size(smaller) + size(metadata));
  await push([record("rolled-back")], "account", "rollback"); await usage(size(smaller) + size(metadata));
  const tombstone = deleted(one);
  await push([tombstone, bigger]); await usage(size(tombstone));
  const root = { ...record("root"), header: { ...record("root").header, runId: "run", owner: "A" } };
  const child = { ...record("child"), header: { ...record("child").header, stream: "run:run" as const, runId: "run", owner: "A" } };
  const mirror = { ...child, header: { ...child.header, rowKey: "mirror", registerKey: "mirror:row", retention: "30d-idle" as const } };
  await push([root]); await push([child, mirror], "run:run");
  await usage(size(tombstone) + size(root) + size(child) + size(mirror));
  await p.sql("UPDATE stream_activity SET last_activity=?", Date.now() - BRIDGE_IDLE_RETENTION_MS - 1000);
  await p.call({ op: "compact" }); await usage(size(tombstone) + size(root) + size(child));
  const rootDelete = deleted(root);
  await push([rootDelete]); await usage(size(tombstone) + size(rootDelete));
  await push([child], "run:run"); await p.call({ op: "compact" });
  await p.evict(); await usage(size(tombstone) + size(rootDelete));
});

it("initializes existing stores once, excluding deleted registers and closed run streams", async () => {
  const p = await probe(), live = record("live"), gone = record("gone"), tombstone = deleted(gone), root = record("root"), rootDelete = deleted(root);
  // The pre-counter on-disk schema, including ciphertext not yet compacted.
  await p.sql(`CREATE TABLE latest(stream TEXT NOT NULL,register_key TEXT NOT NULL,seq INTEGER NOT NULL,envelope TEXT NOT NULL,PRIMARY KEY(stream,register_key));
    CREATE TABLE deleted(row_key TEXT PRIMARY KEY,stream TEXT NOT NULL,seq INTEGER NOT NULL,envelope TEXT NOT NULL);
    CREATE TABLE runs(run_id TEXT PRIMARY KEY,owner TEXT NOT NULL,root_key TEXT NOT NULL UNIQUE,tombstone TEXT);
    CREATE TABLE quota_chunks(key TEXT PRIMARY KEY,bytes INTEGER NOT NULL,stored INTEGER NOT NULL,expires_at INTEGER NOT NULL);
    CREATE TABLE quota_state(id INTEGER PRIMARY KEY,initialized INTEGER NOT NULL);
    INSERT INTO quota_state VALUES(1,1);
    INSERT INTO quota_chunks VALUES('stored',80,1,0),('reserved',40,0,${Date.now() + 3_600_000});`);
  for (const [i, row] of [live, gone, root].entries()) await p.sql("INSERT INTO latest VALUES('account',?,?,?)", row.header.registerKey!, i + 1, JSON.stringify(row));
  await p.sql("INSERT INTO latest VALUES('run:closed','child',1,?)", JSON.stringify(record("child")));
  await p.sql("INSERT INTO runs VALUES('closed','A','root',?)", JSON.stringify(rootDelete));
  for (const row of [tombstone, rootDelete]) await p.sql("INSERT INTO deleted VALUES(?,'account',1,?)", row.header.rowKey, JSON.stringify(row));
  const expected = size(live) + size(tombstone) + size(rootDelete);
  const migrated = await p.call<BridgeQuota>({ op: "status" });
  expect(migrated.value).toMatchObject({ recordBytes: expected, blobBytes: 80, reservedBytes: 40, usedBytes: expected + 120 });
  await p.evict();
  const restored = await p.call<BridgeQuota>({ op: "status" });
  expect(restored.value).toEqual(migrated.value);
  expect(restored.rowsWritten).toBe(0);
});

it("reclaims every charged copy of an attachment reused in independent run streams exactly once", async () => {
  const p = await probe();
  const roots = ["first", "second"].map((runId) => {
    const row = record(runId); return { ...row, header: { ...row.header, runId, owner: "A" } };
  });
  await p.call({ op: "push", records: roots });
  const copies = roots.map((root) => {
    const row = record("shared"); return { ...row, header: { ...row.header, stream: `run:${root.header.runId}` as const, runId: root.header.runId, owner: "A" } };
  });
  for (const row of copies) await p.call({ op: "push", stream: row.header.stream, records: [row] });
  expect((await p.call<BridgeQuota>({ op: "status" })).value.recordBytes).toBe([...roots, ...copies].reduce((n, row) => n + size(row), 0));
  const tombstone = deleted(copies[0]);
  await p.call({ op: "push", stream: tombstone.header.stream, records: [tombstone, copies[0]] });
  await p.call({ op: "push", stream: copies[1].header.stream, records: [copies[1]] });
  await p.call({ op: "compact" }); await p.evict();
  expect((await p.call<BridgeQuota>({ op: "status" })).value.recordBytes).toBe(size(roots[0]) + size(roots[1]) + size(tombstone));
});
