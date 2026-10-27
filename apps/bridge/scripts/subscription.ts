import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { BridgeBillingInterval } from "@mains/contracts/bridge-subscription";
import { bridgeAccountId, bridgeEntitlementSelect, bridgeSubscriptionGrant } from "../src/subscription-admin";

const args = process.argv.slice(2), command = args.shift();
const values = new Map<string, string>();
let remote = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--remote") { remote = true; continue; }
  if (!["--account", "--interval", "--starts-at", "--plan", "--config"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--") || values.has(args[i])) throw new Error("Invalid subscription arguments");
  values.set(args[i], args[++i]);
}
if (!["grant", "revoke", "show"].includes(command ?? "") || !values.has("--account") || command === "grant" && !values.has("--starts-at")) {
  throw new Error("Usage: npm run subscription -- grant|revoke|show --account USER_ID [--interval monthly|yearly --starts-at ISO_DATE --plan standard] [--config CONFIG] [--remote]. Defaults to local D1. Grants require an explicit start for safe retries.");
}
const account = bridgeAccountId(values.get("--account")!);
if (remote && !values.has("--config")) throw new Error("Remote changes require an explicit --config");
const literal = (value: string | number) => typeof value === "number" ? String(value) : `'${value.replaceAll("'", "''")}'`;
const bind = (sql: string, params: (string | number)[]) => { let i = 0; return sql.replaceAll("?", () => literal(params[i++])); };
let sql = "";
if (command === "grant") {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(values.get("--starts-at")!)) throw new Error("Use an ISO start timestamp with an explicit timezone");
  const grant = bridgeSubscriptionGrant({ accountId: account, planId: values.get("--plan"), interval: values.get("--interval") as BridgeBillingInterval,
    startsAt: Date.parse(values.get("--starts-at")!) });
  sql = bind(grant.sql, grant.params) + ";\n";
} else if (command === "revoke") sql = bind("UPDATE account_entitlements SET status='revoked',updated_at=? WHERE account_id=? AND feature='bridge' AND status<>'revoked'", [Date.now(), account]) + ";\n";
sql += bind(bridgeEntitlementSelect, [account]) + ";\n";
const dir = await mkdtemp(join(tmpdir(), "mains-bridge-subscription-"));
try {
  const file = join(dir, "subscription.sql"); await writeFile(file, sql, { mode: 0o600 });
  const child = spawn(process.execPath, [resolve("node_modules/wrangler/bin/wrangler.js"), "d1", "execute", "AUTH_DB", "--config", values.get("--config") ?? "wrangler.jsonc", remote ? "--remote" : "--local", "--file", file], {
    stdio: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  await new Promise<void>((done, reject) => { child.once("error", reject); child.once("exit", (code) => { if (code) reject(new Error("D1 subscription command failed")); else done(); }); });
} finally { await rm(dir, { recursive: true, force: true }); }
