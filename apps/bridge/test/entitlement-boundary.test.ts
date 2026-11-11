import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { afterEach, expect, it } from "vitest";
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

it.each(["expiry", "revocation"])("does not carry an earlier grant across a quota lookup: %s", async (mode) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), sourcefile: "entitlement-boundary.ts", contents: `
    import {DurableObject} from 'cloudflare:workers';
    import {createBridgeSubscriptions} from './src/subscriptions';
    import {createBlobQuota} from './src/quota';
    import {createHubStore} from './src/store';
    export class Probe extends DurableObject {
      constructor(ctx,env){
        super(ctx,env); let now=1000, reader;
        const row={source:'subscription',plan_id:'standard',billing_interval:'monthly',status:'active',starts_at:0,expires_at:2000};
        const AUTH_DB={prepare(sql){return {bind(){return {
          async all(){return {results:[{...row}]}},
          async first(){
            if(sql.includes('bridge_account_quotas')){
              if(${JSON.stringify(mode)}==='expiry')now=2000;
              else{row.status='revoked';reader.invalidate('account')}
            }
            return null;
          }
        }}}}};
        reader=createBridgeSubscriptions({AUTH_DB},()=>now);
        const store=createHubStore(ctx.storage);
        this.quota=createBlobQuota(ctx.storage,{...env,AUTH_DB},()=>store.recordBytes(),reader);
      }
      async status(){return this.quota.status('account')}
    }
    export default{async fetch(request,env){return Response.json(await env.PROBE.getByName('account').status())}};
  ` }, bundle: true, write: false, format: "esm", platform: "browser", conditions: ["workerd"], external: ["cloudflare:workers", "node:*"] });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-07-30", compatibilityFlags: ["nodejs_compat"], host: "127.0.0.1", port: 0,
    durableObjects: { PROBE: { className: "Probe", useSQLite: true } }, r2Buckets: { BLOBS: "entitlement-boundary" } }));
  cleanup.push(() => mf.dispose());
  const response = await fetch(await mf.ready);
  if (!response.ok) throw new Error((await response.text()).slice(0, 1800));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ subscription: { status: mode === "expiry" ? "expired" : "revoked", canUpload: false } });
});
