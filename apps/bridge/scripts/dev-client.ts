import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import path from "node:path";
import { SignJWT } from "jose";

// Development tool only: the deployed hub continues to import contracts alone.
const args = process.argv.slice(2);
const arg = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const database = arg("--database"), output = arg("--output"), keyFile = arg("--key-file"), accountId = arg("--account");
if (!database || !output || !keyFile || !accountId || !/^[A-Za-z0-9_-]{1,128}$/.test(accountId))
  throw new Error("Use --database <mains.db> --output <dev.json> --key-file <shared-demo.key> --account <id> [--label <name>] [--hub <wss URL>]");
const vars = await readFile(new URL("../.dev.vars", import.meta.url), "utf8");
const secret = /^BRIDGE_DEV_SECRET=(.+)$/m.exec(vars)?.[1];
if (!secret || secret.length < 32) throw new Error("Run npm run dev:setup first");
const requireBackend = createRequire(new URL("../../../packages/backend/package.json", import.meta.url));
const Database = requireBackend("better-sqlite3");
const db = new Database(path.resolve(database), { readonly: true, fileMustExist: true });
let backendId: unknown;
try { backendId = db.prepare("SELECT backend_id FROM app_settings WHERE id='default'").get()?.backend_id; }
finally { db.close(); }
if (typeof backendId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(backendId)) throw new Error("Start this backend once to create its database identity");
const absoluteKey = path.resolve(keyFile);
await mkdir(path.dirname(absoluteKey), { recursive: true, mode: 0o700 });
try { await writeFile(absoluteKey, randomBytes(32).toString("base64url"), { flag: "wx", mode: 0o600 }); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
const accountKey = (await readFile(absoluteKey, "utf8")).trim();
if (!/^[A-Za-z0-9_-]{43}$/.test(accountKey) || Buffer.from(accountKey, "base64url").length !== 32 || Buffer.from(accountKey, "base64url").toString("base64url") !== accountKey) throw new Error("Invalid demo account-key file");
const token = await new SignJWT({ accountId }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(backendId)
  .setIssuer("mains-bridge-dev").setAudience("mains-bridge").setIssuedAt().setExpirationTime("24h").sign(new TextEncoder().encode(secret));
const file = path.resolve(output);
await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
// Exclusive creation prevents silently switching an existing database to a different account.
await writeFile(file, JSON.stringify({ version: 1, backendId, label: arg("--label") ?? hostname(), url: arg("--hub") ?? "ws://127.0.0.1:8790/v1/log", token, accountKey }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(`Bridge development config created for ${backendId}. Start this backend with MAINS_BRIDGE_CONFIG=${file}`);
