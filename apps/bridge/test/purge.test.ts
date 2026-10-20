import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { startLocalBridgeHub } from "./local-hub.mjs";

const route = "/__maintenance/bridge-purge";

it("deletes only hubs no D1 account names, after a dry run that changes nothing", async () => {
  const token = randomBytes(32).toString("base64url");
  const hub = await startLocalBridgeHub({ auth: true, purge: { token } });
  const post = (body: unknown, auth = token) => fetch(new URL(route, hub.url), {
    method: "POST", headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const stored = async (account: string) => [...await hub.quotaSql(account, "SELECT name FROM sqlite_master WHERE type='table' AND name='membership'")].length;
  try {
    const db = await hub.database(), accounts = ["signed-up", "revoked", "orphan"];
    for (const account of accounts) await hub.admit(account, "A");
    for (const account of ["signed-up", "revoked"]) await db.prepare("INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)")
      .bind(account, account, `${account}@example.test`, Date.now(), Date.now()).run();
    // An account whose every backend was revoked keeps its hub as long as its user exists.
    await db.prepare("INSERT INTO bridge_backends(account_id,backend_id,public_key,signing_public_key,label,platform,status,token_hash,token_expires_at,created_at) VALUES(?,?,?,?,?,?,'revoked',?,?,?)")
      .bind("revoked", "A", "key", "signing-key", "A", "node", "hash", 0, Date.now()).run();
    const [signedUp, revoked, orphan] = await Promise.all(accounts.map((account) => hub.objectId(account)));
    const ids = [signedUp, revoked, orphan], expected = { purged: [orphan], owned: [signedUp, revoked] };

    expect((await post({ ids, confirm: true }, randomBytes(32).toString("base64url"))).status).toBe(403);
    expect((await fetch(new URL(route, hub.url))).status).toBe(404);
    expect((await post({ ids })).status).toBe(400);
    expect((await post({ ids: ["F".repeat(64)], confirm: false })).status).toBe(400);
    expect(await (await post({ ids, confirm: false })).json()).toEqual(expected);
    for (const account of accounts) expect(await stored(account)).toBe(1);

    expect(await (await post({ ids, confirm: true })).json()).toEqual(expected);
    expect(await stored("orphan")).toBe(0);
    expect(await stored("signed-up")).toBe(1); expect(await stored("revoked")).toBe(1);
    // A retry after a lost response is harmless, and every other route still reaches the normal Worker.
    expect(await (await post({ ids: [orphan], confirm: true })).json()).toEqual({ purged: [orphan], owned: [] });
    expect((await fetch(new URL("/health", hub.url))).status).toBe(200);
  } finally { await hub.dispose(); }
});

it("does not expose the purge route in the normal Worker", async () => {
  const hub = await startLocalBridgeHub({ auth: true });
  try {
    expect((await fetch(new URL(route, hub.url), { method: "POST" })).status).toBe(404);
  } finally { await hub.dispose(); }
});
