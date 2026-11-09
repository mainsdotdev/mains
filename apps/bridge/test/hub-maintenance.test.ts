import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { afterEach, expect, it } from "vitest";
import { BRIDGE_IDLE_RETENTION_MS, type BridgeEnvelope, type BridgeStream } from "@mains/contracts/bridge-protocol";
import type { HubPage, HubSnapshot } from "../src/hub-backup";
import { signFixture } from "./record-signing.mjs";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
type Pass = { hasMore: boolean; rowsRemoved: number; legacyRows: number };
const now = 2_000_000_000_000;
async function runtime() {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), sourcefile: "maintenance-probe.ts", contents: `
    import {AccountHub} from './src/index';
    export class Probe extends AccountHub {
      async invoke(input) {
        const realNow=Date.now; Date.now=()=>input.now;
        try {
          const sql=this.ctx.storage.sql;
          if(input.op==='push')return this.store.push('A',input.stream,input.records);
          if(input.op==='pull')return this.store.pull(input.stream,input.after??0,1000);
          if(input.op==='compact')return this.store.compact();
          if(input.op==='alarm'){await this.alarm();return this.ctx.storage.getAlarm();}
          if(input.op==='expiry')return this.store.nextExpiry();
          if(input.op==='sql')return sql.exec(input.query,...(input.args??[])).toArray();
          if(input.op==='begin')return this.snapshotBegin();
          if(input.op==='valid')return this.snapshotValid(input.token);
          if(input.op==='page')return this.snapshotPage(input.token,input.table,input.after??0);
          if(input.op==='usage')return this.store.recordBytes();
          throw new Error('Unknown fixture action');
        } finally {Date.now=realNow;}
      }
    }
    export default {async fetch(request,env){
      const input=await request.json();
      try{return Response.json(await env.PROBE.getByName('fixture').invoke(input));}
      catch(error){return Response.json({error:error.message},{status:400});}
    }};
  ` }, bundle: true, write: false, format: "esm", platform: "browser", external: ["cloudflare:workers", "node:*"] });
  const mf = new Miniflare(convertV4MiniflareOptions({ name: "maintenance-test", modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-07-30", compatibilityFlags: ["nodejs_compat"], host: "127.0.0.1", port: 0,
    bindings: { BRIDGE_DEV_AUTH: "true" },
    durableObjects: { PROBE: { className: "Probe", useSQLite: true } }, r2Buckets: { BLOBS: "maintenance-files" } }));
  cleanup.push(() => mf.dispose()); await mf.ready;
  const worker = await mf.getWorker();
  async function call<T>(op: string, input: object = {}, at = now): Promise<T> {
    const response = await worker.fetch("https://local.test", { method: "POST", body: JSON.stringify({ op, now: at, ...input }) });
    const value = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(value.error); return value;
  }
  return {
    call,
    push: (records: BridgeEnvelope[], at = now) => call("push", { records, stream: records[0].header.stream }, at),
    pull: (stream: BridgeStream, after = 0) => call<{ records: { seq: number; envelope: BridgeEnvelope }[]; next: number }>("pull", { stream, after }),
    sql: (query: string, args: (string | number)[] = []) => call("sql", { query, args }),
    compact: (at = now) => call<Pass>("compact", {}, at),
    begin: () => call<HubSnapshot>("begin"),
    valid: (token: string) => call<boolean>("valid", { token }),
    page: (token: string, table: string, after = 0) => call<HubPage>("page", { token, table, after }),
    async rows(table: string) {
      const snapshot = await call<HubSnapshot>("begin"), rows: HubPage["rows"] = [];
      let after = 0;
      for (;;) {
        const page = await call<HubPage>("page", { token: snapshot.token, table, after });
        expect(page.changed).toBe(false); rows.push(...page.rows);
        if (page.done) return rows;
        expect(page.next).toBeGreaterThan(after); after = page.next;
      }
    },
    async evict() {
      const ns = await mf.getDurableObjectNamespace("PROBE");
      await mf.unsafeEvictDurableObject("maintenance-test", "Probe", { id: ns.idFromName("fixture").toString() });
    },
  };
}
function record(id: string, clock: number, stream: BridgeStream = "account", retention = false): BridgeEnvelope {
  return signFixture({ header: { v: 1, stream, rowKey: id, registerKey: `${id}:row`, origin: "A", owner: "A", op: "upsert",
    hlc: { physicalMs: clock, counter: 0 }, ...(stream === "account" ? { runId: id } : { runId: stream.slice(4) }),
    ...(retention ? { retention: "30d-idle" as const } : {}) }, body: { nonce: "opaque", payload: `ciphertext-${id}-${clock}` } }, "fixture");
}
function deletion(row: BridgeEnvelope): BridgeEnvelope {
  const { registerKey: _register, retention: _retention, blobs: _blobs, ...header } = row.header; void [_register, _retention, _blobs];
  return signFixture({ header: { ...header, op: "delete", hlc: { physicalMs: 2, counter: 0 } }, body: row.body }, "fixture");
}

it("postpones durable idle cleanup after accepted run activity, including across eviction", async () => {
  const p = await runtime(), root = record("run", 1), mirror = record("mirror", 1, "run:run", true);
  await p.push([root]); await p.push([mirror]);
  expect(await p.call("expiry")).toBe(now + BRIDGE_IDLE_RETENTION_MS);
  const activity = now + BRIDGE_IDLE_RETENTION_MS - 1;
  await p.push([record("run", 2)], activity);
  await p.evict();
  await p.compact(now + BRIDGE_IDLE_RETENTION_MS);
  expect((await p.pull("run:run")).records.map((row) => row.envelope)).toEqual([mirror]);
  expect(await p.call("expiry")).toBe(activity + BRIDGE_IDLE_RETENTION_MS);
  await p.compact(activity + BRIDGE_IDLE_RETENTION_MS);
  expect((await p.pull("run:run")).records).toEqual([]);
});

it("rolls back an interrupted pass and retries its original jobs without partial compaction", async () => {
  const p = await runtime();
  await p.push([record("a", 1), record("z", 1), record("a", 2), record("z", 2)]);
  const before = await p.pull("account"), usage = await p.call("usage");
  await p.sql(`CREATE TRIGGER fail_compaction BEFORE DELETE ON log WHEN OLD.register_key='z:row'
    BEGIN SELECT RAISE(ABORT,'fixture compaction failure'); END`);
  await expect(p.compact()).rejects.toThrow("fixture compaction failure");
  expect(await p.pull("account")).toEqual(before);
  expect(await p.call("usage")).toBe(usage);
  await p.sql("DROP TRIGGER fail_compaction");
  expect(await p.compact()).toEqual({ hasMore: false, rowsRemoved: 2, legacyRows: 0 });
  expect((await p.pull("account")).records.map((row) => row.seq)).toEqual([3, 4]);
  expect(await p.call("expiry")).toBe(null);
});

it("limits a maintenance alarm to sixteen jobs and schedules remaining work one second later", async () => {
  const p = await runtime();
  const ids = Array.from({ length: 17 }, (_, i) => `root-${i}`);
  await p.push(ids.map((id) => record(id, 1)));
  await p.push(ids.map((id) => record(id, 2)));
  expect(await p.call("alarm")).toBe(now + 1000);
  expect((await p.pull("account")).records).toHaveLength(18);
  await p.evict();
  expect(await p.compact()).toEqual({ hasMore: false, rowsRemoved: 1, legacyRows: 0 });
  expect((await p.pull("account")).records).toHaveLength(17);
});

it("bounds idle expiration to 128 rows and rechecks activity before continuing after eviction", async () => {
  const p = await runtime(), stream = "run:run" as const, history = record("history", 1, stream);
  await p.push([record("run", 1)]);
  for (let start = 0; start < 300; start += 100)
    await p.push(Array.from({ length: 100 }, (_, i) => record(`mirror-${start + i}`, 1, stream, true)));
  await p.push([history]);
  expect(await p.compact(now + BRIDGE_IDLE_RETENTION_MS - 1)).toEqual({ hasMore: false, rowsRemoved: 0, legacyRows: 0 });
  const snapshot = await p.begin();
  expect(await p.compact(now + BRIDGE_IDLE_RETENTION_MS)).toEqual({ hasMore: true, rowsRemoved: 128, legacyRows: 0 });
  expect(await p.valid(snapshot.token)).toBe(false);
  expect(await p.page(snapshot.token, "log")).toMatchObject({ changed: true, rows: [] });
  const remaining = (await p.rows("latest")).filter((row) => row.values[0] === stream);
  expect(remaining).toHaveLength(173);
  const activity = now + BRIDGE_IDLE_RETENTION_MS + 1;
  await p.push([record("run", 2)], activity);
  await p.evict();
  for (let n = 0; (await p.compact(activity)).hasMore; n++) expect(n).toBeLessThan(20);
  expect((await p.rows("latest")).filter((row) => row.values[0] === stream)).toEqual(remaining);
  expect((await p.pull(stream)).records).toHaveLength(173);
  const expired = activity + BRIDGE_IDLE_RETENTION_MS;
  for (let n = 0; (await p.compact(expired)).hasMore; n++) expect(n).toBeLessThan(50);
  expect((await p.pull(stream)).records.map((row) => row.envelope)).toEqual([history]);
  expect((await p.pull(stream, 301)).next).toBe(301);
});

it("retains whole tombstones, writer bindings and stream positions through a bounded closed-run cleanup", async () => {
  const p = await runtime(), root = record("run", 1), stream = "run:run" as const;
  const children = Array.from({ length: 200 }, (_, i) => record(`child-${i}`, 1, stream));
  await p.push([root]);
  for (let start = 0; start < children.length; start += 100) await p.push(children.slice(start, start + 100));
  const childDelete = deletion(children[0]), rootDelete = deletion(root);
  await p.push([childDelete]); await p.push([rootDelete]);
  const positions = await p.rows("streams"), owners = await p.rows("row_owners"), usage = await p.call("usage");
  expect(await p.compact()).toEqual({ hasMore: true, rowsRemoved: 128, legacyRows: 0 });
  await p.evict();
  for (let n = 0; (await p.compact()).hasMore; n++) expect(n).toBeLessThan(10);
  expect(await p.rows("streams")).toEqual(positions);
  expect(await p.rows("row_owners")).toEqual(owners);
  expect(await p.call("usage")).toBe(usage);
  expect((await p.rows("deleted")).map((row) => JSON.parse(String(row.values[3]))))
    .toEqual(expect.arrayContaining([childDelete, rootDelete]));
  expect((await p.pull("account")).records.map((row) => row.envelope)).toEqual([rootDelete]);
  expect(await p.pull(stream)).toMatchObject({ records: [], next: 201 });
  expect(await p.push([children[0]])).toMatchObject({ results: [{ deleted: rootDelete }] });
});

it("keeps idle reads and empty passes within one capture but retires its token after real object eviction", async () => {
  const p = await runtime(); await p.push([record("root", 1)]);
  const snapshot = await p.begin();
  await p.pull("account"); await p.page(snapshot.token, "log");
  expect(await p.compact()).toEqual({ hasMore: false, rowsRemoved: 0, legacyRows: 0 });
  expect(await p.valid(snapshot.token)).toBe(true);
  await p.evict();
  expect(await p.valid(snapshot.token)).toBe(false);
  expect(await p.page(snapshot.token, "log")).toMatchObject({ changed: true, rows: [] });
  const fresh = await p.begin(); expect(fresh.token).not.toBe(snapshot.token);
  expect(await p.compact()).toEqual({ hasMore: false, rowsRemoved: 0, legacyRows: 0 });
  expect(await p.valid(fresh.token)).toBe(true);
});
