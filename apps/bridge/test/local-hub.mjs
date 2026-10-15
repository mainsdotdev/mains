import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { SignJWT } from "jose";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Starts the same Worker as wrangler dev, on an ephemeral real HTTP/WebSocket listener.
 * @param {{ auth?: boolean, storageLimitBytes?: number, writesPerMinute?: number }} [settings] */
export async function startLocalBridgeHub(settings = {}) {
  const dir = await mkdtemp(join(tmpdir(), "mains-bridge-hub-"));
  const bundle = join(dir, "hub.mjs");
  const secret = randomBytes(32).toString("hex");
  await build({ entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))], bundle: true, format: "esm", platform: "browser", target: "es2022", outfile: bundle, external: ["cloudflare:workers", "node:*"] });
  /** @type {Array<{to: string, url: string}>} */
  const mail = [];
  let loginCount = 0;
  /** @type {import('miniflare').V4MiniflareOptions} */
  const options = { name: "bridge-test", modules: true, script: await readFile(bundle, "utf8"), compatibilityDate: "2026-07-30", compatibilityFlags: ["nodejs_compat"], host: "127.0.0.1", port: 0, unsafeInspectDurableObjects: true,
    durableObjects: { ACCOUNT_HUB: { className: "AccountHub", useSQLite: true } },
    r2Buckets: { BLOBS: "bridge-test-blobs" },
    ...(settings.auth ? { d1Databases: { AUTH_DB: "bridge-auth-test" }, serviceBindings: { AUTH_MAILER: async (request) => {
      mail.push(/** @type {{to: string, url: string}} */ (await request.json())); return Response.json({ ok: true });
    } } } : {}),
    resourcePersistencePath: join(dir, "storage"), bindings: { BRIDGE_DEV_AUTH: settings.auth ? "false" : "true", BRIDGE_DEV_SECRET: secret,
      ...(settings.storageLimitBytes !== undefined ? { BRIDGE_STORAGE_LIMIT_BYTES: String(settings.storageLimitBytes) } : {}),
      ...(settings.writesPerMinute !== undefined ? { BRIDGE_WRITES_PER_MINUTE: String(settings.writesPerMinute) } : {}),
      ...(settings.auth ? { BETTER_AUTH_SECRET: randomBytes(32).toString("hex") } : {}) } };
  let mf = new Miniflare(convertV4MiniflareOptions(options));
  /** @type {URL} */
  let address;
  try { address = await mf.ready; }
  catch (error) { await mf.dispose().catch(() => {}); await rm(dir, { recursive: true, force: true }); throw error; }
  if (settings.auth) {
    const db = await mf.getD1Database("AUTH_DB");
    for (const file of ["0001_auth.sql", "0002_bridge_identity.sql", "0003_bridge_quotas.sql"]) {
      const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");
      await db.batch(sql.split(";").filter((part) => part.trim()).map((part) => db.prepare(part)));
    }
  }
  return {
    get url() { return address.toString(); },
    get wsUrl() { return new URL("/v1/log", address).toString().replace(/^http/, "ws"); },
    /** Real Better Auth magic-link flow; only mail delivery is replaced.
     * @param {string} email */
    async login(email) {
      const ip = `198.51.100.${++loginCount}`;
      const response = await fetch(new URL("/api/auth/sign-in/magic-link", address), { method: "POST", headers: { "Content-Type": "application/json", Origin: address.origin, "CF-Connecting-IP": ip }, body: JSON.stringify({ email, callbackURL: new URL("/device", address).toString() }) });
      if (!response.ok) throw new Error(`Magic-link request failed (${response.status}): ${await response.text()}`);
      const entry = mail.filter((item) => item.to === email).at(-1);
      if (!entry) throw new Error("Magic link was not delivered");
      const callback = await fetch(entry.url, { redirect: "manual", headers: { "CF-Connecting-IP": ip } });
      const cookie = callback.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
      const session = await fetch(new URL("/api/auth/get-session", address), { headers: { Cookie: cookie, "CF-Connecting-IP": ip } });
      const value = await session.json();
      if (!value?.user?.emailVerified) throw new Error(`Magic-link verification failed (${callback.status})`);
      return { cookie, user: value.user };
    },
    async database() { return mf.getD1Database("AUTH_DB"); },
    /** @param {string} accountId @param {string} backendId @param {string | number} [expiresIn] */
    async token(accountId, backendId, expiresIn = "1h") {
      return new SignJWT({ accountId }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(backendId)
        .setIssuer("mains-bridge-dev").setAudience("mains-bridge").setIssuedAt().setExpirationTime(expiresIn).sign(new TextEncoder().encode(secret));
    },
    async restart() { options.port = Number(address.port); await mf.dispose(); mf = new Miniflare(convertV4MiniflareOptions(options)); address = await mf.ready; },
    async suspend() { options.port = Number(address.port); await mf.dispose(); },
    async resume() { mf = new Miniflare(convertV4MiniflareOptions(options)); address = await mf.ready; },
    /** @param {string} accountId */
    async inspect(accountId) {
      const namespace = await mf.getDurableObjectNamespace("ACCOUNT_HUB");
      const storage = await mf.unsafeGetDurableObjectStorage("bridge-test", "AccountHub", { id: namespace.idFromName(accountId).toString() });
      return storage.exec("SELECT envelope FROM log ORDER BY stream,seq");
    },
    /** Test-only fault injection into the real Durable Object store.
     * @param {string} accountId @param {string} query */
    async quotaSql(accountId, query) {
      const namespace = await mf.getDurableObjectNamespace("ACCOUNT_HUB");
      const storage = await mf.unsafeGetDurableObjectStorage("bridge-test", "AccountHub", { id: namespace.idFromName(accountId).toString() });
      return storage.exec(query);
    },
    /** @param {string} accountId */
    async evict(accountId) {
      const namespace = await mf.getDurableObjectNamespace("ACCOUNT_HUB");
      await mf.unsafeEvictDurableObject("bridge-test", "AccountHub", { id: namespace.idFromName(accountId).toString() });
    },
    async bucket() { return mf.getR2Bucket("BLOBS"); },
    async dispose() { await mf.dispose(); await rm(dir, { recursive: true, force: true }); },
  };
}
