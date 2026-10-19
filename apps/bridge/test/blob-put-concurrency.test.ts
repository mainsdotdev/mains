import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { afterEach, expect, it } from "vitest";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
async function fixture(storageLimit = 1000) {
  let release!: () => void, entered!: () => void, failure = "", puts = 0;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const bundle = await build({ stdin: { resolveDir: process.cwd(), sourcefile: "put-probe.ts", contents: `
    import {AccountHub} from './src/index';
    import {bridgeAccountPrefix} from './src/quota';
    export class Probe extends AccountHub {
      constructor(ctx,env){
        const bucket=env.BLOBS,approval={active:true};
        const AUTH_DB={prepare(query){return {bind(){return {async first(){return query.includes('bridge_backends')&&approval.active?{approved:1}:null}}}}}};
        super(ctx,{...env,AUTH_DB,BLOBS:new Proxy(bucket,{get(target,key){
          if(key==='put')return async(...args)=>{
            const before=await env.CONTROL.fetch('https://local/before');if(!before.ok)throw new Error('R2 failed before commit');
            const result=await bucket.put(...args);
            const after=await env.CONTROL.fetch('https://local/after');if(!after.ok)throw new Error('Lost R2 receipt');
            return result;
          };
          const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
        }})});this.approval=approval;
      }
      identity(){return {accountId:'fixture',backendId:'A',credentialHash:'test-credential',expiresAt:Date.now()+3600000}}
      async key(id='a'){return await bridgeAccountPrefix('fixture')+id.repeat(43)+'/0'}
      async reserve(id='a',bytes=140){return this.reserveBlobs(this.identity(),[{key:await this.key(id),bytes}],Date.now()+600000)}
      async put(id='a',byte=7){return this.putBlob(this.identity(),await this.key(id),Date.now()+600000,new Uint8Array(140).fill(byte))}
      async status(){return this.getQuota(this.identity())}
      async expire(){this.ctx.storage.sql.exec('UPDATE quota_chunks SET expires_at=0; UPDATE blob_objects SET delete_after=0');return true}
      async collectNow(){await this.alarm();return true}
      async revoke(){this.approval.active=false;return true}
      async publish(){return this.ctx.blockConcurrencyWhile(async()=>{
        const quota=await this.quota.status('fixture');
        return this.store.push('A','account',[{header:{v:1,stream:'account',rowKey:'unrelated',registerKey:'unrelated-row',origin:'A',op:'upsert',hlc:{physicalMs:1,counter:0},blobs:[]},body:{nonce:null,payload:'opaque'},auth:{publicationId:'fixture-publication',signature:'fixture-signature',membership:{seq:0,hash:'fixture-head'}}}],{...quota,blobBytes:quota.blobBytes+quota.reservedBytes});
      })}
    }
    export default {async fetch(request,env){const {op,args=[]}=await request.json();return Response.json(await env.PROBE.getByName('fixture')[op](...args))}};
  ` }, bundle: true, write: false, format: "esm", platform: "browser", conditions: ["workerd"], external: ["cloudflare:workers", "node:*"] });
  const mf = new Miniflare(convertV4MiniflareOptions({ name: "put-probe", modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-07-30", compatibilityFlags: ["nodejs_compat"], host: "127.0.0.1", port: 0, unsafeInspectDurableObjects: true,
    bindings: { BRIDGE_DEV_AUTH: "true", BRIDGE_STORAGE_LIMIT_BYTES: String(storageLimit) }, r2Buckets: { BLOBS: "put-test" },
    durableObjects: { PROBE: { className: "Probe", useSQLite: true } }, serviceBindings: { CONTROL: async (request) => {
      if (new URL(request.url).pathname === "/before") { puts++; entered(); await held; if (failure === "before") return new Response(null, { status: 503 }); }
      if (new URL(request.url).pathname === "/after" && failure === "after") return new Response(null, { status: 503 });
      return new Response(null, { status: 204 });
    } } }));
  cleanup.push(async () => { release(); await mf.dispose(); });
  const url = await mf.ready;
  async function call(op: string, ...args: unknown[]) {
    const response = await fetch(url, { method: "POST", body: JSON.stringify({ op, args }) });
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<any>;
  }
  return { call, url, started, release, fail: (value: string) => { failure = value; }, puts: () => puts,
    bucket: await mf.getR2Bucket("BLOBS"),
    async evict() { const ns = await mf.getDurableObjectNamespace("PROBE"); await mf.unsafeEvictDurableObject("put-probe", "Probe", { id: ns.idFromName("fixture").toString() }); } };
}

it("keeps quota reads and unrelated publications responsive while R2 is held outside the account gate", async () => {
  const p = await fixture(); expect(await p.call("reserve")).toMatchObject({ status: 200 });
  const upload = p.call("put"); await p.started;
  try {
    const result = await Promise.race([Promise.all([p.call("status"), p.call("publish")]), new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 1500))]);
    expect(result).not.toBe("blocked");
    if (result !== "blocked") { expect(result[0]).toMatchObject({ reservedBytes: 140, blobBytes: 0 }); expect(result[1]).toMatchObject({ results: [{ seq: 1 }] }); }
  } finally { p.release(); await upload; }
});

it("pins expired reservations against reconciliation and GC, coalesces duplicates and never double-charges", async () => {
  const p = await fixture(); await p.call("reserve");
  const first = p.call("put"); await p.started;
  const duplicate = p.call("put", "a", 99);
  try {
    await p.call("expire");
    expect(await p.call("status")).toMatchObject({ reservedBytes: 140, blobBytes: 0 });
    expect(await p.call("reserve", "b", 900)).toMatchObject({ status: 413 });
    await p.call("collectNow");
    expect(await p.call("status")).toMatchObject({ reservedBytes: 140, blobBytes: 0 });
  } finally { p.release(); await Promise.all([first, duplicate]); }
  expect(p.puts()).toBe(1); expect(await p.call("status")).toMatchObject({ reservedBytes: 0, blobBytes: 140 });
  const objects = (await p.bucket.list()).objects; expect(objects).toHaveLength(1);
  expect(new Uint8Array(await (await p.bucket.get(objects[0].key))!.arrayBuffer()).every((byte) => byte === 7)).toBe(true);
});

it.each(["before", "after"])("reconciles a failed %s R2 commit across object eviction without losing quota", async (failure) => {
  const p = await fixture(); await p.call("reserve"); p.fail(failure); p.release();
  await expect(p.call("put")).rejects.toThrow();
  await p.call("expire"); await p.evict();
  expect(await p.call("status")).toMatchObject({ reservedBytes: 0, blobBytes: failure === "after" ? 140 : 0 });
});

it("rechecks revocation after I/O while retaining the physical upload charge", async () => {
  const p = await fixture(); await p.call("reserve");
  const upload = p.call("put"); await p.started;
  await p.call("revoke"); p.release();
  expect(await upload).toMatchObject({ status: 403 });
  expect(await p.call("status")).toMatchObject({ reservedBytes: 0, blobBytes: 140 });
  expect((await p.bucket.list()).objects).toHaveLength(1);
});

it("finishes the receipt after the HTTP caller disconnects during the dispatched write", async () => {
  const p = await fixture(); await p.call("reserve");
  const controller = new AbortController();
  const upload = fetch(p.url, { method: "POST", body: JSON.stringify({ op: "put" }), signal: controller.signal });
  await p.started; controller.abort(); await expect(upload).rejects.toThrow();
  p.release();
  await expect.poll(() => p.call("status"), { timeout: 3000 }).toMatchObject({ reservedBytes: 0, blobBytes: 140 });
  expect(p.puts()).toBe(1);
});

it("bounds simultaneous distinct chunk uploads without admitting unreserved bytes", async () => {
  const p = await fixture(2000), ids = Array.from("abcdefghi");
  for (const id of ids) expect(await p.call("reserve", id)).toMatchObject({ status: 200 });
  const pending = ids.slice(0, 8).map((id) => p.call("put", id));
  try {
    await expect.poll(p.puts, { timeout: 3000 }).toBe(8);
    expect(await p.call("put", ids[8])).toMatchObject({ status: 429 });
    expect(await p.call("status")).toMatchObject({ reservedBytes: 1260, blobBytes: 0 });
  } finally { p.release(); await Promise.all(pending); }
  expect(await p.call("status")).toMatchObject({ reservedBytes: 140, blobBytes: 1120 });
});
