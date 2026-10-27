import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { BridgeEnvelope, BridgeRpcResponse } from "@mains/contracts/bridge-protocol";
import { BRIDGE_REPLAY_HORIZON_MS } from "@mains/contracts/bridge-membership";
import { startLocalBridgeHub } from "./local-hub.mjs";
import { fixtureFence, fixtureGenesis, fixtureMember, fixtureMembershipEntry, fixturePublicKey, signFixture } from "./record-signing.mjs";

let hub: Awaited<ReturnType<typeof startLocalBridgeHub>>;
const sockets: WebSocket[] = [];
beforeAll(async () => { hub = await startLocalBridgeHub(); });
afterEach(() => { for (const socket of sockets.splice(0)) socket.terminate(); });
afterAll(async () => { await hub?.dispose(); });
async function client(account: string, backend = "A", token?: string, source = hub) {
  const socket = new WebSocket(source.wsUrl, { headers: { Authorization: `Bearer ${token ?? await source.token(account, backend)}` } }); sockets.push(socket);
  const pending = new Map<string, { resolve(value: any): void; reject(error: Error): void }>();
  socket.on("message", (data) => {
    const frame = JSON.parse(data.toString()) as BridgeRpcResponse;
    if (!("requestId" in frame)) return;
    const entry = pending.get(frame.requestId); if (!entry) return; pending.delete(frame.requestId);
    if ("error" in frame) entry.reject(new Error(frame.error.message)); else entry.resolve(frame.message);
  });
  socket.on("close", () => { for (const entry of pending.values()) entry.reject(new Error("closed")); pending.clear(); });
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  const send = (message: unknown) => new Promise<any>((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) { reject(new Error("closed")); return; }
    const requestId = randomUUID(); pending.set(requestId, { resolve, reject }); socket.send(JSON.stringify({ requestId, message }));
  });
  return Object.assign((records: BridgeEnvelope[]) => send({ type: "push", stream: "account", records }), { compact: () => send({ type: "compact" }) });
}
function record(account: string, op: "upsert" | "delete" = "upsert"): BridgeEnvelope {
  const base = { v: 1 as const, stream: "account" as const, rowKey: randomBytes(16).toString("base64url"), hlc: { physicalMs: Date.now(), counter: 0 }, origin: "A" };
  return signFixture({ header: op === "delete" ? { ...base, op } : { ...base, op, registerKey: randomBytes(16).toString("base64url") },
    body: { nonce: randomBytes(24).toString("base64url"), payload: randomBytes(64).toString("base64url") } }, account);
}
async function publicationState(account: string) {
  return hub.quotaSql(account, "SELECT (SELECT count(*) FROM log) log,(SELECT count(*) FROM latest) latest,(SELECT count(*) FROM deleted) deleted,(SELECT count(*) FROM runs) runs,(SELECT count(*) FROM row_owners) owners,(SELECT count(*) FROM publications) publications");
}

describe("Bridge publication signature admission", () => {
  it("binds real D1 backend credentials to their registered signing key, independently of the bearer token", async () => {
    const source = await startLocalBridgeHub({ auth: true });
    try {
      const browser = await source.login(`${randomUUID()}@example.test`), account = browser.user.id, token = `b7_${randomBytes(32).toString("hex")}`;
      await (await source.database()).prepare(`INSERT INTO bridge_backends(account_id,backend_id,public_key,signing_public_key,label,platform,status,token_hash,token_expires_at,created_at)
        VALUES(?,'A',?,?,'Device','test','approved',?,?,?)`).bind(account, randomBytes(32).toString("base64url"), fixturePublicKey(account, "A"),
        createHash("sha256").update(token).digest("hex"), Date.now() + 3_600_000, Date.now()).run();
      await source.admit(account, "A");
      const push = await client(account, "A", token, source), valid = record(account, "delete"), forged = record(account, "delete");
      signFixture(forged, account, "B");
      await expect(push([valid, forged])).rejects.toThrow(/signature/);
      expect(await source.quotaSql(account, "SELECT count(*) n FROM deleted")).toEqual([{ n: 0 }]);
      expect(await push([valid])).toMatchObject({ results: [{ seq: 1, publicationId: valid.auth!.publicationId }] });
    } finally { for (const socket of sockets.splice(0)) socket.terminate(); await source.dispose(); }
  });
  it.each(["accountId", "epoch", "membership", "publicationId", "signingPublicKey", "signature", "origin", "owner", "rowKey", "registerKey", "runId", "clock", "nonce", "payload", "unsigned"])("refuses altered %s and its entire batch before permanent mutation", async (field) => {
    const account = randomUUID(), push = await client(account), good = record(account), bad = record(account);
    const h = bad.header as any, auth = bad.auth as any;
    if (field === "unsigned") delete bad.auth;
    else if (field === "membership") auth.membership = { ...auth.membership, hash: randomBytes(32).toString("base64url") };
    else if (field in auth) auth[field] = field === "epoch" ? 2 : field === "accountId" ? randomUUID() : field === "signingPublicKey" ? fixturePublicKey(account, "B") : randomBytes(field === "signature" ? 64 : 32).toString("base64url");
    else if (field === "clock") h.hlc.physicalMs += 500_000;
    else if (field === "nonce" || field === "payload") bad.body[field] = randomBytes(field === "nonce" ? 24 : 64).toString("base64url");
    else h[field] = field === "owner" || field === "origin" ? "B" : field === "runId" ? "run" : randomBytes(16).toString("base64url");
    await expect(push([good, bad])).rejects.toThrow(/signature|closed/);
    expect(await publicationState(account)).toEqual([{ log: 0, latest: 0, deleted: 0, runs: 0, owners: 0, publications: 0 }]);
  });
  it("a stolen token cannot turn a captured upsert into a tombstone or repeatedly move its clock", async () => {
    const account = randomUUID(), push = await client(account), first = record(account);
    expect(await push([first])).toMatchObject({ results: [{ seq: 1, publicationId: first.auth!.publicationId }] });
    const deleted = structuredClone(first) as any; deleted.header.op = "delete"; delete deleted.header.registerKey;
    await expect(push([deleted])).rejects.toThrow(/signature/);
    for (let i = 0; i < 3; i++) {
      const future = structuredClone(first); future.header.hlc.physicalMs = Date.now() + 500_000;
      await expect(push([future])).rejects.toThrow(/signature/);
    }
    expect(await publicationState(account)).toEqual([{ log: 1, latest: 1, deleted: 0, runs: 0, owners: 0, publications: 1 }]);
  });
  it("rejects another device's key even with a valid signature and the victim's bearer credential", async () => {
    const account = randomUUID(), push = await client(account), forged = record(account, "delete");
    signFixture(forged, account, "B");
    await expect(push([forged])).rejects.toThrow(/signature/);
    expect(await publicationState(account)).toEqual([{ log: 0, latest: 0, deleted: 0, runs: 0, owners: 0, publications: 0 }]);
  });
  it("refuses validly signed records bound to a head outside this account's log or before their writer was admitted", async () => {
    const account = randomUUID(); await hub.admit(account, "A");
    const push = await client(account, "B"), head = await hub.admit(account, "C");
    const [genesis] = await hub.quotaSql(account, "SELECT hash FROM membership WHERE seq=0") as { hash: string }[];
    const bound = (membership: { seq: number; hash: string }) => {
      const value = record(account); value.header.origin = "B"; delete value.auth;
      return signFixture(value, account, "B", membership);
    };
    for (const membership of [{ seq: head.seq + 1, hash: head.hash }, { seq: head.seq, hash: randomBytes(32).toString("base64url") }, { seq: 0, hash: genesis.hash }])
      await expect(push([bound(membership)])).rejects.toThrow(/membership/);
    expect(await publicationState(account)).toEqual([{ log: 0, latest: 0, deleted: 0, runs: 0, owners: 0, publications: 0 }]);
    expect(await push([bound(head)])).toMatchObject({ results: [{ seq: 1 }] });
  });
  it("lets a development token append only signed, authorized entries for its own account, on the current head", async () => {
    const account = randomUUID(), head = await hub.admit(account, "A"), token = await hub.token(account, "A");
    const post = (entry: unknown) => fetch(new URL("/v1/membership", hub.url), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ entry }) });
    const add = (backendId: string, signer = "A") => fixtureMembershipEntry(account, head, "add", { member: fixtureMember(account, backendId), via: "approval" }, signer);
    expect((await post(add("X", "X"))).status).toBe(403);
    expect((await post(fixtureGenesis(randomUUID(), "A", randomBytes(32)))).status).toBe(400);
    const accepted = add("Y");
    expect((await post(accepted)).status).toBe(200);
    expect(await (await post(accepted)).json()).toMatchObject({ status: "present" });
    expect((await post(add("Z"))).status).toBe(409);
  });
  it("removes a writer only with a fence of exactly its account records, then refuses its publications", async () => {
    const account = randomUUID(); await hub.admit(account, "A");
    const b = await client(account, "B"), head = await hub.admit(account, "C"), token = await hub.token(account, "A");
    const written = [record(account), record(account, "delete")].map((value) => { value.header.origin = "B"; delete value.auth; return signFixture(value, account, "B"); });
    await b(written);
    const remove = (fence: ReturnType<typeof fixtureFence>) => fixtureMembershipEntry(account, head, "remove", { backendId: "B", account: fence.account }, "A");
    const post = (entry: unknown) => fetch(new URL("/v1/membership", hub.url), { method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ entry }) });
    // The hub derives the list from what B stored: a fence that omits a record must be read again.
    const partial = fixtureFence([written[0].auth!.signature], 2), complete = fixtureFence(written.map((value) => value.auth!.signature), 2);
    expect((await post(remove(partial))).status).toBe(409);
    expect((await post(remove(complete))).status).toBe(200);
    const served = await fetch(new URL(`/v1/membership/fence?seq=${head.seq + 1}&after=-1`, hub.url), { headers: { Authorization: `Bearer ${token}` } });
    expect(await served.json()).toEqual({ signatures: complete.signatures });
    // B still holds a credential (development tokens have no revocation), but the removal disconnects it and
    // the hub admits no new session for its key, so it cannot publish whatever head it binds.
    const late = record(account); late.header.origin = "B"; delete late.auth;
    await expect(b([signFixture(late, account, "B", head)])).rejects.toThrow(/closed/);
    await expect(client(account, "B")).rejects.toThrow(/401/);
    expect(await publicationState(account)).toEqual([{ log: 2, latest: 1, deleted: 1, runs: 0, owners: 0, publications: 2 }]);
  });
  it("drops receipts below the replay horizon, freeing their quota, and refuses replays bound there", async () => {
    const account = randomUUID(), push = await client(account), root = record(account);
    root.header.owner = "A"; root.header.runId = "r"; signFixture(root, account);
    await push([root]);
    // Membership moves on (a heartbeat or a member change) and the head the capture bound ages past the horizon.
    const head = await hub.admit(account, "B");
    const usage = async () => (await hub.quotaSql(account, "SELECT bytes FROM record_usage") as { bytes: number }[])[0].bytes, before = await usage();
    await hub.quotaSql(account, `UPDATE membership SET appended_at=appended_at-${BRIDGE_REPLAY_HORIZON_MS + 60_000}`);
    await push.compact();
    expect(await hub.quotaSql(account, "SELECT count(*) n FROM publications")).toEqual([{ n: 0 }]);
    expect(before - await usage()).toBe(256);
    // Without its receipt, an expired capture could otherwise come back as new.
    await hub.quotaSql(account, "UPDATE stream_activity SET last_activity=1; DELETE FROM latest; DELETE FROM log");
    expect(await push([root])).toEqual({ type: "ack", stream: "account", results: [{ error: "membershipStale", head }] });
    expect(await publicationState(account)).toEqual([{ log: 0, latest: 0, deleted: 0, runs: 1, owners: 1, publications: 0 }]);
    // Signed again on the current head, the same write is accepted.
    const again = record(account); again.header.owner = "A"; again.header.runId = "r"; again.header.rowKey = root.header.rowKey; again.header.registerKey = root.header.registerKey;
    expect(await push([signFixture(again, account, "A", head)])).toMatchObject({ results: [{ seq: 2 }] });
  });
  it("replays after compaction/expiry and restart neither resurrect ciphertext nor refresh run activity", async () => {
    const account = randomUUID(), push = await client(account), root = record(account);
    root.header.owner = "A"; root.header.runId = "r"; signFixture(root, account);
    await push([root]);
    await hub.quotaSql(account, "UPDATE stream_activity SET last_activity=1; DELETE FROM latest; DELETE FROM log");
    await hub.evict(account);
    const ack = await (await client(account))([root]);
    expect(ack).toMatchObject({ results: [{ seq: 1, publicationId: root.auth!.publicationId }] });
    expect(await hub.quotaSql(account, "SELECT last_activity FROM stream_activity")).toEqual([{ last_activity: 1 }]);
    expect(await publicationState(account)).toEqual([{ log: 0, latest: 0, deleted: 0, runs: 1, owners: 1, publications: 1 }]);
  });
});
