import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { afterEach, expect, it } from "vitest";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
async function fixture() {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), sourcefile: "limits-cache-probe.ts", contents: `
    import {createBridgeLimits,BRIDGE_LIMITS_CACHE_MS} from './src/limits';
    let reader,now=0,fail=false,queries=0,rowsRead=0,hits=[];
    export default {async fetch(request,env){
      const input=await request.json();now=input.now??now;fail=!!input.fail;queries=0;rowsRead=0;hits=[];
      const AUTH_DB={prepare(query){return {bind(...args){return {async first(){
          queries++;if(fail)throw new Error('D1 unavailable');
          const result=await env.AUTH_DB.prepare(query).bind(...args).all();rowsRead+=result.meta.rows_read;
          return result.results[0]??null;
        }};}};}};
      reader??=createBridgeLimits({AUTH_DB},{now:()=>now,onCache:hit=>hits.push(hit)});
      if(input.invalidate)reader.invalidate(input.account);
      const results=await Promise.allSettled(Array.from({length:input.count??1},()=>reader.get(input.account,input.plan)));
      const first=results[0];
      return Response.json({value:first.status==='fulfilled'?first.value:null,
        error:first.status==='rejected'?first.reason.message:null,queries,rowsRead,hits,
        frozen:first.status==='fulfilled'&&Object.isFrozen(first.value),ttl:BRIDGE_LIMITS_CACHE_MS});
    }};
  ` }, bundle: true, write: false, format: "esm", platform: "browser", external: ["cloudflare:workers", "node:*"] });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-07-30",
    d1Databases: { AUTH_DB: "limits-cache" }, host: "127.0.0.1", port: 0 }));
  cleanup.push(() => mf.dispose());
  const url = await mf.ready, db = await mf.getD1Database("AUTH_DB");
  await db.prepare("CREATE TABLE bridge_account_quotas(account_id TEXT PRIMARY KEY,plan TEXT,storage_limit_bytes INTEGER,writes_per_minute INTEGER)").run();
  await db.prepare("WITH RECURSIVE n(x) AS(VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<2000) INSERT INTO bridge_account_quotas SELECT 'user-'||x,'standard',1000,10 FROM n").run();
  async function read(account: string, options: { now?: number; count?: number; plan?: string; invalidate?: boolean; fail?: boolean } = {}) {
    const response = await fetch(url, { method: "POST", body: JSON.stringify({ account, ...options }) });
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<{ value: { plan: string; limitBytes: number; writesPerMinute: number } | null; error: string | null;
      queries: number; rowsRead: number; hits: boolean[]; frozen: boolean; ttl: number }>;
  }
  return { db, read };
}

it("coalesces concurrent indexed D1 limits reads and caches absent overrides by account and plan", async () => {
  const p = await fixture();
  const first = await p.read("user-1", { count: 1000 });
  expect(first.queries).toBe(1); expect(first.rowsRead).toBeLessThanOrEqual(2); expect(first.hits.filter(Boolean)).toHaveLength(999);
  expect(first.value).toEqual({ plan: "standard", limitBytes: 1000, writesPerMinute: 10 }); expect(first.frozen).toBe(true);
  expect((await p.read("user-2")).queries).toBe(1);
  expect((await p.read("user-1", { plan: "another-plan" })).queries).toBe(1);
  expect((await p.read("user-1", { now: first.ttl - 1 })).queries).toBe(0);
  expect((await p.read("user-1", { now: first.ttl })).queries).toBe(1);
  const missing = await p.read("missing", { count: 1000 });
  expect(missing.queries).toBe(1); expect(missing.value!.limitBytes).toBeGreaterThan(0);
  expect((await p.read("missing", { count: 1000 })).queries).toBe(0);
});

it("refreshes lowered limits on invalidation and fails closed after expiry without caching usage or errors", async () => {
  const p = await fixture(), first = await p.read("user-1");
  await p.db.prepare("UPDATE bridge_account_quotas SET storage_limit_bytes=100,writes_per_minute=2 WHERE account_id='user-1'").run();
  const lower = await p.read("user-1", { invalidate: true });
  expect(lower.value).toEqual({ plan: "standard", limitBytes: 100, writesPerMinute: 2 }); expect(lower.queries).toBe(1);
  expect(Object.keys(lower.value!).sort()).toEqual(["limitBytes", "plan", "writesPerMinute"]);
  const outage = await p.read("user-1", { now: first.ttl, fail: true, count: 1000 });
  expect(outage.error).toBe("D1 unavailable"); expect(outage.value).toBe(null); expect(outage.queries).toBe(1);
  expect((await p.read("user-1", { fail: true })).queries).toBe(1);
  const recovered = await p.read("user-1");
  expect(recovered.queries).toBe(1); expect(recovered.value!.limitBytes).toBe(100);
});
