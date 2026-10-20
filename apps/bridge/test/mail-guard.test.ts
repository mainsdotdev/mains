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

it("emails any address, invited or not: Bridge access is gated after sign-in", async () => guarded(async (hub) => {
  const stranger = address(), revoked = address();
  await sql(hub, bridgeBetaInvite(revoked)); await sql(hub, bridgeBetaRevoke(revoked));
  for (const email of [stranger, revoked]) expect((await link(hub, email)).status).toBe(200);
  expect([stranger, revoked].map((email) => sent(hub, email))).toEqual([1, 1]);
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
