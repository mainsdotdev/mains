import { createHash, randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { startLocalBridgeHub } from "./local-hub.mjs";

it("resets only the armed staging account and preserves its login and every other account", async () => {
  const accountId = "reset-target", other = "keep-account", token = randomBytes(32).toString("base64url");
  const hub = await startLocalBridgeHub({ auth: true, maintenance: { accountId, token } });
  const post = (account = accountId, auth = token, confirm = false) => fetch(new URL("/__maintenance/bridge-reset", hub.url), {
    method: "POST", headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" }, body: JSON.stringify({ accountId: account, confirm }),
  });
  try {
    const db = await hub.database(), bucket = await hub.bucket();
    const prefix = (id: string) => createHash("sha256").update(id).digest("hex") + "/";
    for (const id of [accountId, other]) {
      await db.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)').bind(id, id, `${id}@example.test`, Date.now(), Date.now()).run();
      await db.prepare("INSERT INTO bridge_accounts VALUES(?,?,?,?,?,?)").bind(id, "old-backend", "old-hash", "old-public-key", "old-wrap", Date.now()).run();
      await bucket.put(`${prefix(id)}${"a".repeat(43)}/0`, new Uint8Array([1, 2, 3]));
    }
    expect((await post(accountId, "wrong")).status).toBe(403);
    expect((await post(other)).status).toBe(403);
    expect((await post()).status).toBe(200);
    const otherToken = `b7_${randomBytes(32).toString("hex")}`;
    await db.prepare("INSERT INTO bridge_backends(account_id,backend_id,public_key,label,platform,status,token_hash,token_expires_at,created_at) VALUES(?,?,?,?,?,'approved',?,?,?)")
      .bind(other, "keep-backend", "keep-key", "Other", "node", createHash("sha256").update(otherToken).digest("hex"), Date.now() + 60_000, Date.now()).run();
    expect((await fetch(new URL("/v1/quota", hub.url), { headers: { Authorization: `Bearer ${otherToken}` } })).status).toBe(200);
    for (const id of [accountId, other]) await hub.quotaSql(id, "INSERT INTO streams VALUES('account',1); INSERT INTO log VALUES('account',1,'opaque','register','upsert',json_object('header',json_object('blobs',json('[]')),'body','ciphertext')); INSERT INTO deleted VALUES('deleted','account',1,'ciphertext');");
    const dryRun = await (await post()).json() as { records: number; blobs: number; initialized: boolean };
    expect(dryRun).toMatchObject({ records: 1, blobs: 1, initialized: true });
    expect(await hub.inspect(accountId)).toHaveLength(1);
    await db.prepare("INSERT INTO bridge_backends(account_id,backend_id,public_key,label,platform,status,token_hash,token_expires_at,created_at) VALUES(?,?,?,?,?,'approved',?,?,?)")
      .bind(accountId, "last-backend", "last-key", "Last", "node", "last-hash", Date.now() + 60_000, Date.now()).run();
    await db.prepare("INSERT INTO bridge_key_wraps VALUES(?,?,?)").bind(accountId, "last-backend", "sealed-old-key").run();
    expect((await post(accountId, token, true)).status).toBe(409);
    expect(await hub.inspect(accountId)).toHaveLength(1);
    expect((await bucket.list({ prefix: prefix(accountId) })).objects).toHaveLength(1);
    await db.prepare("UPDATE bridge_backends SET status='revoked' WHERE account_id=?").bind(accountId).run();
    expect((await post(accountId, token, true)).status).toBe(200);
    expect(await hub.inspect(accountId)).toHaveLength(0);
    expect(await hub.quotaSql(accountId, "SELECT count(*) n FROM deleted")).toMatchObject([{ n: 0 }]);
    expect(await hub.quotaSql(accountId, "SELECT bytes FROM record_usage WHERE id=1")).toEqual([{ bytes: 0 }]);
    expect(await hub.quotaSql(accountId, "SELECT blob_bytes,reserved_bytes FROM quota_usage WHERE id=1")).toEqual([{ blob_bytes: 0, reserved_bytes: 0 }]);
    expect(await hub.quotaSql(accountId, "SELECT count(*) n FROM blob_objects")).toEqual([{ n: 0 }]);
    expect(await hub.quotaSql(accountId, "SELECT count(*) n FROM blob_deletions")).toEqual([{ n: 0 }]);
    expect(await hub.quotaSql(accountId, "SELECT legacy_records FROM blob_gc_state")).toEqual([{ legacy_records: 0 }]);
    expect(await hub.inspect(other)).toHaveLength(1);
    expect((await bucket.list({ prefix: prefix(accountId) })).objects).toHaveLength(0);
    expect((await bucket.list({ prefix: prefix(other) })).objects).toHaveLength(1);
    expect(await db.prepare("SELECT count(*) n FROM user").first()).toMatchObject({ n: 2 });
    expect(await db.prepare("SELECT count(*) n FROM bridge_accounts WHERE account_id=?").bind(accountId).first()).toMatchObject({ n: 0 });
    expect(await db.prepare("SELECT count(*) n FROM bridge_backends WHERE account_id=?").bind(accountId).first()).toMatchObject({ n: 0 });
    expect(await db.prepare("SELECT count(*) n FROM bridge_key_wraps WHERE account_id=?").bind(accountId).first()).toMatchObject({ n: 0 });
    expect(await db.prepare("SELECT count(*) n FROM bridge_accounts WHERE account_id=?").bind(other).first()).toMatchObject({ n: 1 });
    expect(await (await post()).json()).toMatchObject({ records: 0, blobs: 0, initialized: false });
    // A retry after a network failure is safe.
    expect((await post(accountId, token, true)).status).toBe(200);
  } finally { await hub.dispose(); }
});

it("does not expose maintenance in the normal Worker", async () => {
  const hub = await startLocalBridgeHub({ auth: true });
  try {
    expect((await fetch(new URL("/__maintenance/bridge-reset", hub.url), { method: "POST" })).status).toBe(404);
  } finally { await hub.dispose(); }
});
