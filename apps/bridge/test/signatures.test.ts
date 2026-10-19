import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { BridgeEnvelope, BridgeRpcResponse } from "@mains/contracts/bridge-protocol";
import { startLocalBridgeHub } from "./local-hub.mjs";
import { fixturePublicKey, signFixture } from "./record-signing.mjs";

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
  return (records: BridgeEnvelope[]) => new Promise<any>((resolve, reject) => {
    const requestId = randomUUID(); pending.set(requestId, { resolve, reject }); socket.send(JSON.stringify({ requestId, message: { type: "push", stream: "account", records } }));
  });
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
      const push = await client(account, "A", token, source), valid = record(account, "delete"), forged = record(account, "delete");
      signFixture(forged, account, "B");
      await expect(push([valid, forged])).rejects.toThrow(/signature/);
      expect(await source.quotaSql(account, "SELECT count(*) n FROM deleted")).toEqual([{ n: 0 }]);
      expect(await push([valid])).toMatchObject({ results: [{ seq: 1, publicationId: valid.auth!.publicationId }] });
    } finally { for (const socket of sockets.splice(0)) socket.terminate(); await source.dispose(); }
  });
  it.each(["accountId", "epoch", "publicationId", "signingPublicKey", "signature", "origin", "owner", "rowKey", "registerKey", "runId", "clock", "nonce", "payload", "unsigned"])("refuses altered %s and its entire batch before permanent mutation", async (field) => {
    const account = randomUUID(), push = await client(account), good = record(account), bad = record(account);
    const h = bad.header as any, auth = bad.auth as any;
    if (field === "unsigned") delete bad.auth;
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
