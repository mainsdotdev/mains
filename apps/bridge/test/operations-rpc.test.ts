import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { expect, it } from "vitest";

it("keeps checkpoints off public HTTP and exposes only indexed account pagination through a private service binding", async () => {
  const bundle = await build({ entryPoints: ["src/index.ts"], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", external: ["cloudflare:workers", "node:*"] });
  const mf = new Miniflare(convertV4MiniflareOptions({ host: "127.0.0.1", port: 0, workers: [
    { name: "hub", modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-07-30", compatibilityFlags: ["nodejs_compat"],
      d1Databases: { AUTH_DB: "checkpoint-auth" }, r2Buckets: { BLOBS: "checkpoint-blobs" }, durableObjects: { ACCOUNT_HUB: { className: "AccountHub", useSQLite: true } } },
    { name: "operator", modules: true, compatibilityDate: "2026-07-30", serviceBindings: { OPS: { name: "hub", entrypoint: "BridgeOperations" } },
      script: `export default {async fetch(request,env){
        const value=await request.json();
        try {return Response.json(value.method==='checkpoint'?await env.OPS.checkpoint(value.account):await env.OPS.accounts(value.after));}
        catch {return new Response('Rejected',{status:400});}
      }}` },
  ] }));
  try {
    await mf.ready;
    const db = await mf.getD1Database("AUTH_DB", "hub");
    await db.prepare("CREATE TABLE bridge_accounts(account_id TEXT PRIMARY KEY)").run();
    await db.batch(Array.from({ length: 103 }, (_, i) => db.prepare("INSERT INTO bridge_accounts VALUES(?)").bind(`account-${String(i).padStart(3, "0")}`)));
    const hub = await mf.getWorker("hub"), operator = await mf.getWorker("operator");
    for (const path of ["/__operations/checkpoint", "/__maintenance/checkpoint", "/checkpoint", "/accounts"]) expect((await hub.fetch(`https://local.test${path}`)).status).toBe(404);
    const call = (value: object) => operator.fetch("https://local.test", { method: "POST", body: JSON.stringify(value) });
    const first = await (await call({ after: "" })).json() as string[];
    expect(first).toHaveLength(100); expect(first[0]).toBe("account-000");
    expect(await (await call({ after: first.at(-1) })).json()).toEqual(["account-100", "account-101", "account-102"]);
    expect((await call({ after: "x".repeat(129) })).status).toBe(400);
    expect((await call({ method: "checkpoint", account: "missing" })).status).toBe(400);
    expect((await call({ method: "checkpoint", account: null })).status).toBe(400);
    // Cloudflare does not implement DO PITR in local workerd. A real bookmark
    // is verified only read-only after deployment; no live restore is tested.
  } finally { await mf.dispose(); }
});
