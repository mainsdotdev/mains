import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { expect, it } from "vitest";

type UsageEvent = { operation: string; hubId: string; rowsRead: number; rowsWritten: number; failed: boolean };

it("attributes native lazy-cursor work across concurrent operations without persisting metrics or exposing data", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), sourcefile: "sql-usage-probe.ts", contents: `
    import {DurableObject} from 'cloudflare:workers';
    import {createSqlUsage} from './src/sql-usage';
    export class Probe extends DurableObject {
      async run() {
        const raw=this.ctx.storage,events=[];
        raw.sql.exec('CREATE TABLE fixture(id INTEGER PRIMARY KEY,value TEXT); CREATE INDEX fixture_value ON fixture(value)');
        const usage=createSqlUsage(raw,{BRIDGE_SQL_USAGE_SAMPLE_RATE:'1'},this.ctx.id.toString(),event=>events.push(event));
        const sql=usage.storage.sql;
        usage.run('push',()=>usage.storage.transactionSync(()=>{for(let i=0;i<10;i++)sql.exec('INSERT INTO fixture VALUES(?,?)',i,'sensitive-value-'+i)}));
        const before=Number(raw.sql.exec('SELECT total_changes() n').one().n);
        const expected=[];
        await Promise.all([
          usage.run('pull',async()=>{
            const cursor=sql.exec('SELECT * FROM fixture ORDER BY id');
            for(const row of cursor)if(row.id===1)break;
            await new Promise(resolve=>setTimeout(resolve,5));
            usage.limitsCache(true); expected.push({operation:'pull',rowsRead:cursor.rowsRead});
          }),
          usage.run('quota',async()=>{
            const cursor=sql.exec('SELECT * FROM fixture WHERE id=9');cursor.one();
            await Promise.resolve();usage.limitsCache(false);expected.push({operation:'quota',rowsRead:cursor.rowsRead});
          })
        ]);
        usage.run('snapshot',()=>{const cursor=sql.exec('SELECT id FROM fixture');[...cursor.raw()];});
        try{usage.run('put',()=>{sql.exec('INSERT INTO fixture VALUES(99,?)','private');throw new Error('private error');});}catch{}
        const after=Number(raw.sql.exec('SELECT total_changes() n').one().n);
        const disabled=createSqlUsage(raw,{BRIDGE_SQL_USAGE_SAMPLE_RATE:'0'},this.ctx.id.toString(),()=>{throw new Error('should not log')});
        disabled.run('pull',()=>disabled.storage.sql.exec('SELECT 1').one());
        const failing=createSqlUsage(raw,{BRIDGE_SQL_USAGE_SAMPLE_RATE:'1'},this.ctx.id.toString(),()=>{throw new Error('log unavailable')});
        const harmless=failing.run('quota',()=>failing.storage.sql.exec('SELECT 1 n').one().n);
        return {events,expected,metricWrites:after-before-1,harmless,tables:raw.sql.exec("SELECT name FROM sqlite_master WHERE type='table'").toArray()};
      }
    }
    export default {async fetch(request,env){return Response.json(await env.PROBE.getByName('fixture').run())}};
  ` }, bundle: true, write: false, format: "esm", platform: "browser", external: ["cloudflare:workers", "node:*"] });
  const mf = new Miniflare(convertV4MiniflareOptions({ name: "sql-usage-probe", modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-07-30", compatibilityFlags: ["nodejs_compat"], host: "127.0.0.1", port: 0,
    durableObjects: { PROBE: { className: "Probe", useSQLite: true } } }));
  try {
    const value = await (await (await mf.getWorker()).fetch("https://local.test")).json() as {
      events: UsageEvent[]; expected: { operation: string; rowsRead: number }[]; metricWrites: number; harmless: number; tables: { name: string }[];
    };
    expect(value.metricWrites).toBe(0); expect(value.harmless).toBe(1); expect(value.tables).toEqual([{ name: "fixture" }]);
    const event = (operation: string) => value.events.find((entry) => entry.operation === operation)!;
    expect(event("push").rowsWritten).toBeGreaterThanOrEqual(10);
    for (const row of value.expected) expect(event(row.operation).rowsRead).toBe(row.rowsRead);
    expect(event("pull")).toMatchObject({ queries: 1, limitsCacheHits: 1, limitsCacheMisses: 0, rowsWritten: 0 });
    expect(event("quota")).toMatchObject({ queries: 1, limitsCacheHits: 0, limitsCacheMisses: 1, rowsWritten: 0 });
    expect(event("snapshot").rowsRead).toBe(10); expect(event("put").failed).toBe(true);
    expect(value.events.every((row) => /^[a-f0-9]{64}$/.test(row.hubId))).toBe(true);
    expect(JSON.stringify(value.events)).not.toMatch(/sensitive-value|private|SELECT|INSERT|fixture/);
  } finally { await mf.dispose(); }
});

it("measures the real account handlers without changing an idle backup token or writing counters", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), sourcefile: "account-usage-probe.ts", contents: `
    import {AccountHub} from './src/index';
    const events=[];console.info=value=>events.push(JSON.parse(value));
    export class Probe extends AccountHub {
      async run(){
        const identity={accountId:'fixture',backendId:'A'};
        await this.getQuota(identity);
        const snapshot=this.snapshotBegin();events.length=0;
        await Promise.all(Array.from({length:20},()=>this.getQuota(identity)));
        await this.alarm();
        const valid=this.snapshotValid(snapshot.token);
        return {events,valid};
      }
    }
    export default {async fetch(request,env){return Response.json(await env.PROBE.getByName('fixture').run())}};
  ` }, bundle: true, write: false, format: "esm", platform: "browser", external: ["cloudflare:workers", "node:*"] });
  const mf = new Miniflare(convertV4MiniflareOptions({ name: "account-usage-probe", modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-07-30", compatibilityFlags: ["nodejs_compat"], host: "127.0.0.1", port: 0,
    bindings: { BRIDGE_SQL_USAGE_SAMPLE_RATE: "1", BRIDGE_DEV_AUTH: "true" }, r2Buckets: { BLOBS: "account-usage" },
    durableObjects: { PROBE: { className: "Probe", useSQLite: true } } }));
  try {
    const response = await (await mf.getWorker()).fetch("https://local.test");
    expect(response.status).toBe(200);
    const value = await response.json() as { events: (UsageEvent & { limitsCacheHits: number })[]; valid: boolean };
    const quota = value.events.filter((row) => row.operation === "quota");
    expect(value.valid).toBe(true); expect(quota).toHaveLength(20);
    expect(quota.every((row) => row.rowsRead > 0 && row.rowsWritten === 0 && row.limitsCacheHits === 1)).toBe(true);
    expect(value.events.find((row) => row.operation === "compact")).toMatchObject({ rowsWritten: 0, failed: false });
  } finally { await mf.dispose(); }
});
