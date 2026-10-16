import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import type { BridgeSubscriptionStatus } from "@mains/contracts/bridge-subscription";
import { bridgeSubscriptionGrant } from "../src/subscription-admin";
import { startLocalBridgeHub } from "./local-hub.mjs";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
it("uses one indexed D1 read for concurrent checks, observes exact expiry and caches negative results", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), sourcefile: "subscription-probe.ts", contents: `
    import { createBridgeSubscriptions } from './src/subscriptions.ts';
    let reader, now = 0, queries = 0, rowsRead = 0;
    export default { async fetch(request, env) {
      const input = await request.json(); now = input.now; queries = 0; rowsRead = 0;
      reader ??= createBridgeSubscriptions({ AUTH_DB: { prepare(sql) { return { bind(...args) { return { async all() {
        queries++; const result = await env.AUTH_DB.prepare(sql).bind(...args).all(); rowsRead += result.meta.rows_read;
        return result;
      } }; } }; } } }, () => now);
      if (input.invalidate) reader.invalidate(input.account);
      const values = await Promise.all(Array.from({ length: input.count ?? 1 }, () => reader.status(input.account)));
      return Response.json({ value: values[0], queries, rowsRead });
    } };
  ` }, bundle: true, write: false, format: "esm", platform: "browser", external: ["cloudflare:workers", "node:*"] });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-07-30",
    compatibilityFlags: ["nodejs_compat"], d1Databases: { AUTH_DB: "subscription-cache" }, host: "127.0.0.1", port: 0 }));
  cleanup.push(() => mf.dispose());
  const url = await mf.ready, db = await mf.getD1Database("AUTH_DB"), start = Date.parse("2026-10-16T00:00:00Z");
  await db.prepare("CREATE TABLE user(id TEXT PRIMARY KEY)").run();
  for (const file of ["0004_account_entitlements.sql", "0005_closed_beta.sql"]) {
    const schema = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");
    await db.prepare(schema).run();
  }
  await db.prepare("WITH RECURSIVE n(x) AS(VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<2000) INSERT INTO user SELECT 'user-'||x FROM n").run();
  await db.prepare("INSERT INTO account_entitlements SELECT id,'bridge','standard','monthly','active',?,?,? FROM user").bind(start, start + 5000, start).run();
  async function status(account: string, now: number, count = 1, invalidate = false) {
    return (await (await fetch(url, { method: "POST", body: JSON.stringify({ account, now, count, invalidate }) })).json()) as { value: BridgeSubscriptionStatus; queries: number; rowsRead: number };
  }
  const first = await status("user-1", start, 1000);
  expect(first.queries).toBe(1); expect(first.rowsRead).toBeLessThanOrEqual(4); expect(first.value.subscription.canUpload).toBe(true);
  const expired = await status("user-1", start + 5000, 1000);
  expect(expired.queries).toBe(0); expect(expired.value.subscription.status).toBe("expired");
  expect((await status("missing", start + 5001, 1000)).queries).toBe(1);
  expect((await status("missing", start + 5002, 1000)).queries).toBe(0);
  await db.prepare("UPDATE account_entitlements SET expires_at=? WHERE account_id='user-1'").bind(start + 3_600_000).run();
  expect((await status("user-1", start + 60_000)).value.subscription.canUpload).toBe(true);
  await db.prepare("UPDATE account_entitlements SET status='revoked' WHERE account_id='user-1'").run();
  const revoked = await status("user-1", start + 60_001, 1, true);
  expect(revoked.queries).toBe(1); expect(revoked.value.subscription.canUpload).toBe(false);
  // Operator grants update an existing account without creating duplicates or
  // extending another period when the identical command is retried.
  const grant = bridgeSubscriptionGrant({ accountId: "user-1", interval: "yearly", startsAt: start });
  expect((await db.prepare(grant.sql).bind(...grant.params).run()).meta.changes).toBe(1);
  expect((await db.prepare(grant.sql).bind(...grant.params).run()).meta.changes).toBe(0);
  // Beta expiry and the transition to a scheduled paid grant are evaluated
  // from both cached rows, without waiting for the D1 cache TTL.
  await db.prepare("UPDATE account_entitlements SET starts_at=?,expires_at=? WHERE account_id='user-2'").bind(start + 2000, start + 3_600_000).run();
  await db.prepare("INSERT INTO bridge_beta_invites VALUES('beta@example.test','user-2','active',?,?,?,?)").bind(start, start, start + 1000, start).run();
  const beta = await status("user-2", start, 1000);
  expect(beta.queries).toBe(1); expect(beta.rowsRead).toBeLessThanOrEqual(4);
  expect(beta.value.subscription).toMatchObject({ source: "beta", status: "active", billingInterval: null });
  const betaExpired = await status("user-2", start + 1000, 1000);
  expect(betaExpired.queries).toBe(0); expect(betaExpired.value.subscription).toMatchObject({ source: "beta", status: "expired", canUpload: false });
  const paid = await status("user-2", start + 2000, 1000);
  expect(paid.queries).toBe(0); expect(paid.value.subscription.canUpload).toBe(true); expect(paid.value.subscription.source).toBeUndefined();
  console.info("Local D1 subscription metrics", { accounts: 2000, concurrentChecks: 1000, queries: first.queries, rowsRead: first.rowsRead, cachedExpiryQueries: expired.queries });
});

it.each(["staging", "production"] as const)("rejects development JWTs in %s even when the dev flag is accidentally enabled", async (environment) => {
  const hub = await startLocalBridgeHub({ environment }); cleanup.push(() => hub.dispose());
  const token = await hub.token("account", "A");
  for (const path of ["/v1/log", "/v1/quota", "/v1/subscription"]) {
    expect((await fetch(new URL(path, hub.url), { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
  }
});
