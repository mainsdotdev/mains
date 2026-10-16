import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Script } from "node:vm";
import WebSocket from "ws";
import { afterAll, beforeAll, expect, it } from "vitest";
import { BRIDGE_AUTH_CLIENT_ID } from "@mains/contracts/bridge-auth";
import type { BridgeSubscriptionStatus } from "@mains/contracts/bridge-subscription";
import type { BridgeBlobPresignResult } from "@mains/contracts/bridge-blobs";
import type { BridgeClientMessage, BridgeEnvelope, BridgeRpcResponse } from "@mains/contracts/bridge-protocol";
import { bridgeBetaInvite, bridgeBetaRevoke, bridgeBetaExtend } from "../src/beta-admin";
import { startLocalBridgeHub } from "./local-hub.mjs";
import { startBridgeLoopback } from "../../../packages/backend/src/modules/bridge/bridge.login";

let hub: Awaited<ReturnType<typeof startLocalBridgeHub>>;
beforeAll(async () => { hub = await startLocalBridgeHub({ auth: true, github: true }); });
afterAll(async () => { await hub?.dispose(); });
type Browser = Awaited<ReturnType<typeof hub.login>>;
const origin = () => new URL(hub.url).origin;
const email = () => `${randomUUID()}@example.test`;
async function sql(statement: { sql: string; params: (string | number)[] }) {
  return (await hub.database()).prepare(statement.sql).bind(...statement.params).run();
}
async function request(path: string, browser?: Browser, body?: unknown, method = body === undefined ? "GET" : "POST", from: string | null = origin()) {
  return fetch(new URL(path, hub.url), { method, redirect: "manual", headers: { "Content-Type": "application/json", ...(browser ? { Cookie: browser.cookie } : {}), ...(from ? { Origin: from } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const activate = (browser?: Browser, body: unknown = {}) => request("/v1/beta/activate", browser, body);
const subscription = async (browser: Browser) => (await (await request("/v1/subscription", browser)).json() as BridgeSubscriptionStatus).subscription;
const nativeArgs = () => ({ redirectUri: "http://127.0.0.1:4321/callback", challenge: randomBytes(32).toString("base64url"), state: randomBytes(32).toString("base64url") });
const nativePath = (args: ReturnType<typeof nativeArgs>) => `/authorize?${new URLSearchParams({ redirect_uri: args.redirectUri, code_challenge: args.challenge, state: args.state })}`;
async function invite(address = email()) { await sql(bridgeBetaInvite(address)); return address; }
async function row(address: string) { return (await hub.database()).prepare("SELECT * FROM bridge_beta_invites WHERE email=?").bind(address).first(); }
async function register(browser: Browser) {
  return request("/v1/backends", browser, { backendId: randomUUID(), publicKey: randomBytes(32).toString("base64url"), label: "Local beta test", platform: "test" });
}

it("keeps public login and uninvited accounts free of beta offers and blocks direct enrollment/approval", async () => {
  for (const path of ["/sign-in", "/sign-in?mode=create", "/sign-in?mode=forgot"]) expect(await (await request(path)).text()).not.toMatch(/beta|Activate beta/i);
  expect((await activate()).status).toBe(401);
  const browser = await hub.login(email()), args = nativeArgs();
  for (const path of ["/device", nativePath(args)]) {
    const response = await request(`${path}${path.includes("?") ? "&" : "?"}email=someone-else%40example.test`, browser), html = await response.text();
    expect(html).toContain("Bridge access is not available for this account yet.");
    expect(html).toContain(`Signed in as <strong>${browser.user.email}</strong>`);
    expect(html).not.toContain("someone-else@example.test");
    expect(html).not.toMatch(/beta|invited|waitlist|request access/i);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  }
  expect((await activate(browser, { email: "invited@example.test", expiresAt: "2099-01-01" })).status).toBe(403);
  expect((await register(browser)).status).toBe(403);
  expect((await request("/v1/auth/authorize", browser, args)).status).toBe(403);
  expect((await request("/api/auth/device/approve", browser, { userCode: "GUESSING" })).status).toBe(403);
  const db = await hub.database();
  expect(await db.prepare("SELECT count(*) n FROM bridge_backends WHERE account_id=?").bind(browser.user.id).first()).toEqual({ n: 0 });
  expect(await db.prepare("SELECT count(*) n FROM bridge_login_codes WHERE user_id=?").bind(browser.user.id).first()).toEqual({ n: 0 });
  expect(await subscription(browser)).toMatchObject({ status: "none", canUpload: false });
});

it("starts exactly 30 days only on activation, keeps retries/devices idempotent and invalidates cached denial", async () => {
  const address = await invite(`  ${email().toUpperCase()}  `), normalized = address.trim().toLowerCase(), browser = await hub.login(normalized), args = nativeArgs(), next = nativePath(args);
  const before = await row(normalized);
  expect(before).toMatchObject({ status: "invited", account_id: null, activated_at: null, expires_at: null });
  for (const path of ["/device", next]) {
    const response = await request(path, browser), html = await response.text();
    expect(html).toContain("Activate beta"); expect(html).toContain("Your 30 days start when you activate.");
    const script = html.match(/<script nonce="([^"]+)">([\s\S]*?)<\/script>/)!;
    expect(response.headers.get("Content-Security-Policy")).toContain(`script-src 'nonce-${script[1]}'`);
    expect(() => new Script(script[2])).not.toThrow();
  }
  expect(await row(normalized)).toEqual(before);
  expect((await subscription(browser)).canUpload).toBe(false); // Cache a denial in the account DO.
  expect((await register(browser)).status).toBe(403);
  expect((await request("/v1/auth/authorize", browser, args)).status).toBe(403);
  expect((await request("/v1/beta/activate", browser, {}, "POST", "https://foreign.example")).status).toBe(403);
  expect((await request("/v1/beta/activate", browser, {}, "POST", null)).status).toBe(403);
  expect((await request("/v1/beta/activate", browser)).status).toBe(405);
  expect(await row(normalized)).toEqual(before);
  const started = Date.now();
  const clicks = await Promise.all(Array.from({ length: 6 }, () => activate(browser, { next, startsAt: 0, expiresAt: 1, planId: "unlimited", accountId: "someone-else" })));
  expect(clicks.map((response) => response.status)).toEqual(Array(6).fill(200));
  const values = await Promise.all(clicks.map((response) => response.json())) as { startsAt: string; expiresAt: string; redirect: string }[];
  expect(values.every((value) => JSON.stringify(value) === JSON.stringify(values[0]))).toBe(true);
  expect(Date.parse(values[0].startsAt)).toBeGreaterThanOrEqual(started);
  expect(Date.parse(values[0].startsAt)).toBeLessThanOrEqual(Date.now());
  expect(Date.parse(values[0].expiresAt) - Date.parse(values[0].startsAt)).toBe(30 * 86_400_000);
  expect(values[0].redirect).toBe(next);
  expect(await subscription(browser)).toMatchObject({ source: "beta", status: "active", planId: "standard", billingInterval: null, canUpload: true, startsAt: values[0].startsAt, expiresAt: values[0].expiresAt });
  const activated = await row(normalized);
  expect(activated?.account_id).toBe(browser.user.id);
  expect((await register(browser)).status).toBe(201);
  expect((await register(await hub.login(normalized))).status).toBe(201);
  expect(await row(normalized)).toEqual(activated);
  expect(await (await request(next, browser)).text()).toContain("Continue to Mains");
  expect(await (await request(next, browser)).text()).not.toContain("Activate beta");
  expect((await activate(browser, { next: "https://foreign.example" })).status).toBe(200);
  expect(await (await activate(browser, { next: "/device-evil" })).json()).toMatchObject({ redirect: "/device" });
  expect(await row(normalized)).toEqual(activated);
  expect(await (await hub.database()).prepare("SELECT count(*) n FROM account_entitlements WHERE account_id=?").bind(browser.user.id).first()).toEqual({ n: 0 });
});

it("requires the exact verified mailbox and never lets a second account consume an invitation", async () => {
  const address = await invite(), intended = await hub.login(address), other = await hub.login(address.replace("@", "+alias@"));
  expect((await activate(other, { email: address, accountId: intended.user.id })).status).toBe(403);
  const db = await hub.database();
  await db.prepare('UPDATE user SET emailVerified=0 WHERE id=?').bind(intended.user.id).run();
  expect((await activate(intended)).status).toBe(401);
  expect((await request("/device", intended)).status).toBe(302);
  expect(await row(address)).toMatchObject({ activated_at: null, account_id: null });
  await db.prepare('UPDATE user SET emailVerified=1 WHERE id=?').bind(intended.user.id).run();
  expect((await activate(intended)).status).toBe(200);
  // Even a later verified email change plus another invite cannot start a new
  // grant on this account. The original period remains bound to its account ID.
  const changed = await invite(), saved = await row(address);
  await db.prepare('UPDATE user SET email=? WHERE id=?').bind(changed, intended.user.id).run();
  expect((await activate(intended)).status).toBe(200);
  expect(await row(address)).toEqual(saved); expect(await row(changed)).toMatchObject({ account_id: null, activated_at: null });
});

it("keeps cancelled invitations private and cannot renew an activated grant through re-inviting or activation", async () => {
  const address = await invite(), browser = await hub.login(address);
  await sql(bridgeBetaRevoke(address));
  expect(await (await request("/device", browser)).text()).not.toMatch(/beta|invited/i);
  expect((await activate(browser)).status).toBe(403);
  await sql(bridgeBetaInvite(address)); expect((await activate(browser)).status).toBe(200);
  const original = await row(address);
  await sql(bridgeBetaRevoke(address)); await sql(bridgeBetaInvite(address));
  expect(await row(address)).toMatchObject({ status: "revoked", activated_at: original!.activated_at, expires_at: original!.expires_at });
  expect((await activate(browser)).status).toBe(403);
  await hub.evict(browser.user.id);
  expect(await subscription(browser)).toMatchObject({ source: "beta", status: "revoked", canUpload: false });
  const expiry = Number(original!.expires_at) + 86_400_000, extension = bridgeBetaExtend(address, expiry);
  await sql(extension); const extended = await row(address); await sql(extension);
  expect(await row(address)).toEqual(extended); expect(extended).toMatchObject({ activated_at: original!.activated_at, expires_at: expiry, status: "active" });
  expect((await activate(browser)).status).toBe(200); expect(await row(address)).toEqual(extended);
});

it("preserves existing subscriptions and legacy account recovery while blocking pre-rollout pending credentials", async () => {
  const browser = await hub.login(email()), db = await hub.database();
  await hub.grantSubscription(browser.user.id, "yearly");
  const paid = await db.prepare("SELECT * FROM account_entitlements WHERE account_id=?").bind(browser.user.id).first();
  await invite(browser.user.email); expect((await activate(browser)).status).toBe(200);
  await sql(bridgeBetaRevoke(browser.user.email));
  expect(await subscription(browser)).toMatchObject({ status: "active", billingInterval: "yearly", canUpload: true });
  expect((await subscription(browser)).source).toBeUndefined();
  expect(await db.prepare("SELECT * FROM account_entitlements WHERE account_id=?").bind(browser.user.id).first()).toEqual(paid);
  const legacy = await hub.login(email());
  await db.prepare("INSERT INTO bridge_accounts VALUES(?,?,?,?,?,?)").bind(legacy.user.id, "old-device", "old-hash", "encrypted-key", "encrypted-wrap", Date.now()).run();
  expect(await (await request("/device", legacy)).text()).toContain("Authorize your device");
  expect((await register(legacy)).status).toBe(201);
  expect(await db.prepare("SELECT recovery_wrap FROM bridge_accounts WHERE account_id=?").bind(legacy.user.id).first()).toEqual({ recovery_wrap: "encrypted-wrap" });
  const denied = await hub.login(email()), token = `b7_${randomBytes(32).toString("hex")}`;
  await db.prepare("INSERT INTO bridge_backends(account_id,backend_id,public_key,label,platform,status,token_hash,token_expires_at,created_at) VALUES(?,?,?,?,?,'pending',?,?,?)")
    .bind(denied.user.id, "pending-old", randomBytes(32).toString("base64url"), "Old pending device", "test", createHash("sha256").update(token).digest("hex"), Date.now() + 60_000, Date.now()).run();
  const bootstrap = await fetch(new URL("/v1/keys/bootstrap", hub.url), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
  expect(bootstrap.status).toBe(403);
  expect(await db.prepare("SELECT count(*) n FROM bridge_accounts WHERE account_id=?").bind(denied.user.id).first()).toEqual({ n: 0 });
});

it("continues the device-code flow after activation without starting a second period", async () => {
  const browser = await hub.login(await invite());
  const start = await (await request("/api/auth/device/code", undefined, { client_id: BRIDGE_AUTH_CLIENT_ID })).json() as { device_code: string; user_code: string };
  expect((await request("/api/auth/device/approve", browser, { userCode: start.user_code })).status).toBe(403);
  expect((await activate(browser, { next: `/device?user_code=${start.user_code}` })).status).toBe(200);
  const original = await row(browser.user.email);
  expect((await request(`/api/auth/device?user_code=${start.user_code}`, browser)).status).toBe(200);
  expect((await request("/api/auth/device/approve", browser, { userCode: start.user_code })).status).toBe(200);
  const poll = await request("/api/auth/device/token", undefined, { client_id: BRIDGE_AUTH_CLIENT_ID, device_code: start.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
  expect(poll.status).toBe(200);
  const token = (await poll.json() as { access_token: string }).access_token;
  const registration = await fetch(new URL("/v1/backends", hub.url), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Origin: origin() },
    body: JSON.stringify({ backendId: randomUUID(), publicKey: randomBytes(32).toString("base64url"), label: "Device-code beta test", platform: "node" }) });
  expect(registration.status).toBe(201);
  expect(await row(browser.user.email)).toEqual(original);
});

it("preserves the native state/PKCE callback through activation and connects the desktop identity", async () => {
  const browser = await hub.login(await invite()); let token: string | undefined;
  const listener = await startBridgeLoopback(hub.url, async (value) => { token = value; }, () => {});
  try {
    const url = new URL(listener.url), next = url.pathname + url.search;
    expect(await (await request(next, browser)).text()).toContain("Activate beta");
    const activated = await (await activate(browser, { next })).json() as { redirect: string };
    expect(activated.redirect).toBe(next);
    const consent = await request("/v1/auth/authorize", browser, { redirectUri: url.searchParams.get("redirect_uri"), challenge: url.searchParams.get("code_challenge"), state: url.searchParams.get("state") });
    expect(consent.status).toBe(200);
    expect((await fetch((await consent.json() as { redirect: string }).redirect)).status).toBe(200);
    expect(token).toBeTruthy();
    const registration = await fetch(new URL("/v1/backends", hub.url), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Origin: origin() },
      body: JSON.stringify({ backendId: randomUUID(), publicKey: randomBytes(32).toString("base64url"), label: "Native beta test", platform: "darwin" }) });
    expect(registration.status).toBe(201);
    expect(await subscription(browser)).toMatchObject({ source: "beta", status: "active" });
  } finally { listener.close(); }
});

it("stops sync writes and old upload capabilities at expiry but preserves downloads, reads and deletion", async () => {
  const browser = await hub.login(await invite()); expect((await activate(browser)).status).toBe(200);
  const db = await hub.database(), end = Date.now() + 3000, token = `b7_${randomBytes(32).toString("hex")}`;
  // Shorten only this disposable test grant to exercise real expiry on a live
  // socket. Production has no client endpoint for changing grant timestamps.
  await db.prepare("UPDATE bridge_beta_invites SET expires_at=? WHERE account_id=?").bind(end, browser.user.id).run();
  await db.prepare("INSERT INTO bridge_backends(account_id,backend_id,public_key,label,platform,status,token_hash,token_expires_at,created_at) VALUES(?,?,?,?,?,'approved',?,?,?)")
    .bind(browser.user.id, "A", randomBytes(32).toString("base64url"), "Local beta device", "test", createHash("sha256").update(token).digest("hex"), end + 60_000, Date.now()).run();
  const socket = new WebSocket(hub.wsUrl, { headers: { Authorization: `Bearer ${token}` } });
  const pending = new Map<string, (value: unknown) => void>();
  socket.on("message", (bytes) => { const frame = JSON.parse(bytes.toString()) as BridgeRpcResponse; if ("requestId" in frame) { pending.get(frame.requestId)?.("message" in frame ? frame.message : frame); pending.delete(frame.requestId); } });
  const rpc = (message: BridgeClientMessage) => new Promise<unknown>((resolve) => { const requestId = randomUUID(); pending.set(requestId, resolve); socket.send(JSON.stringify({ requestId, message })); });
  const http = (path: string, body: unknown) => fetch(new URL(path, hub.url), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const one = { blobId: randomBytes(32).toString("base64url"), size: 3 }, two = { ...one, blobId: randomBytes(32).toString("base64url") };
  const sign = async (op: "put" | "get", blob = one) => {
    const response = await http("/v1/blobs/presign", { op, blobs: [blob] }); expect(response.status).toBe(200);
    return (await response.json() as BridgeBlobPresignResult).blobs[0].chunks[0].url;
  };
  const rowKey = randomBytes(16).toString("base64url"), registerKey = randomBytes(16).toString("base64url");
  const record = (op: "upsert" | "delete" = "upsert"): BridgeEnvelope => {
    const header = { v: 1 as const, stream: "account" as const, rowKey, origin: "A", hlc: { physicalMs: Date.now(), counter: 0 } };
    return { header: op === "upsert" ? { ...header, op, registerKey } : { ...header, op }, body: { nonce: randomBytes(24).toString("base64url"), payload: randomBytes(64).toString("base64url") } };
  };
  try {
    await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    const bytes = randomBytes(43), put = await sign("put"), queued = await sign("put", two);
    expect((await fetch(put, { method: "PUT", body: bytes })).status).toBe(204);
    const get = await sign("get"), envelope = record();
    expect(await rpc({ type: "push", stream: "account", records: [envelope] })).toMatchObject({ results: [{ seq: 1 }] });
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, end - Date.now() + 30)));
    expect(await rpc({ type: "push", stream: "account", records: [record()] })).toMatchObject({ results: [{ error: "subscriptionRequired" }] });
    expect((await fetch(queued, { method: "PUT", body: bytes })).status).toBe(403);
    expect(Buffer.from(await (await fetch(get)).arrayBuffer())).toEqual(bytes);
    expect(Buffer.from(await (await fetch(await sign("get"))).arrayBuffer())).toEqual(bytes);
    expect(await rpc({ type: "pull", stream: "account", after: 0, limit: 100 })).toMatchObject({ records: [{ envelope }] });
    expect(await rpc({ type: "push", stream: "account", records: [record("delete")] })).toMatchObject({ results: [{ seq: 2 }] });
    const expired = await subscription(browser); expect(expired).toMatchObject({ source: "beta", status: "expired", canUpload: false });
    expect((await activate(browser)).status).toBe(200); expect(await subscription(browser)).toEqual(expired);
  } finally { socket.terminate(); }
});
