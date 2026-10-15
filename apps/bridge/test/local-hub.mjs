import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { SignJWT } from "jose";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Starts the same Worker as wrangler dev, on an ephemeral real HTTP/WebSocket listener. */
export async function startLocalBridgeHub() {
  const dir = await mkdtemp(join(tmpdir(), "mains-bridge-hub-"));
  const bundle = join(dir, "hub.mjs");
  const secret = randomBytes(32).toString("hex");
  await build({ entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))], bundle: true, format: "esm", platform: "browser", target: "es2022", outfile: bundle, external: ["cloudflare:workers"] });
  /** @type {import('miniflare').V4MiniflareOptions} */
  const options = { name: "bridge-test", modules: true, script: await readFile(bundle, "utf8"), compatibilityDate: "2026-07-30", host: "127.0.0.1", port: 0, unsafeInspectDurableObjects: true,
    durableObjects: { ACCOUNT_HUB: { className: "AccountHub", useSQLite: true } },
    r2Buckets: { BLOBS: "bridge-test-blobs" },
    resourcePersistencePath: join(dir, "storage"), bindings: { BRIDGE_DEV_AUTH: "true", BRIDGE_DEV_SECRET: secret } };
  let mf = new Miniflare(convertV4MiniflareOptions(options));
  /** @type {URL} */
  let address;
  try { address = await mf.ready; }
  catch (error) { await mf.dispose().catch(() => {}); await rm(dir, { recursive: true, force: true }); throw error; }
  return {
    get url() { return address.toString(); },
    get wsUrl() { return new URL("/v1/log", address).toString().replace(/^http/, "ws"); },
    /** @param {string} accountId @param {string} backendId @param {string | number} [expiresIn] */
    async token(accountId, backendId, expiresIn = "1h") {
      return new SignJWT({ accountId }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(backendId)
        .setIssuer("mains-bridge-dev").setAudience("mains-bridge").setIssuedAt().setExpirationTime(expiresIn).sign(new TextEncoder().encode(secret));
    },
    async restart() { await mf.dispose(); mf = new Miniflare(convertV4MiniflareOptions(options)); address = await mf.ready; },
    /** @param {string} accountId */
    async inspect(accountId) {
      const namespace = await mf.getDurableObjectNamespace("ACCOUNT_HUB");
      const storage = await mf.unsafeGetDurableObjectStorage("bridge-test", "AccountHub", { id: namespace.idFromName(accountId).toString() });
      return storage.exec("SELECT envelope FROM log ORDER BY stream,seq");
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
