import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { expect, it } from "vitest";
import type { AdminQuotaPage } from "../src/admin-quota";

it("lists account quotas through the dedicated binding and keeps them off public HTTP", async () => {
  const bundle = await build({ entryPoints: ["src/index.ts"], bundle: true, write: false, format: "esm", platform: "browser",
    target: "es2022", external: ["cloudflare:workers", "node:*"] });
  const mf = new Miniflare(convertV4MiniflareOptions({ host: "127.0.0.1", port: 0, workers: [
    { name: "hub", modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-07-30", compatibilityFlags: ["nodejs_compat"],
      d1Databases: { AUTH_DB: "admin-auth" }, r2Buckets: { BLOBS: "admin-blobs" },
      durableObjects: { ACCOUNT_HUB: { className: "AccountHub", useSQLite: true } } },
    { name: "admin", modules: true, compatibilityDate: "2026-07-30",
      serviceBindings: { QUOTAS: { name: "hub", entrypoint: "BridgeQuotaAdmin" } },
      script: `export default {async fetch(request,env){
        try { return Response.json(await env.QUOTAS.list(await request.json())); }
        catch { return new Response('Invalid quota query',{status:400}); }
      }}` },
  ] }));
  try {
    await mf.ready;
    const db = await mf.getD1Database("AUTH_DB", "hub");
    await db.batch([
      db.prepare("CREATE TABLE user(id TEXT PRIMARY KEY,email TEXT NOT NULL)"),
      db.prepare("CREATE TABLE bridge_accounts(account_id TEXT PRIMARY KEY)"),
      db.prepare("CREATE TABLE bridge_account_quotas(account_id TEXT PRIMARY KEY,plan TEXT,storage_limit_bytes INTEGER,writes_per_minute INTEGER)"),
      db.prepare("CREATE TABLE account_entitlements(account_id TEXT,feature TEXT,plan_id TEXT,billing_interval TEXT,status TEXT,starts_at INTEGER,expires_at INTEGER)"),
      db.prepare("CREATE TABLE bridge_beta_invites(account_id TEXT,status TEXT,activated_at INTEGER,expires_at INTEGER)"),
      db.prepare("INSERT INTO bridge_account_quotas VALUES('account-00','custom',2048,60)"),
    ]);
    const accounts = Array.from({ length: 11 }, (_, id) => `account-${String(id).padStart(2, "0")}`);
    await db.batch(accounts.flatMap(id => [
      db.prepare("INSERT INTO user VALUES(?,?)").bind(id, `${id}@example.test`),
      db.prepare("INSERT INTO bridge_accounts VALUES(?)").bind(id),
    ]));
    const hub = await mf.getWorker("hub"), admin = await mf.getWorker("admin");
    for (const route of ["/api/accounts", "/admin/quotas", "/BridgeQuotaAdmin"]) {
      expect((await hub.fetch(`https://local.test${route}`)).status).toBe(404);
    }
    const call = (search: string, after = "") => admin.fetch("https://local.test", { method: "POST", body: JSON.stringify({ search, after }) });
    const page = await (await call("")).json() as AdminQuotaPage;
    expect(page.rows).toHaveLength(10);
    expect(page.next).toBe("account-09");
    expect(page.rows[0]).toMatchObject({ email: "account-00@example.test", quota: {
      plan: "custom", usedBytes: 0, limitBytes: 2048, reservedBytes: 0, blobBytes: 0, recordBytes: 0, writesPerMinute: 60,
    } });
    expect(page.rows[0].quota).not.toHaveProperty("plans");
    expect((await (await call("", page.next!)).json() as AdminQuotaPage).rows.map(row => row.email)).toEqual(["account-10@example.test"]);
    expect((await (await call("ACCOUNT-00")).json() as AdminQuotaPage).rows).toHaveLength(1);
    expect((await call("", "../")).status).toBe(400);
  } finally { await mf.dispose(); }
});
