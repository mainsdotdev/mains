import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { bridgeBetaColumns, bridgeBetaEmail, bridgeBetaExtend, bridgeBetaInvite, bridgeBetaRevoke, bridgeBetaSelect } from "../src/beta-admin";
import { withRemoteBindings } from "./operations";
import { loadOperationsTarget } from "./operations-lib";
import { parseBridgeConfig } from "./production-config";

const usage = "Usage: npm run beta -- invite|show|revoke --email EMAIL, extend --email EMAIL --expires-at ISO_DATE, or list [--after EMAIL]. Defaults to local D1. Remote commands require --environment staging|production --remote; local tests may use --config CONFIG --persist-to DIRECTORY. A remote invite emails the invitation once; add --resend to send it again or --no-mail to skip it.";
const args = process.argv.slice(2), command = args.shift(), values = new Map<string, string>(), flags = new Set<string>();
let remote = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--remote" && !remote) { remote = true; continue; }
  if (["--resend", "--no-mail"].includes(args[i]) && !flags.has(args[i])) { flags.add(args[i]); continue; }
  if (!["--email", "--expires-at", "--environment", "--config", "--persist-to", "--after"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--") || values.has(args[i])) throw new Error(usage);
  values.set(args[i], args[++i]);
}
if (!["invite", "show", "extend", "revoke", "list"].includes(command ?? "") || (command !== "list" && !values.has("--email")) ||
  (command === "list" && values.has("--email")) || (command !== "list" && values.has("--after")) ||
  (command === "extend" ? !values.has("--expires-at") : values.has("--expires-at"))) throw new Error(usage);
if (flags.size && (command !== "invite" || !remote || flags.size > 1)) throw new Error("Use --resend or --no-mail, not both, and only with a remote invite");
const environment = values.get("--environment") ?? "local";
if (remote ? !["staging", "production"].includes(environment) : environment !== "local") throw new Error("Remote commands require both --environment staging|production and --remote");
if (remote && (values.has("--config") || values.has("--persist-to"))) throw new Error("Remote commands use only the pinned environment config/profile");
const target = remote ? await loadOperationsTarget(environment) : null;
const config = target?.configPath ?? resolve(values.get("--config") ?? "wrangler.jsonc");
if (!remote) {
  const local = parseBridgeConfig(await readFile(config, "utf8"));
  if (local.account_id || local.vars?.BRIDGE_ENV && local.vars.BRIDGE_ENV !== "local" || local.d1_databases?.some((db: any) => db.remote)) throw new Error("Local commands require a local config without a Cloudflare account or remote bindings");
}
const literal = (value: string | number) => typeof value === "number" ? String(value) : `'${value.replaceAll("'", "''")}'`;
const bind = (sql: string, params: (string | number)[]) => { let i = 0; return sql.replaceAll("?", () => literal(params[i++])); };
const email = values.has("--email") ? bridgeBetaEmail(values.get("--email")!) : "";
let mutation: { sql: string; params: (string | number)[] } | undefined;
if (command === "invite") mutation = bridgeBetaInvite(email);
if (command === "revoke") mutation = bridgeBetaRevoke(email);
if (command === "extend") {
  const expiry = values.get("--expires-at")!;
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(expiry)) throw new Error("Use an ISO expiry timestamp with an explicit timezone");
  mutation = bridgeBetaExtend(email, Date.parse(expiry));
}
const sql = (mutation ? bind(mutation.sql, mutation.params) + ";\n" : "") + (command === "list"
  ? bind(`SELECT ${bridgeBetaColumns} FROM bridge_beta_invites WHERE email>? ORDER BY email LIMIT 100`, [values.get("--after") ? bridgeBetaEmail(values.get("--after")!) : ""])
  : bind(bridgeBetaSelect, [email])) + ";\n";
// These small, escaped operator queries contain only invitation metadata.
// --file uses D1's bulk-import API remotely: it takes the database offline and
// discards SELECT results. Use the query API so show/list work and invitations
// do not require an import maintenance window. spawn passes SQL without a shell.
const child = spawn(process.execPath, [resolve("node_modules/wrangler/bin/wrangler.js"), "d1", "execute", "AUTH_DB", "--config", config,
  remote ? "--remote" : "--local", ...(target && !process.env.CLOUDFLARE_API_TOKEN ? ["--profile", target.profile] : []),
  ...(values.has("--persist-to") ? ["--persist-to", resolve(values.get("--persist-to")!)] : []), "--command", sql],
{ stdio: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false", ...(target ? { CLOUDFLARE_ACCOUNT_ID: target.accountId } : {}) } });
await new Promise<void>((done, reject) => { child.once("error", reject); child.once("exit", (code) => code ? reject(new Error("Beta command failed")) : done()); });
if (mutation) console.log("Changes reach connected devices within 60 seconds; existing subscriptions and stored data are unchanged.");
if (command === "invite" && !remote) console.log("Local invitations are not emailed.");
if (command === "invite" && target && !flags.has("--no-mail")) {
  // The Worker sends it, so the mail provider's key stays there; the call needs this profile's Cloudflare login.
  const result: { sent: boolean; reason?: string } = await withRemoteBindings(target, false, (env) => env.OPS.sendBetaInvite(email, flags.has("--resend")));
  console.log(result.sent ? `Invitation emailed to ${email}.` : {
    "already-sent": "The invitation email was sent before; add --resend to send it again.",
    "not-invited": "No email: this invitation is already active or revoked.",
    skipped: "No email: this address reached its hourly email limit; run the same command later.",
    "daily-limit": "No email: today's email limit is reached; run the same command tomorrow.",
  }[result.reason ?? ""] ?? "The invitation email was not sent.");
}
if (command === "list") console.log("Up to 100 invitations shown; use --after LAST_EMAIL for the next page. Dates are Unix milliseconds.");
