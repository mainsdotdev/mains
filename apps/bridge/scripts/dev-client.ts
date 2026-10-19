import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createPrivateKey, createPublicKey, randomBytes, generateKeyPairSync, hkdfSync } from "node:crypto";
import { hostname } from "node:os";
import path from "node:path";
import { SignJWT } from "jose";
import { bridgeBase64 } from "@mains/contracts/bridge-auth";
import { verifyBridgeMembershipLog, type BridgeMember } from "@mains/contracts/bridge-membership";
import { bridgeAccountKeyCommitment } from "../../../packages/backend/src/modules/bridge/bridge.keys";
import { deviceSigner, fetchBridgeMembership, signBridgeMembershipEntry, verifyBridgeSignature } from "../../../packages/backend/src/modules/bridge/bridge.membership";

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
const signing = generateKeyPairSync("ed25519");
const signingPrivateKey = signing.privateKey.export({ type: "pkcs8", format: "der" }).subarray(-32).toString("base64url");
const signingPublicKey = signing.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64url");
const token = await new SignJWT({ accountId, signingPublicKey }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(backendId)
  .setIssuer("mains-bridge-dev").setAudience("mains-bridge").setIssuedAt().setExpirationTime("24h").sign(new TextEncoder().encode(secret));
// Development accounts have no enrollment. Their membership log is administered by an authority derived
// from the shared account-key file, so every dev:client run with that file can admit its backend.
const hub = new URL(arg("--hub") ?? "ws://127.0.0.1:8790/v1/log"), http = new URL("/", hub.toString().replace(/^ws/, "http")).toString();
const keyBytes = Buffer.from(accountKey, "base64url"), derive = (label: string) => new Uint8Array(hkdfSync("sha256", keyBytes, "mains.bridge.dev", label, 32));
const publicKey = (seed: Uint8Array) => createPublicKey(createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), type: "pkcs8", format: "der" }))
  .export({ format: "der", type: "spki" }).subarray(-32).toString("base64url");
const authoritySecret = derive("membership-authority"), authority: BridgeMember = { backendId: "dev-authority",
  publicKey: bridgeBase64(derive("membership-authority-box")), signingPublicKey: publicKey(authoritySecret) };
const append = async (entry: unknown) => {
  const response = await fetch(new URL("/v1/membership", http), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ entry }) });
  if (!response.ok) throw new Error(`Bridge development membership refused this backend (${response.status}); is npm run dev running?`);
};
let { entries } = await fetchBridgeMembership(http, token, -1);
if (!entries.length) {
  const genesis = signBridgeMembershipEntry({ accountId, seq: -1, head: null }, { kind: "genesis", body: { member: authority,
    recoverySigningPublicKey: publicKey(derive("membership-recovery")), accountKeyCommitment: bridgeAccountKeyCommitment(keyBytes) } },
  deviceSigner(authority), authoritySecret);
  await append(genesis); entries = [genesis];
}
const state = await verifyBridgeMembershipLog(entries, verifyBridgeSignature);
if (state.accountKeyCommitment !== bridgeAccountKeyCommitment(keyBytes) || !state.keys.some((key) => key.backendId === authority.backendId && key.until === null))
  throw new Error("This development account's membership was created with another account-key file");
await append(signBridgeMembershipEntry(state, { kind: "add", body: { member: { backendId, publicKey: bridgeBase64(randomBytes(32)), signingPublicKey }, via: "approval" } },
  deviceSigner(authority), authoritySecret));
authoritySecret.fill(0);
const file = path.resolve(output);
await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
// Exclusive creation prevents silently switching an existing database to a different account.
await writeFile(file, JSON.stringify({ version: 1, backendId, accountId, signingPrivateKey, label: arg("--label") ?? hostname(), url: hub.toString(), token, accountKey }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(`Bridge development config created for ${backendId}. Start this backend with MAINS_BRIDGE_CONFIG=${file}`);
