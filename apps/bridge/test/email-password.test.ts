import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { Script } from "node:vm";
import { BRIDGE_AUTH_CLIENT_ID } from "@mains/contracts/bridge-auth";
import { startBridgeLoopback } from "../../../packages/backend/src/modules/bridge/bridge.login";
import { startLocalBridgeHub } from "./local-hub.mjs";

let hub: Awaited<ReturnType<typeof startLocalBridgeHub>>;
let requests = 0;
const password = "Local-only test password 2026!";
beforeAll(async () => { hub = await startLocalBridgeHub({ auth: true, github: true }); });
afterAll(async () => { await hub?.dispose(); });
function post(path: string, body: unknown, cookie?: string, origin = new URL(hub.url).origin) {
  return fetch(new URL(`/api/auth/${path}`, hub.url), { method: "POST", headers: {
    "Content-Type": "application/json", Origin: origin, "CF-Connecting-IP": `198.51.100.${++requests}`, ...(cookie ? { Cookie: cookie } : {}),
  }, body: JSON.stringify(body) });
}
const cookies = (response: Response) => response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
async function session(cookie: string) {
  return (await fetch(new URL("/api/auth/get-session", hub.url), { headers: { Cookie: cookie } })).json();
}
async function createAccount(email = `${randomUUID()}@example.com`) {
  const response = await post("sign-up/email", { name: "Local test", email, password, callbackURL: "/sign-in?verified=1" });
  expect(response.status).toBe(200);
  const value = await response.json() as { token: string | null; user: { id: string; emailVerified: boolean } };
  expect(value.token).toBeNull(); expect(value.user.emailVerified).toBe(false);
  return { email, id: value.user.id };
}
async function verifiedAccount() {
  const user = await createAccount();
  const mail = await hub.deliveredMail(user.email, "verify-email");
  const response = await fetch(mail.url, { redirect: "manual" });
  expect(response.status).toBe(302); expect(response.headers.get("Location")).toContain("/sign-in?verified=1");
  expect(await session(cookies(response))).toBeNull();
  return user;
}
async function passwordReset(email: string) {
  const response = await post("request-password-reset", { email, redirectTo: new URL("/reset-password?next=%2Fdevice", hub.url).href });
  expect(response.status).toBe(200);
  const mail = await hub.deliveredMail(email, "reset-password");
  const redirect = await fetch(mail.url, { redirect: "manual" });
  expect(redirect.status).toBe(302);
  const target = new URL(redirect.headers.get("Location")!);
  expect(target.pathname).toBe("/reset-password"); expect(target.searchParams.get("next")).toBe("/device");
  return target.searchParams.get("token")!;
}

describe("Email/password authentication in the real local Worker", () => {
  it("requires email ownership, stores only a password hash and grants no beta/subscription access", async () => {
    const user = await createAccount();
    await hub.deliveredMail(user.email, "verify-email");
    const failed = await post("sign-in/email", { email: user.email, password });
    expect(failed.status).toBe(403); expect(cookies(failed)).not.toContain("session_token");
    // A password attempt before verification sends the link again.
    await vi.waitFor(() => expect(hub.mail.filter((mail) => mail.to === user.email && mail.kind === "verify-email")).toHaveLength(2));
    const db = await hub.database();
    const credential = await db.prepare("SELECT password FROM account WHERE userId=? AND providerId='credential'").bind(user.id).first<{ password: string }>();
    expect(credential?.password).toBeTruthy(); expect(credential!.password).not.toContain(password);
    expect(await db.prepare("SELECT count(*) n FROM account_entitlements WHERE account_id=?").bind(user.id).first()).toEqual({ n: 0 });
    expect((await fetch(new URL("/v1/subscription", hub.url))).status).toBe(401);
    const mail = await hub.deliveredMail(user.email, "verify-email");
    expect((await fetch(mail.url, { redirect: "manual" })).status).toBe(302);
    const signedIn = await post("sign-in/email", { email: user.email.toUpperCase(), password });
    expect(signedIn.status).toBe(200);
    const cookie = cookies(signedIn);
    expect(await session(cookie)).toMatchObject({ user: { id: user.id, emailVerified: true } });
    const rights = await fetch(new URL("/v1/subscription", hub.url), { headers: { Cookie: cookie } });
    expect(rights.status).toBe(200); expect(await rights.json()).toMatchObject({ subscription: { status: "none", canUpload: false } });
    expect((await post("sign-in/email", { email: user.email, password: "Wrong password 2026!" })).status).toBe(401);
  });

  it("validates password length and origin and keeps existing accounts on duplicate signup", async () => {
    const email = `${randomUUID()}@example.com`;
    for (const invalid of ["short", "x".repeat(129)]) {
      expect((await post("sign-up/email", { name: "Test", email, password: invalid })).status).toBe(400);
    }
    expect((await post("sign-up/email", { name: "Test", email, password }, undefined, "https://foreign.example")).status).toBe(403);
    const user = await verifiedAccount();
    expect((await post("sign-up/email", { name: "Impersonator", email: user.email, password: "Different password 2026!" })).status).toBe(200);
    const db = await hub.database();
    expect(await db.prepare("SELECT count(*) n FROM user WHERE email=?").bind(user.email).first()).toEqual({ n: 1 });
    const signedIn = await post("sign-in/email", { email: user.email, password });
    expect(await session(cookies(signedIn))).toMatchObject({ user: { id: user.id, name: "Local test" } });
  });

  it("resets a password once, revokes browser sessions and keeps the same account", async () => {
    const user = await verifiedAccount();
    const oldSession = cookies(await post("sign-in/email", { email: user.email, password }));
    const token = await passwordReset(user.email);
    expect((await post("reset-password", { token, newPassword: "short" })).status).toBe(400);
    const nextPassword = "Changed local password 2026!";
    expect((await post("reset-password", { token, newPassword: nextPassword })).status).toBe(200);
    expect((await post("reset-password", { token, newPassword: password })).status).toBe(400);
    expect(await session(oldSession)).toBeNull();
    expect((await post("sign-in/email", { email: user.email, password })).status).toBe(401);
    const nextSession = cookies(await post("sign-in/email", { email: user.email, password: nextPassword }));
    expect(await session(nextSession)).toMatchObject({ user: { id: user.id, emailVerified: true } });
    expect((await post("request-password-reset", { email: user.email, redirectTo: "https://foreign.example/reset" })).status).toBe(403);
    expect((await post("reset-password", { token: "not-a-token", newPassword: password })).status).toBe(400);
  });

  it("adds a password to an existing GitHub account without changing its identity, subscription or encrypted key material", async () => {
    const existing = await hub.login(`${randomUUID()}@example.com`), db = await hub.database();
    await db.prepare("INSERT INTO account(id,accountId,providerId,userId,createdAt,updatedAt) VALUES(?,?,'github',?,?,?)")
      .bind(randomUUID(), "local-github-id", existing.user.id, Date.now(), Date.now()).run();
    await hub.grantSubscription(existing.user.id, "monthly");
    // Synthetic encrypted material; never use a real account or recovery value.
    await db.prepare("INSERT INTO bridge_accounts(account_id,initializer_backend_id,initializer_token_hash,recovery_wrap,recovery_public_key,created_at) VALUES(?,?,?,?,?,?)")
      .bind(existing.user.id, "local-initializer", "local-initializer-token-hash", "opaque-test-wrap", "opaque-test-key", Date.now()).run();
    const before = await db.prepare("SELECT * FROM bridge_accounts WHERE account_id=?").bind(existing.user.id).first();
    const token = await passwordReset(existing.user.email);
    expect((await post("reset-password", { token, newPassword: password })).status).toBe(200);
    const signedIn = await post("sign-in/email", { email: existing.user.email, password });
    expect(signedIn.status).toBe(200); expect(await session(cookies(signedIn))).toMatchObject({ user: { id: existing.user.id } });
    expect(await db.prepare("SELECT * FROM bridge_accounts WHERE account_id=?").bind(existing.user.id).first()).toEqual(before);
    expect(await db.prepare("SELECT status FROM account_entitlements WHERE account_id=?").bind(existing.user.id).first()).toEqual({ status: "active" });
    expect(await db.prepare("SELECT count(*) n FROM user WHERE email=?").bind(existing.user.email).first()).toEqual({ n: 1 });
    expect(await db.prepare("SELECT providerId FROM account WHERE userId=? ORDER BY providerId").bind(existing.user.id).all()).toMatchObject({ results: [{ providerId: "credential" }, { providerId: "github" }] });
  });

  it("rejects expired reset and invalid verification links and does not reveal unknown reset accounts", async () => {
    const user = await verifiedAccount(), token = await passwordReset(user.email), db = await hub.database();
    await db.prepare("UPDATE verification SET expiresAt=0 WHERE identifier=?").bind(`reset-password:${token}`).run();
    expect((await post("reset-password", { token, newPassword: password })).status).toBe(400);
    const mailCount = hub.mail.length;
    const unknown = await post("request-password-reset", { email: `${randomUUID()}@example.com` });
    expect(unknown.status).toBe(200); expect(await unknown.json()).toMatchObject({ status: true }); expect(hub.mail).toHaveLength(mailCount);
    const invalid = await fetch(new URL("/api/auth/verify-email?token=invalid&callbackURL=%2Fsign-in", hub.url), { redirect: "manual" });
    expect(invalid.status).toBe(302); expect(invalid.headers.get("Location")).toContain("error=");
  });

  it("does not inherit an unverified signup's password when the mailbox owner signs in with an email link", async () => {
    const unverified = await createAccount();
    const owner = await hub.login(unverified.email);
    expect(owner.user.id).toBe(unverified.id); expect(owner.user.emailVerified).toBe(true);
    expect((await post("sign-in/email", { email: unverified.email, password })).status).toBe(401);
    expect(await (await hub.database()).prepare("SELECT count(*) n FROM account WHERE userId=? AND providerId='credential'").bind(unverified.id).first()).toEqual({ n: 0 });
  });

  it.each(["loopback", "device"] as const)("hands a verified password session back to the %s application sign-in flow", async (flow) => {
    const user = await verifiedAccount(), cookie = cookies(await post("sign-in/email", { email: user.email, password }));
    await hub.grantSubscription(user.id, "monthly");
    let token: string | undefined;
    if (flow === "loopback") {
      const listener = await startBridgeLoopback(hub.url, async (value) => { token = value; }, () => {});
      try {
        const url = new URL(listener.url);
        const consent = await fetch(new URL("/v1/auth/authorize", hub.url), { method: "POST", headers: { Cookie: cookie, Origin: new URL(hub.url).origin, "Content-Type": "application/json" },
          body: JSON.stringify({ redirectUri: url.searchParams.get("redirect_uri"), challenge: url.searchParams.get("code_challenge"), state: url.searchParams.get("state") }) });
        expect(consent.status).toBe(200);
        expect((await fetch((await consent.json() as { redirect: string }).redirect)).status).toBe(200);
      } finally { listener.close(); }
    } else {
      const start = await post("device/code", { client_id: BRIDGE_AUTH_CLIENT_ID });
      expect(start.status).toBe(200);
      const code = await start.json() as { device_code: string; user_code: string };
      expect((await fetch(new URL(`/api/auth/device?user_code=${code.user_code}`, hub.url), { headers: { Cookie: cookie } })).status).toBe(200);
      expect((await post("device/approve", { userCode: code.user_code }, cookie)).status).toBe(200);
      const poll = await post("device/token", { client_id: BRIDGE_AUTH_CLIENT_ID, device_code: code.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
      expect(poll.status).toBe(200); token = (await poll.json() as { access_token: string }).access_token;
    }
    expect(token).toBeTruthy();
    const registration = await fetch(new URL("/v1/backends", hub.url), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Origin: new URL(hub.url).origin },
      body: JSON.stringify({ backendId: randomUUID(), publicKey: randomBytes(32).toString("base64url"), signingPublicKey: randomBytes(32).toString("base64url"), label: "Password test device", platform: "test" }) });
    expect(registration.status).toBe(201); expect(await registration.json()).toMatchObject({ accountId: user.id });
  });
});

describe("Browser entry pages", () => {
  it("preserves device/PKCE destinations across forms, keeps credentials out of URLs and serves valid CSP-protected scripts", async () => {
    const next = "/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A4321%2Fcallback&state=local-only";
    for (const mode of ["sign-in", "create", "forgot", "link"]) {
      const response = await fetch(new URL(`/sign-in?${new URLSearchParams({ mode, next })}`, hub.url));
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store"); expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
      const html = await response.text(), script = html.match(/<script nonce="([^"]+)">([\s\S]*?)<\/script>/)!;
      expect(response.headers.get("Content-Security-Policy")).toContain(`script-src 'nonce-${script[1]}'`);
      expect(() => new Script(script[2])).not.toThrow(); expect(html).toContain(JSON.stringify(next));
      expect(html).not.toMatch(/localStorage|sessionStorage/);
    }
    const reset = await fetch(new URL("/reset-password?token=test-only&next=%2Fdevice", hub.url));
    const html = await reset.text();
    expect(html).not.toContain("test-only"); expect(() => new Script(html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1])).not.toThrow();
    expect(html).toContain("history.replaceState");
    const external = await (await fetch(new URL("/sign-in?next=https://foreign.example", hub.url))).text();
    expect(external).not.toContain("https://foreign.example");
    const social = await post("sign-in/social", { provider: "github", callbackURL: "/device" });
    expect(social.status).toBe(200); expect((await social.json() as { url: string }).url).toMatch(/^https:\/\/github.com\/login\/oauth\/authorize\?/);
  });

  it("does not offer or enable password registration without an email delivery service", async () => {
    const offline = await startLocalBridgeHub({ auth: true, mail: false });
    try {
      const page = await (await fetch(new URL("/sign-in", offline.url))).text();
      expect(page).not.toContain('name="password"');
      const response = await fetch(new URL("/api/auth/sign-up/email", offline.url), { method: "POST", headers: { "Content-Type": "application/json", Origin: new URL(offline.url).origin }, body: JSON.stringify({ name: "Test", email: "disabled@example.com", password }) });
      expect(response.status).toBe(400);
      expect(await (await offline.database()).prepare("SELECT count(*) n FROM user").first()).toEqual({ n: 0 });
    } finally { await offline.dispose(); }
  });
});
