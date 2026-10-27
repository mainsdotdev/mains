import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { SignJWT } from "jose";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureAccountCommitment, fixtureAccountKey, fixtureEntryHash, fixtureGenesis, fixtureMember, fixtureMembershipEntry, fixturePublicKey, rememberFixtureHead } from "./record-signing.mjs";

/** Starts the same Worker as wrangler dev, on an ephemeral real HTTP/WebSocket listener.
 * @param {{ auth?: boolean, mail?: boolean, github?: boolean, archive?: boolean, truncateRefreshOnce?: boolean, subscriptionInterval?: 'monthly' | 'yearly', environment?: 'local' | 'staging' | 'production', storageLimitBytes?: number, writesPerMinute?: number, maintenance?: { accountId: string, token: string }, purge?: { token: string }, mailGuard?: boolean, mailDailyLimit?: number }} [settings] */
export async function startLocalBridgeHub(settings = {}) {
  const dir = await mkdtemp(join(tmpdir(), "mains-bridge-hub-"));
  const bundle = join(dir, "hub.mjs");
  const secret = randomBytes(32).toString("hex");
  // Match Wrangler's runtime exports. The browser condition selects Better
  // Auth's synchronous request-state fallback, which breaks concurrent login.
  const entry = settings.truncateRefreshOnce ? { stdin: { resolveDir: fileURLToPath(new URL("../", import.meta.url)), sourcefile: "refresh-fault-probe.ts", contents: `
    import worker from './src/index.ts'; export {AccountHub, BridgeOperations} from './src/index.ts';
    let truncated = false;
    export default { async fetch(request, env) {
      const response = await worker.fetch(request, env);
      if (!truncated && new URL(request.url).pathname === '/v1/backends/refresh' && response.status === 200) {
        truncated = true; await response.arrayBuffer();
        return new Response('{"nextTokenHash":', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return response;
    } };
  ` } } : { entryPoints: [fileURLToPath(new URL(settings.maintenance ? "../src/staging-reset-worker.ts" : settings.purge ? "../src/purge-worker.ts" : "../src/index.ts", import.meta.url))] };
  await build({ ...entry, bundle: true, format: "esm", platform: "browser", conditions: ["workerd"], target: "es2022", outfile: bundle, external: ["cloudflare:workers", "node:*"] });
  /** @type {Array<{to: string, url: string, kind: 'sign-in' | 'verify-email' | 'reset-password'}>} */
  const mail = [];
  let loginCount = 0;
  /** @type {import('miniflare').V4MiniflareOptions} */
  const options = { name: "bridge-test", modules: true, script: await readFile(bundle, "utf8"), compatibilityDate: "2026-07-30", compatibilityFlags: ["nodejs_compat"], host: "127.0.0.1", port: 0, unsafeInspectDurableObjects: true,
    durableObjects: { ACCOUNT_HUB: { className: "AccountHub", useSQLite: true } },
    r2Buckets: { BLOBS: "bridge-test-blobs", ...(settings.archive ? { BLOB_ARCHIVE: "bridge-test-archive" } : {}) },
    ...(settings.auth ? { d1Databases: { AUTH_DB: "bridge-auth-test" }, ...(settings.mail !== false ? { serviceBindings: { AUTH_MAILER: async (request) => {
      mail.push(/** @type {typeof mail[number]} */ (await request.json())); return Response.json({ ok: true });
    } } } : {}) } : {}),
    resourcePersistencePath: join(dir, "storage"), bindings: { BRIDGE_DEV_AUTH: settings.auth ? "false" : "true", BRIDGE_DEV_SECRET: secret,
      ...(settings.environment ? { BRIDGE_ENV: settings.environment } : {}),
      ...(settings.maintenance ? { BRIDGE_RESET_ACCOUNT: settings.maintenance.accountId, BRIDGE_RESET_TOKEN: settings.maintenance.token, BRIDGE_AUTH_URL: "https://mains-bridge-staging.team-68e.workers.dev" } : {}),
      ...(settings.purge ? { BRIDGE_PURGE_TOKEN: settings.purge.token } : {}),
      // Fixtures sign in with arbitrary addresses; mailGuard keeps the deployed closed-beta mail policy.
      ...(settings.mailGuard ? {} : { BRIDGE_MAIL_POLICY: "unrestricted" }),
      ...(settings.mailDailyLimit ? { BRIDGE_MAIL_DAILY_LIMIT: String(settings.mailDailyLimit) } : {}),
      ...(settings.storageLimitBytes !== undefined ? { BRIDGE_STORAGE_LIMIT_BYTES: String(settings.storageLimitBytes) } : {}),
      ...(settings.writesPerMinute !== undefined ? { BRIDGE_WRITES_PER_MINUTE: String(settings.writesPerMinute) } : {}),
      ...(settings.github ? { GITHUB_CLIENT_ID: "local-public-github-id", GITHUB_CLIENT_SECRET: "local-only-github-secret" } : {}),
      ...(settings.auth ? { BETTER_AUTH_SECRET: randomBytes(32).toString("hex") } : {}) } };
  let mf = new Miniflare(convertV4MiniflareOptions(options));
  /** @type {URL} */
  let address;
  try { address = await mf.ready; }
  catch (error) { await mf.dispose().catch(() => {}); await rm(dir, { recursive: true, force: true }); throw error; }
  if (settings.auth) {
    const db = await mf.getD1Database("AUTH_DB");
    for (const file of ["0001_auth.sql", "0002_bridge_identity.sql", "0003_bridge_quotas.sql", "0004_account_entitlements.sql", "0005_closed_beta.sql", "0006_backend_token_handover.sql", "0007_beta_invite_mail.sql"]) {
      const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");
      await db.batch(sql.split(";").filter((part) => part.trim()).map((part) => db.prepare(part)));
    }
  }
  /** Mail is queued through the Worker's real waitUntil; only delivery is local.
   * @param {string} email @param {'sign-in' | 'verify-email' | 'reset-password'} kind */
  async function deliveredMail(email, kind) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const entry = mail.filter((item) => item.to === email && item.kind === kind).at(-1);
      if (entry) return entry;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("Account email was not delivered");
  }
  /** Explicit paid test fixture; production sign-in never grants membership.
   * @param {string} accountId @param {'monthly' | 'yearly'} interval @param {number} [expiresAt] */
  async function grantSubscription(accountId, interval, expiresAt = Date.now() + 86_400_000) {
    const db = await mf.getD1Database("AUTH_DB");
    await db.prepare(`INSERT INTO account_entitlements VALUES(?,'bridge','standard',?,'active',?,?,?)
      ON CONFLICT(account_id,feature) DO UPDATE SET billing_interval=excluded.billing_interval,status='active',starts_at=excluded.starts_at,expires_at=excluded.expires_at,updated_at=excluded.updated_at`)
      .bind(accountId, interval, Date.now() - 1000, expiresAt, Date.now()).run();
  }
  /** The hub refuses an `iat` later than its own, real clock, and fake timers can run this process's clock
   * ahead of it; `performance` is never faked here. */
  const issuedAt = () => Math.floor(Math.min(Date.now(), performance.timeOrigin + performance.now()) / 1000);
  /** @param {string} accountId @param {string} backendId @param {string | number} expiresIn */
  const mint = (accountId, backendId, expiresIn) => new SignJWT({ accountId, signingPublicKey: fixturePublicKey(accountId, backendId) }).setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(backendId).setIssuer("mains-bridge-dev").setAudience("mains-bridge").setIssuedAt(issuedAt()).setExpirationTime(expiresIn).sign(new TextEncoder().encode(secret));
  /** One admission at a time per account, so concurrent fixtures never race the log's compare-and-swap. */
  const admissions = new Map();
  /** What this process last saw of each account's log; a known member needs no request (tokens are minted often).
   * @type {Map<string, { commitment: string, members: string[], head: { seq: number, hash: string } }>} */
  const accounts = new Map();
  /** Development tokens have no enrollment: the fixture appends real signed membership entries instead.
   * The first backend's genesis commits to `accountKey` (default: a key derived from the account id).
   * @param {string} accountId @param {string} backendId @param {Uint8Array} [accountKey] @returns {Promise<{ seq: number, hash: string }>} */
  function admit(accountId, backendId, accountKey) {
    const known = accounts.get(accountId);
    if (known?.members.includes(backendId) && (!accountKey || known.commitment === fixtureAccountCommitment(accountKey))) return Promise.resolve(known.head);
    const run = async () => {
      // A development hub appends through its real route; a hub with sign-in has no unauthenticated
      // route, so its fixtures seed the object's log directly (the object still verifies every read).
      const authorization = { Authorization: `Bearer ${await mint(accountId, backendId, "1h")}` };
      const storage = settings.auth ? await mf.unsafeGetDurableObjectStorage("bridge-test", "AccountHub", { id: (await mf.getDurableObjectNamespace("ACCOUNT_HUB")).idFromName(accountId).toString() }) : null;
      /** @type {any[]} */
      let entries;
      if (storage) {
        await storage.exec("CREATE TABLE IF NOT EXISTS membership(seq INTEGER PRIMARY KEY,hash TEXT NOT NULL,entry TEXT NOT NULL,appended_at INTEGER NOT NULL)");
        entries = [...await storage.exec("SELECT entry FROM membership ORDER BY seq")].map((row) => JSON.parse(String(row.entry)));
      } else {
        const response = await fetch(new URL("/v1/membership?after=-1", address), { headers: authorization });
        if (!response.ok) throw new Error(`Fixture membership read failed (${response.status})`);
        entries = (await response.json()).entries;
      }
      /** @param {any} entry */
      const append = async (entry) => {
        if (storage) await storage.exec("INSERT INTO membership(seq,hash,entry,appended_at) VALUES(?,?,?,?)", entry.seq, fixtureEntryHash(entry), JSON.stringify(entry), Date.now());
        else {
          const result = await fetch(new URL("/v1/membership", address), { method: "POST", headers: { ...authorization, "Content-Type": "application/json" }, body: JSON.stringify({ entry }) });
          if (!result.ok) throw new Error(`Fixture membership append failed (${result.status}): ${await result.text()}`);
        }
        entries.push(entry);
      };
      const key = accountKey ?? (entries.length ? undefined : fixtureAccountKey(accountId));
      if (!entries.length) await append(fixtureGenesis(accountId, backendId, /** @type {Uint8Array} */ (key)));
      else if (key && entries[0].body.accountKeyCommitment !== fixtureAccountCommitment(key)) throw new Error("This fixture account already committed to another account key");
      /** @type {string[]} */
      const members = [];
      for (const entry of entries) {
        if (entry.kind === "genesis" || entry.kind === "add") members.push(entry.body.member.backendId);
        else if (entry.kind === "remove") members.splice(members.indexOf(entry.body.backendId), 1);
      }
      const head = () => ({ seq: entries.length - 1, hash: fixtureEntryHash(entries.at(-1)) });
      if (!members.includes(backendId)) await append(fixtureMembershipEntry(accountId, head(), "add", { member: fixtureMember(accountId, backendId), via: "approval" }, members[0]));
      rememberFixtureHead(accountId, head());
      accounts.set(accountId, { commitment: entries[0].body.accountKeyCommitment, members: [...members, backendId], head: head() });
      return head();
    };
    const next = (admissions.get(accountId) ?? Promise.resolve()).then(run, run);
    admissions.set(accountId, next.catch(() => {}));
    return next;
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
      const entry = await deliveredMail(email, "sign-in");
      const callback = await fetch(entry.url, { redirect: "manual", headers: { "CF-Connecting-IP": ip } });
      const cookie = callback.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
      const session = await fetch(new URL("/api/auth/get-session", address), { headers: { Cookie: cookie, "CF-Connecting-IP": ip } });
      const value = await session.json();
      if (!value?.user?.emailVerified) throw new Error(`Magic-link verification failed (${callback.status})`);
      if (settings.subscriptionInterval) await grantSubscription(value.user.id, settings.subscriptionInterval);
      return { cookie, user: value.user };
    },
    deliveredMail,
    mail,
    grantSubscription,
    async database() { return mf.getD1Database("AUTH_DB"); },
    admit,
    /** A development token for a fixture backend that is a member of its account.
     * @param {string} accountId @param {string} backendId @param {string | number} [expiresIn] */
    async token(accountId, backendId, expiresIn = "1h") {
      // Only a development hub accepts these tokens; other configurations must still see them refused.
      if (!settings.auth && (!settings.environment || settings.environment === "local")) await admit(accountId, backendId);
      return mint(accountId, backendId, expiresIn);
    },
    async restart() { options.port = Number(address.port); await mf.dispose(); mf = new Miniflare(convertV4MiniflareOptions(options)); address = await mf.ready; },
    async suspend() { options.port = Number(address.port); await mf.dispose(); },
    async resume() { mf = new Miniflare(convertV4MiniflareOptions(options)); address = await mf.ready; },
    /** The Durable Object id Cloudflare lists for this account's hub.
     * @param {string} accountId */
    async objectId(accountId) { return (await mf.getDurableObjectNamespace("ACCOUNT_HUB")).idFromName(accountId).toString(); },
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
    async archiveBucket() { return mf.getR2Bucket("BLOB_ARCHIVE"); },
    async dispose() { await mf.dispose(); await rm(dir, { recursive: true, force: true }); },
  };
}
