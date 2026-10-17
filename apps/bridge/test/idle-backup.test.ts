import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { expect, it } from "vitest";

it("reads an initialized quota after a new instance without issuing any SQL mutation", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), sourcefile: "idle-quota-probe.ts", contents: `
    import {DurableObject} from 'cloudflare:workers';
    import {createHubStore} from './src/store';
    import {createBlobQuota} from './src/quota';
    export class Probe extends DurableObject {
      async run() {
        const storage=this.ctx.storage, store=createHubStore(storage);
        const bytes=()=>store.recordBytes();
        await createBlobQuota(storage,this.env,bytes).status('fixture');
        let readOnly=false;
        const guarded={sql:{exec(query,...args){
          if(readOnly && /\\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\\b/i.test(query)) throw new Error('Quota read attempted a SQL mutation');
          return storage.sql.exec(query,...args);
        }},transactionSync:fn=>storage.transactionSync(fn)};
        // A cold quota helper must reuse its durable initialization. Reject even
        // zero-row UPDATEs: they can commit without changing total_changes().
        const quota=createBlobQuota(guarded,this.env,bytes);
        readOnly=true;
        return quota.status('fixture');
      }
    }
    export default {async fetch(request,env){return Response.json(await env.PROBE.getByName('fixture').run())}};
  ` }, bundle: true, write: false, format: "esm", platform: "browser", external: ["cloudflare:workers", "node:*"] });
  const mf = new Miniflare(convertV4MiniflareOptions({ name: "idle-quota-probe", modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-07-30", compatibilityFlags: ["nodejs_compat"], host: "127.0.0.1", port: 0,
    bindings: { BRIDGE_DEV_AUTH: "true" }, durableObjects: { PROBE: { className: "Probe", useSQLite: true } }, r2Buckets: { BLOBS: "idle-quota-blobs" } }));
  try {
    await mf.ready;
    const response = await (await mf.getWorker()).fetch("https://local.test");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ usedBytes: 0, reservedBytes: 0, blobBytes: 0 });
  } finally { await mf.dispose(); }
});
