import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { BRIDGE_MAIL_DAILY_LIMIT, BRIDGE_MAIL_PER_ADDRESS_HOURLY } from "../src/auth-mail";
import { bridgeBetaInvite, bridgeBetaRevoke } from "../src/beta-admin";
import { startLocalBridgeHub } from "./local-hub.mjs";

type Hub = Awaited<ReturnType<typeof startLocalBridgeHub>>;
let ip = 0;
const address = () => `${randomUUID()}@example.test`;
async function guarded(test: (hub: Hub) => Promise<void>) {
  const hub = await startLocalBridgeHub({ auth: true, mailGuard: true });
  try { await test(hub); } finally { await hub.dispose(); }
}
/** The sign-in link is sent before its response, so the mail list is final when this returns. */
function link(hub: Hub, email: string) {
  return fetch(new URL("/api/auth/sign-in/magic-link", hub.url), { method: "POST", headers: { "Content-Type": "application/json",
    Origin: new URL(hub.url).origin, "CF-Connecting-IP": `198.51.100.${++ip % 250}` }, body: JSON.stringify({ email, callbackURL: "/device" }) });
}
const sent = (hub: Hub, email: string) => hub.mail.filter((mail) => mail.to === email).length;
async function sql(hub: Hub, statement: { sql: string; params: (string | number)[] }) { await (await hub.database()).prepare(statement.sql).bind(...statement.params).run(); }
async function user(hub: Hub, email: string) {
  const id = randomUUID();
  await (await hub.database()).prepare("INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)").bind(id, "Owner", email, Date.now(), Date.now()).run();
  return id;
}

it("emails only addresses that can use Bridge, and answers every address alike", async () => guarded(async (hub) => {
  const stranger = address(), invited = address(), revoked = address(), owner = address(), subscriber = address();
  await sql(hub, bridgeBetaInvite(invited)); await sql(hub, bridgeBetaInvite(revoked)); await sql(hub, bridgeBetaRevoke(revoked));
  // A Bridge account keeps recovery mail after its invitation ends; a paid entitlement needs no invitation.
  const ownerId = await user(hub, owner);
  await (await hub.database()).prepare("INSERT INTO bridge_accounts(account_id,initializer_backend_id,initializer_token_hash,recovery_wrap,recovery_public_key,created_at) VALUES(?,?,?,?,?,?)")
    .bind(ownerId, "initializer", "token-hash", "opaque-wrap", "opaque-key", Date.now()).run();
  await hub.grantSubscription(await user(hub, subscriber), "monthly");
  for (const email of [stranger, invited, revoked, owner, subscriber]) expect((await link(hub, email)).status).toBe(200);
  expect([stranger, invited, revoked, owner, subscriber].map((email) => sent(hub, email))).toEqual([0, 1, 0, 1, 1]);
}));

it("sends an address at most three emails an hour, without a different answer", async () => guarded(async (hub) => {
  const invited = address(); await sql(hub, bridgeBetaInvite(invited));
  for (let i = 0; i <= BRIDGE_MAIL_PER_ADDRESS_HOURLY; i++) expect((await link(hub, invited)).status).toBe(200);
  expect(sent(hub, invited)).toBe(BRIDGE_MAIL_PER_ADDRESS_HOURLY);
}));

it("stops all email after the daily limit and says so to every address", async () => guarded(async (hub) => {
  const invited = Array.from({ length: BRIDGE_MAIL_DAILY_LIMIT + 1 }, address);
  for (const email of invited) await sql(hub, bridgeBetaInvite(email));
  for (const email of invited.slice(0, BRIDGE_MAIL_DAILY_LIMIT)) expect((await link(hub, email)).status).toBe(200);
  expect(hub.mail).toHaveLength(BRIDGE_MAIL_DAILY_LIMIT);
  for (const email of [invited.at(-1)!, address()]) {
    const refused = await link(hub, email);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ message: "Email is paused for today. Continue with GitHub or try again tomorrow." });
  }
  expect(hub.mail).toHaveLength(BRIDGE_MAIL_DAILY_LIMIT);
}));
