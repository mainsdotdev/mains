import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID, createHash, createPrivateKey, sign } from "node:crypto";
import { mkdtemp, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { bridgeApprovalCode, bridgeBase64, type BridgeAccountKeys, type BridgeApprovalRequest, type BridgeSealedAccountKey } from "@mains/contracts/bridge-auth";
import type { BridgeBlobPresignResult } from "@mains/contracts/bridge-blobs";
import { parseBridgeServerFrame } from "@mains/contracts/bridge-wire";
import type { BridgeEnvelope, BridgeServerMessage } from "@mains/contracts/bridge-protocol";
import { bridgeSigningMessage } from "@mains/contracts/bridge-signing";
import { bridgeFenceRoot, bridgeMembershipEntryHash, currentBridgeMembers, verifyBridgeMembershipLog, type BridgeMember, type BridgeMembershipChange, type BridgeMembershipEntry } from "@mains/contracts/bridge-membership";
import { bridgeAccountKeyCommitment, generateBridgeDeviceKeyPair, generateBridgeSigningKeyPair, openBridgeAccountKey, sealBridgeAccountKey } from "../../../packages/backend/src/modules/bridge/bridge.keys";
import { deviceSigner, signBridgeMembershipEntry, verifyBridgeSignature } from "../../../packages/backend/src/modules/bridge/bridge.membership";
import { startBridgeLoopback } from "../../../packages/backend/src/modules/bridge/bridge.login";
import { createBridgeIdentity } from "../../../packages/backend/src/modules/bridge/bridge.identity";
import { createNodeBackendRuntime } from "../../../packages/backend/src/runtime/node-backend-runtime";
import { startLocalBridgeHub } from "./local-hub.mjs";

let hub: Awaited<ReturnType<typeof startLocalBridgeHub>>;
beforeAll(async () => { hub = await startLocalBridgeHub({ auth: true, subscriptionInterval: "monthly" }); }, 30_000);
afterAll(async () => { await hub?.dispose(); });
const login = () => hub.login(`${randomUUID()}@example.com`);
async function rpc(path: string, token: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
  return fetch(new URL(path, hub.url), { method, headers: { Authorization: `Bearer ${token}`, Origin: new URL(hub.url).origin, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
async function renew(token: string, successor = `b7_${randomBytes(32).toString("hex")}`) {
  const response = await rpc("/v1/backends/refresh", token, { nextTokenHash: tokenHash(successor) });
  expect(response.status).toBe(200);
  const receipt = await response.json() as { expiresAt: number };
  expect(Object.keys(receipt)).toEqual(["nextTokenHash", "expiresAt"]);
  return { token: successor, ...receipt };
}
async function register(browser: Awaited<ReturnType<typeof login>>, backendId = randomUUID()) {
  const pair = generateBridgeDeviceKeyPair(), signing = generateBridgeSigningKeyPair(), publicKey = bridgeBase64(pair.publicKey), signingPublicKey = bridgeBase64(signing.publicKey);
  const response = await fetch(new URL("/v1/backends", hub.url), { method: "POST", headers: { Cookie: browser.cookie, Origin: new URL(hub.url).origin, "Content-Type": "application/json" }, body: JSON.stringify({ backendId, publicKey, signingPublicKey, label: backendId, platform: "test" }) });
  expect(response.status).toBe(201);
  const member: BridgeMember = { backendId, publicKey, signingPublicKey };
  return { ...await response.json() as { accountId: string; token: string }, backendId, pair, publicKey, signingPublicKey, signingSecret: signing.secretKey, member, browser };
}
type Backend = Awaited<ReturnType<typeof register>>;
const recoveryWrap = (): BridgeAccountKeys["recovery"] => ({ v: 1, kdf: { name: "argon2id", memoryKiB: 65536, iterations: 3, parallelism: 1, salt: randomBytes(16).toString("base64url") }, nonce: randomBytes(24).toString("base64url"), payload: randomBytes(48).toString("base64url") });
async function membership(token: string) {
  const response = await rpc("/v1/membership", token); expect(response.status).toBe(200);
  return verifyBridgeMembershipLog((await response.json() as { entries: unknown[] }).entries, verifyBridgeSignature);
}
/** The next entry on the hub's current head, signed by `by`. */
async function entryBy(by: Backend, change: BridgeMembershipChange, token = by.token): Promise<BridgeMembershipEntry> {
  return signBridgeMembershipEntry(await membership(token), change, deviceSigner(by.member), by.signingSecret);
}
function bootstrapBody(backend: Backend, key = randomBytes(32)) {
  const recovery = generateBridgeSigningKeyPair();
  const entry = signBridgeMembershipEntry({ accountId: backend.accountId, seq: -1, head: null }, { kind: "genesis", body: { member: backend.member,
    recoverySigningPublicKey: bridgeBase64(recovery.publicKey), accountKeyCommitment: bridgeAccountKeyCommitment(key) } }, deviceSigner(backend.member), backend.signingSecret);
  return { key, recovery, body: { wrap: sealBridgeAccountKey(key, backend.pair.publicKey), recovery: recoveryWrap(), entry } };
}
async function owner() {
  const a = await register(await login()), material = bootstrapBody(a);
  expect((await rpc("/v1/keys/bootstrap", a.token, material.body)).status).toBe(200);
  return { ...a, key: material.key, recovery: material.recovery };
}
async function requestApproval(b: Backend) {
  const response = await rpc("/v1/approvals", b.token, {}); expect(response.status).toBe(201);
  return await response.json() as BridgeApprovalRequest;
}
async function approval(a: Backend & { key: Uint8Array }, b: Backend) {
  const request = await requestApproval(b);
  const body = { ...request, wrap: sealBridgeAccountKey(a.key, b.pair.publicKey), entry: await entryBy(a, { kind: "add", body: { member: b.member, via: "approval" } }) };
  expect((await rpc("/v1/keys/wraps", a.token, body)).status).toBe(200); return body;
}
/** A removal of a writer with no account records here: its fence admits nothing. */
const emptyFence = async () => ({ through: 0, count: 0, root: await bridgeFenceRoot([]) });
async function revoke(by: Backend, target: Backend) {
  return rpc(`/v1/backends/${target.backendId}`, by.token, { entry: await entryBy(by, { kind: "remove", body: { backendId: target.backendId, account: await emptyFence() } }) }, "DELETE");
}
async function socketRpc(socket: WebSocket, message: unknown): Promise<any> {
  const requestId = randomUUID();
  const reply = new Promise<any>((resolve, reject) => {
    const receive = (data: WebSocket.RawData) => {
      const frame = parseBridgeServerFrame(data.toString());
      // Approval notifications also have a requestId; only RPC responses settle this call.
      if ("type" in frame || frame.requestId !== requestId) return;
      socket.off("message", receive);
      if ("error" in frame) reject(new Error(frame.error.message)); else resolve(frame.message);
    };
    socket.on("message", receive);
  });
  socket.send(JSON.stringify({ requestId, message })); return reply;
}
/** A real device publishes `count` account records signed on its current head; returns their signatures. */
async function publish(by: Backend, count: number) {
  const state = await membership(by.token), socket = await socketFor(by.token), signatures: string[] = [];
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(by.signingSecret)]), type: "pkcs8", format: "der" });
  try {
    for (let start = 0; start < count; start += 100) {
      const records = Array.from({ length: Math.min(100, count - start) }, (_, index): BridgeEnvelope => {
        const envelope: BridgeEnvelope = { header: { v: 1, stream: "account", rowKey: randomBytes(16).toString("base64url"), registerKey: randomBytes(16).toString("base64url"), origin: by.backendId,
          op: "upsert", hlc: { physicalMs: Date.now(), counter: start + index } }, body: { nonce: randomBytes(24).toString("base64url"), payload: randomBytes(32).toString("base64url") } };
        const auth = { v: 2 as const, accountId: by.accountId, epoch: 1 as const, membership: { seq: state.seq, hash: state.head },
          publicationId: randomBytes(32).toString("base64url"), signingPublicKey: by.signingPublicKey };
        const signature = sign(null, bridgeSigningMessage(envelope, auth), key).toString("base64url"); signatures.push(signature);
        return { ...envelope, auth: { ...auth, signature } };
      });
      const ack = await socketRpc(socket, { type: "push", stream: "account", records });
      expect(ack.results.every((result: { seq?: number }) => typeof result.seq === "number")).toBe(true);
    }
  } finally { socket.close(); }
  return signatures.sort();
}
async function socketFor(token: string) {
  const socket = new WebSocket(hub.wsUrl, { headers: { Authorization: `Bearer ${token}` } });
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); }); return socket;
}
async function pullSocket(socket: WebSocket) {
  const requestId = randomUUID();
  const reply = new Promise<void>((resolve, reject) => {
    const closed = () => { socket.off("message", receive); reject(new Error("Socket closed before pull response")); };
    const receive = (data: WebSocket.RawData) => {
      const frame = parseBridgeServerFrame(data.toString());
      if ("requestId" in frame && frame.requestId === requestId) {
        socket.off("message", receive); socket.off("close", closed);
        if ("error" in frame) reject(new Error(frame.error.message)); else resolve();
      }
    };
    socket.on("message", receive); socket.once("close", closed);
  });
  socket.send(JSON.stringify({ requestId, message: { type: "pull", stream: "account", after: 0, limit: 10 } }));
  await reply;
}

describe("Verified sign-in and backend key ceremonies", () => {
  it("keeps each admitted key's interval in the membership log through revocation and re-enrollment, and refuses reused keys", async () => {
    const a = await owner(), b = await register(a.browser); await approval(a, b);
    expect((await revoke(a, b)).status).toBe(200);
    const replacement = await register(a.browser, b.backendId); await approval(a, replacement);
    expect((await membership(a.token)).keys.filter((key) => key.backendId === b.backendId).map(({ signingPublicKey, until }) => ({ signingPublicKey, removed: until !== null })))
      .toEqual([{ signingPublicKey: b.signingPublicKey, removed: true }, { signingPublicKey: replacement.signingPublicKey, removed: false }]);
    // The log never admits a key twice, so registration refuses one it has already seen, for any backend.
    for (const keys of [{ publicKey: bridgeBase64(generateBridgeDeviceKeyPair().publicKey), signingPublicKey: b.signingPublicKey },
      { publicKey: b.publicKey, signingPublicKey: bridgeBase64(generateBridgeSigningKeyPair().publicKey) }]) {
      const reused = await fetch(new URL("/v1/backends", hub.url), { method: "POST", headers: { Cookie: a.browser.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ backendId: randomUUID(), ...keys, label: "Other", platform: "test" }) });
      expect(reused.status).toBe(409);
    }
  });
  it("replaces keys a lapsed backend left in the log without revoking its newer pending registration", async () => {
    const a = await owner(), b = await register(a.browser); await approval(a, b);
    // B's credential lapsed before it could sign its own removal; it signs in again with new keys.
    await (await hub.database()).prepare("UPDATE bridge_backends SET token_expires_at=0 WHERE backend_id=?").bind(b.backendId).run();
    const next = await register(a.browser, b.backendId), request = await requestApproval(next);
    expect((await rpc("/v1/keys/wraps", a.token, { ...request, wrap: sealBridgeAccountKey(a.key, next.pair.publicKey),
      entry: await entryBy(a, { kind: "add", body: { member: next.member, via: "approval" } }) })).status).toBe(403);
    // The old keys leave the log on their own; no registration holds them any more.
    expect((await rpc("/v1/membership", a.token, { entry: await entryBy(a, { kind: "remove", body: { backendId: b.backendId, account: await emptyFence() } }) })).status).toBe(200);
    expect(await (await rpc("/v1/keys/mine", next.token)).json()).toMatchObject({ backend: { status: "pending" }, approval: { status: "pending" } });
    await approval(a, next);
    expect(currentBridgeMembers(await membership(a.token)).find((member) => member.backendId === b.backendId)?.signingPublicKey).toBe(next.signingPublicKey);
  });
  it("lets only an approved member append a replay-horizon checkpoint through the membership route", async () => {
    const a = await owner(), b = await register(a.browser), post = (token: string, entry: unknown) => rpc("/v1/membership", token, { entry });
    expect((await post(b.token, await entryBy(a, { kind: "checkpoint", body: { horizon: true } }, b.token))).status).toBe(403);
    expect((await post(a.token, await entryBy(a, { kind: "add", body: { member: b.member, via: "approval" } }))).status).toBe(400);
    expect((await post(a.token, signBridgeMembershipEntry(await membership(a.token), { kind: "checkpoint", body: { horizon: true } },
      { kind: "recovery", signingPublicKey: bridgeBase64(a.recovery.publicKey) }, a.recovery.secretKey))).status).toBe(400);
    expect((await post(a.token, await entryBy(a, { kind: "checkpoint", body: { horizon: true } }))).status).toBe(200);
    expect((await membership(a.token)).seq).toBe(1);
  });
  it("removes a backend with hundreds of account records, its removal carrying only the fence's commitment", async () => {
    const a = await owner(), b = await register(a.browser); await approval(a, b);
    const signatures = await publish(b, 450), account = { through: 450, count: 450, root: await bridgeFenceRoot(signatures) };
    const remove = async (fence: typeof account) => rpc(`/v1/backends/${b.backendId}`, a.token, { entry: await entryBy(a, { kind: "remove", body: { backendId: b.backendId, account: fence } }) }, "DELETE");
    // A fence that misses one of B's records is read again; the hub derives the list from what it stores.
    expect((await remove({ through: 450, count: 449, root: await bridgeFenceRoot(signatures.slice(1)) })).status).toBe(409);
    expect((await remove(account)).status).toBe(200);
    const removal = (await membership(a.token)).seq;
    expect(await (await rpc(`/v1/membership/fence?seq=${removal}&after=-1`, a.token)).json()).toEqual({ signatures });
    expect((await rpc("/v1/keys/mine", b.token)).status).toBe(401);
  });
  it("revokes a re-enrolled backend's pending registration apart from the old keys still in the log", async () => {
    const a = await owner(), b = await register(a.browser), c = await register(a.browser); await approval(a, b); await approval(a, c);
    const lapse = async () => (await hub.database()).prepare("UPDATE bridge_backends SET token_expires_at=0 WHERE backend_id=?").bind(b.backendId).run();
    await lapse();
    const next = await register(a.browser, b.backendId); await requestApproval(next);
    const stillAdmitted = async () => currentBridgeMembers(await membership(a.token)).some((member) => member.signingPublicKey === b.signingPublicKey);
    // The pending registration cancels itself without a removal it could never sign, and an approver can
    // revoke one the same way; neither touches the old keys.
    expect((await rpc(`/v1/backends/${b.backendId}`, next.token, undefined, "DELETE")).status).toBe(200);
    expect((await rpc("/v1/keys/mine", next.token)).status).toBe(401);
    const again = await register(a.browser, b.backendId);
    expect((await rpc(`/v1/backends/${b.backendId}`, a.token, undefined, "DELETE")).status).toBe(200);
    expect((await rpc("/v1/keys/mine", again.token)).status).toBe(401);
    expect(await stillAdmitted()).toBe(true);
    // A member whose registration still holds its keys leaves only with its credential, through DELETE.
    expect((await rpc("/v1/membership", a.token, { entry: await entryBy(a, { kind: "remove", body: { backendId: c.backendId, account: await emptyFence() } }) })).status).toBe(409);
    expect((await rpc(`/v1/backends/${c.backendId}`, a.token, undefined, "DELETE")).status).toBe(400);
  });
  it("requires both public keys at registration and retains the exact signing identity", async () => {
    const browser = await login(), backendId = randomUUID(), publicKey = bridgeBase64(generateBridgeDeviceKeyPair().publicKey);
    for (const signingPublicKey of [undefined, "invalid", randomBytes(31).toString("base64url")]) {
      const response = await fetch(new URL("/v1/backends", hub.url), { method: "POST", headers: { Cookie: browser.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ backendId, publicKey, signingPublicKey, label: "Device", platform: "test" }) });
      expect(response.status).toBe(400);
    }
    const b = await register(browser, backendId);
    expect(await (await rpc("/v1/keys/mine", b.token)).json()).toMatchObject({ backend: { publicKey: b.publicKey, signingPublicKey: b.signingPublicKey } });
    const reused = await fetch(new URL("/v1/backends", hub.url), { method: "POST", headers: { Cookie: browser.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ backendId: randomUUID(), publicKey, signingPublicKey: b.signingPublicKey, label: "Other device", platform: "test" }) });
    expect(reused.status).toBe(400);
  });
  it("keeps account login separate from approval; pending tokens cannot use the log, blobs or approve peers", async () => {
    const browser = await login(), b = await register(browser);
    expect((await rpc("/v1/log", b.token)).status).toBe(401);
    expect((await rpc("/v1/blobs/presign", b.token, {})).status).toBe(401);
    expect((await rpc("/v1/backends", b.token)).status).toBe(403);
    expect((await rpc("/v1/keys/wraps", b.token, {})).status).toBe(403);
    expect((await rpc("/v1/keys/mine", b.token)).status).toBe(200);
    const db = await hub.database();
    await db.prepare('UPDATE user SET emailVerified=0 WHERE id=?').bind(b.accountId).run();
    const response = await fetch(new URL("/v1/backends", hub.url), { method: "POST", headers: { Cookie: browser.cookie }, body: "{}" });
    expect(response.status).toBe(401);
    const row = await db.prepare("SELECT token_hash FROM bridge_backends WHERE account_id=?").bind(b.accountId).first();
    expect(row!.token_hash).toBe(createHash("sha256").update(b.token).digest("hex"));
  });
  it("initializes exactly once under concurrent first logins and cannot bootstrap again by reusing the initializer id", async () => {
    const browser = await login(), a = await register(browser), b = await register(browser), ka = bootstrapBody(a), kb = bootstrapBody(b);
    const results = await Promise.all([rpc("/v1/keys/bootstrap", a.token, ka.body), rpc("/v1/keys/bootstrap", b.token, kb.body)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = results[0].status === 200 ? a : b;
    expect((await revoke(winner, winner)).status).toBe(200);
    const replacement = await register(browser, winner.backendId);
    expect((await rpc("/v1/keys/bootstrap", replacement.token, bootstrapBody(replacement).body)).status).toBe(409);
    expect((await rpc("/v1/log", replacement.token)).status).toBe(401);
  });
  it("binds approval to account, request, recipient public key and a matching code, and rejects replay", async () => {
    const a = await owner(), b = await register(a.browser), c = await register(a.browser), outsider = await owner(), request = await requestApproval(b);
    const body = { ...request, wrap: sealBridgeAccountKey(a.key, b.pair.publicKey), entry: await entryBy(a, { kind: "add", body: { member: b.member, via: "approval" } }) };
    expect(request.code).toBe(await bridgeApprovalCode(b));
    // The wrap goes only to a member: the addition must be signed by the approving requester, for exactly B.
    expect((await rpc("/v1/keys/wraps", a.token, { ...body, entry: undefined })).status).toBe(409);
    expect((await rpc("/v1/keys/wraps", a.token, { ...body, entry: await entryBy(b, { kind: "add", body: { member: b.member, via: "approval" } }, a.token) })).status).toBe(400);
    expect((await rpc("/v1/keys/wraps", a.token, { ...body, entry: await entryBy(a, { kind: "add", body: { member: c.member, via: "approval" } }) })).status).toBe(400);
    expect((await rpc("/v1/keys/wraps", a.token, { ...body, entry: { ...body.entry, signature: randomBytes(64).toString("base64url") } })).status).toBe(403);
    expect(request.code.replaceAll("-", "")).toHaveLength(12);
    expect((await rpc("/v1/keys/wraps", a.token, { ...body, code: "ABC234" })).status).toBe(400);
    expect((await rpc("/v1/keys/wraps", a.token, { ...body, code: "WRONG1" })).status).toBe(400);
    expect((await rpc("/v1/keys/wraps", a.token, { ...body, requestId: randomUUID() })).status).toBe(409);
    expect((await rpc("/v1/keys/wraps", outsider.token, body)).status).toBe(400);
    expect((await rpc("/v1/keys/wraps", outsider.token, { ...body,
      code: await bridgeApprovalCode({ ...b, accountId: outsider.accountId }) })).status).toBe(409);
    const wrongPublicKey = bridgeBase64(generateBridgeDeviceKeyPair().publicKey);
    expect((await rpc("/v1/keys/wraps", a.token, { ...body, publicKey: wrongPublicKey, code: await bridgeApprovalCode({ ...b, publicKey: wrongPublicKey }) })).status).toBe(409);
    const wrongSigningPublicKey = bridgeBase64(generateBridgeSigningKeyPair().publicKey);
    expect((await rpc("/v1/keys/wraps", a.token, { ...body, signingPublicKey: wrongSigningPublicKey })).status).toBe(400);
    expect((await rpc("/v1/keys/wraps", a.token, { ...body, signingPublicKey: wrongSigningPublicKey,
      code: await bridgeApprovalCode({ ...b, signingPublicKey: wrongSigningPublicKey }) })).status).toBe(409);
    expect((await rpc("/v1/keys/wraps", a.token, body)).status).toBe(200);
    const mine = await (await rpc("/v1/keys/mine", b.token)).json() as { wrap: BridgeSealedAccountKey };
    expect(openBridgeAccountKey(mine.wrap, b.pair.secretKey)).toEqual(Uint8Array.from(a.key));
    expect((await rpc("/v1/keys/wraps", a.token, body)).status).toBe(409);
    expect((await rpc("/v1/backends", outsider.token)).status).toBe(200);
    expect((await rpc(`/v1/backends/${b.backendId}`, outsider.token, undefined, "DELETE")).status).toBe(404);
  });
  it("expires and rejects approval requests, but allows a pending backend to cancel and re-enroll", async () => {
    const a = await owner(), b = await register(a.browser), request = await requestApproval(b), db = await hub.database();
    await db.prepare("UPDATE bridge_approvals SET expires_at=0 WHERE request_id=?").bind(request.requestId).run();
    expect((await rpc("/v1/keys/wraps", a.token, { ...request, wrap: sealBridgeAccountKey(a.key, b.pair.publicKey) })).status).toBe(409);
    const renewed = await requestApproval(b); expect(renewed.requestId).not.toBe(request.requestId);
    expect((await rpc(`/v1/approvals/${renewed.requestId}`, a.token, undefined, "DELETE")).status).toBe(200);
    expect((await rpc("/v1/keys/wraps", a.token, { ...renewed, wrap: sealBridgeAccountKey(a.key, b.pair.publicKey) })).status).toBe(409);
    expect((await rpc(`/v1/backends/${b.backendId}`, b.token, undefined, "DELETE")).status).toBe(200);
    const next = await register(a.browser, b.backendId); expect(next.token).not.toBe(b.token);
    expect((await rpc("/v1/keys/mine", b.token)).status).toBe(401);
  });
  it("admits a recovering backend only through an addition of exactly its registration, signed by the recovery authority on the current head", async () => {
    const a = await owner(), b = await register(a.browser), c = await register(a.browser), d = await register(a.browser);
    const wrap = sealBridgeAccountKey(a.key, b.pair.publicKey), authority = { kind: "recovery" as const, signingPublicKey: bridgeBase64(a.recovery.publicKey) };
    const recoveryEntry = async (member: BridgeMember, secret = a.recovery.secretKey, signer: BridgeMembershipEntry["signer"] = authority) =>
      signBridgeMembershipEntry(await membership(b.token), { kind: "add", body: { member, via: "recovery" } }, signer, secret);
    const entry = await recoveryEntry(b.member);
    expect((await rpc("/v1/keys/recovery/unlock", c.token, { wrap, entry })).status).toBe(400);
    expect((await rpc("/v1/keys/recovery/unlock", b.token, { wrap, entry: await recoveryEntry(c.member) })).status).toBe(400);
    const impostor = generateBridgeSigningKeyPair();
    expect((await rpc("/v1/keys/recovery/unlock", b.token, { wrap, entry: await recoveryEntry(b.member, impostor.secretKey, { kind: "recovery", signingPublicKey: bridgeBase64(impostor.publicKey) }) })).status).toBe(403);
    expect((await rpc("/v1/keys/recovery/unlock", b.token, { wrap, entry: { ...entry, signature: randomBytes(64).toString("base64url") } })).status).toBe(403);
    // A member's device key cannot stand in for the recovery authority.
    expect((await rpc("/v1/keys/recovery/unlock", b.token, { wrap, entry: await entryBy(a, { kind: "add", body: { member: b.member, via: "recovery" } }, b.token) })).status).toBe(400);
    // Signed on a head that has since moved: the proof cannot be replayed into another history.
    await approval(a, d);
    expect((await rpc("/v1/keys/recovery/unlock", b.token, { wrap, entry })).status).toBe(409);
    const fresh = await recoveryEntry(b.member);
    expect((await rpc("/v1/keys/recovery/unlock", b.token, { wrap, entry: fresh })).status).toBe(200);
    expect((await rpc("/v1/keys/recovery/unlock", b.token, { wrap, entry: fresh })).status).toBe(409);
    expect((await rpc("/v1/log", b.token)).status).toBe(426);
    expect(currentBridgeMembers(await membership(a.token)).map((member) => member.backendId)).toEqual([a.backendId, d.backendId, b.backendId]);
  });
  it("lets a recovering backend finish without an entry only once the log already admits its exact registration", async () => {
    const a = await owner(), b = await register(a.browser), wrap = sealBridgeAccountKey(a.key, b.pair.publicKey);
    expect((await rpc("/v1/keys/recovery/unlock", b.token, { wrap })).status).toBe(409);
    const entry = signBridgeMembershipEntry(await membership(b.token), { kind: "add", body: { member: b.member, via: "recovery" } },
      { kind: "recovery", signingPublicKey: bridgeBase64(a.recovery.publicKey) }, a.recovery.secretKey);
    // The entry landed but its response was lost before the device wrap was stored.
    await hub.quotaSql(a.accountId, `INSERT INTO membership(seq,hash,entry,appended_at) VALUES(${entry.seq},'${await bridgeMembershipEntryHash(entry)}','${JSON.stringify(entry)}',${Date.now()})`);
    expect((await rpc("/v1/keys/recovery/unlock", b.token, { wrap })).status).toBe(200);
    expect(openBridgeAccountKey((await (await rpc("/v1/keys/mine", b.token)).json() as { wrap: BridgeSealedAccountKey }).wrap, b.pair.secretKey)).toEqual(Uint8Array.from(a.key));
  });
  it("serves the log to pending devices and accepts only a requester's signed, compare-and-swap changes", async () => {
    const a = await owner(), b = await register(a.browser), c = await register(a.browser);
    expect(currentBridgeMembers(await membership(b.token)).map((member) => member.backendId)).toEqual([a.backendId]);
    expect((await rpc("/v1/membership?after=x", b.token)).status).toBe(400);
    expect(await (await rpc("/v1/membership?after=0", b.token)).json()).toMatchObject({ entries: [], appendedAt: expect.any(Number) });
    // Genesis must admit exactly the initializing registration.
    const other = await register(await login()), foreign = bootstrapBody(other);
    expect((await rpc("/v1/keys/bootstrap", other.token, { ...foreign.body, entry: bootstrapBody(b).body.entry })).status).toBe(400);
    // Two approvals signed on the same head: only one can extend it.
    const [rb, rc] = [await requestApproval(b), await requestApproval(c)], head = await membership(a.token);
    const add = (member: BridgeMember) => signBridgeMembershipEntry(head, { kind: "add", body: { member, via: "approval" } }, deviceSigner(a.member), a.signingSecret);
    expect((await rpc("/v1/keys/wraps", a.token, { ...rb, wrap: sealBridgeAccountKey(a.key, b.pair.publicKey), entry: add(b.member) })).status).toBe(200);
    expect((await rpc("/v1/keys/wraps", a.token, { ...rc, wrap: sealBridgeAccountKey(a.key, c.pair.publicKey), entry: add(c.member) })).status).toBe(409);
    // A lost response is retried with the same entry, or without it once it landed.
    const retry = { ...rc, wrap: sealBridgeAccountKey(a.key, c.pair.publicKey), entry: await entryBy(a, { kind: "add", body: { member: c.member, via: "approval" } }) };
    const lost = await rpc("/v1/keys/wraps", a.token, retry); expect(lost.status).toBe(200); await lost.arrayBuffer();
    expect((await rpc("/v1/keys/wraps", a.token, retry)).status).toBe(409);
    // A member leaves only through a removal signed by the requesting member.
    expect((await rpc(`/v1/backends/${b.backendId}`, a.token, undefined, "DELETE")).status).toBe(400);
    expect((await rpc(`/v1/backends/${b.backendId}`, a.token, { entry: await entryBy(c, { kind: "remove", body: { backendId: b.backendId, account: await emptyFence() } }) }, "DELETE")).status).toBe(400);
    expect((await revoke(c, b)).status).toBe(200);
    expect(currentBridgeMembers(await membership(a.token)).map((member) => member.backendId)).toEqual([a.backendId, c.backendId]);
  });
  it("rotates the recovery authority only through a member-signed entry; the previous one admits nothing", async () => {
    const a = await owner(), b = await register(a.browser), next = generateBridgeSigningKeyPair();
    const rotate = await entryBy(a, { kind: "recovery", body: { recoverySigningPublicKey: bridgeBase64(next.publicKey) } });
    expect((await rpc("/v1/keys/recovery", a.token, { recovery: recoveryWrap() }, "PUT")).status).toBe(400);
    expect((await rpc("/v1/keys/recovery", b.token, { recovery: recoveryWrap(), entry: rotate }, "PUT")).status).toBe(403);
    expect((await rpc("/v1/keys/recovery", a.token, { recovery: recoveryWrap(), entry: rotate }, "PUT")).status).toBe(200);
    expect(await (await rpc("/v1/keys/recovery", b.token)).json()).toMatchObject({ recoveryPublicKey: bridgeBase64(next.publicKey) });
    const old = signBridgeMembershipEntry(await membership(b.token), { kind: "add", body: { member: b.member, via: "recovery" } },
      { kind: "recovery", signingPublicKey: bridgeBase64(a.recovery.publicKey) }, a.recovery.secretKey);
    expect((await rpc("/v1/keys/recovery/unlock", b.token, { wrap: sealBridgeAccountKey(a.key, b.pair.publicKey), entry: old })).status).toBe(403);
  });
  it("notifies online approvers and revokes open sockets plus previously issued R2 capabilities", async () => {
    const a = await owner(), b = await register(a.browser), socket = await socketFor(a.token);
    try {
      const event = new Promise<Extract<BridgeServerMessage, { type: "approval" }>>((resolve, reject) => socket.on("message", (data) => {
        try {
          const frame = parseBridgeServerFrame(data.toString());
          if ("type" in frame && frame.type === "approval") resolve(frame);
        } catch (error) { reject(error); }
      }));
      const request = await approval(a, b); expect(await event).toMatchObject({ type: "approval", backendId: b.backendId, code: request.code });
      const bSocket = await socketFor(b.token);
      try {
        await pullSocket(bSocket); // Warm the credential cache before revocation.
        const blob = { blobId: randomBytes(32).toString("base64url"), size: 3 };
        const presign = async (op: string) => (await (await rpc("/v1/blobs/presign", b.token, { op, blobs: [blob] })).json() as BridgeBlobPresignResult).blobs[0].chunks[0].url;
        const put = await presign("put"), bytes = randomBytes(43);
        expect((await fetch(put, { method: "PUT", body: bytes })).status).toBe(204);
        const get = await presign("get"); expect((await fetch(get)).status).toBe(200);
        const closed = new Promise<number>((resolve) => bSocket.once("close", resolve));
        expect((await revoke(a, b)).status).toBe(200);
        expect(await closed).toBe(1008);
        expect((await fetch(get)).status).toBe(403); expect((await fetch(put, { method: "PUT", body: bytes })).status).toBe(403);
        expect((await rpc("/v1/keys/mine", b.token)).status).toBe(401);
      } finally { bSocket.terminate(); }
    } finally { socket.terminate(); }
  });
  it("refuses a removed backend that D1 still approves, then finishes the interrupted revocation itself", async () => {
    const a = await owner(), b = await register(a.browser); await approval(a, b);
    const bSocket = await socketFor(b.token), db = await hub.database(), blob = { blobId: randomBytes(32).toString("base64url"), size: 3 };
    const status = async () => (await db.prepare("SELECT status FROM bridge_backends WHERE account_id=? AND backend_id=?").bind(b.accountId, b.backendId).first<{ status: string }>())!.status;
    await db.prepare(`CREATE TRIGGER interrupted_revocation BEFORE UPDATE OF status ON bridge_backends WHEN NEW.status='revoked'
      BEGIN SELECT RAISE(ABORT, 'injected D1 failure'); END`).run();
    try {
      await pullSocket(bSocket);
      const presign = async (op: string) => (await (await rpc("/v1/blobs/presign", b.token, { op, blobs: [blob] })).json() as BridgeBlobPresignResult).blobs[0].chunks[0].url;
      expect((await fetch(await presign("put"), { method: "PUT", body: randomBytes(43) })).status).toBe(204);
      const download = await presign("get"); expect((await fetch(download)).status).toBe(200);
      const closed = new Promise<number>((resolve) => bSocket.once("close", resolve));
      // The removal lands in the log; the revocation in D1 after it fails.
      expect((await revoke(a, b)).status).toBe(400);
      expect(await status()).toBe("approved");
      expect(await closed).toBe(1008);
      // A download URL issued before the removal ends with it.
      expect((await fetch(download)).status).toBe(403);
      await expect(socketFor(b.token)).rejects.toThrow(/401/);
      expect((await rpc("/v1/blobs/presign", b.token, { op: "get", blobs: [blob] })).status).toBe(401);
      expect((await rpc("/v1/backends/refresh", b.token, { nextTokenHash: tokenHash(`b7_${randomBytes(32).toString("hex")}`) })).status).toBe(401);
      expect((await rpc("/v1/keys/mine", b.token)).status).toBe(401);
    } finally { bSocket.terminate(); await db.prepare("DROP TRIGGER interrupted_revocation").run(); }
    // Nobody retries the request: the hub revokes the registration from its log once D1 is available.
    await vi.waitFor(async () => expect(await status()).toBe("revoked"), { timeout: 15_000, interval: 250 });
    expect(await db.prepare("SELECT 1 FROM bridge_key_wraps WHERE account_id=? AND backend_id=?").bind(b.accountId, b.backendId).first()).toBeNull();
    expect((await rpc("/v1/keys/mine", a.token)).status).toBe(200);
  }, 30_000);
  it("completes an initialization whose genesis landed without its account when the same proposal is sent again", async () => {
    const a = await register(await login()), material = bootstrapBody(a), entry = material.body.entry;
    // The log took the genesis; the D1 writes after it were lost.
    await hub.quotaSql(a.accountId, `INSERT INTO membership(seq,hash,entry,appended_at) VALUES(0,'${await bridgeMembershipEntryHash(entry)}','${JSON.stringify(entry)}',${Date.now()})`);
    expect(await (await rpc("/v1/keys/mine", a.token)).json()).toMatchObject({ initialized: false, backend: { status: "pending" } });
    expect((await rpc("/v1/keys/bootstrap", a.token, bootstrapBody(a).body)).status).toBe(409);
    expect((await rpc("/v1/keys/bootstrap", a.token, material.body)).status).toBe(200);
    const mine = await (await rpc("/v1/keys/mine", a.token)).json() as { initialized: boolean; backend: { status: string }; wrap: BridgeSealedAccountKey };
    expect(mine).toMatchObject({ initialized: true, backend: { status: "approved" } });
    expect(openBridgeAccountKey(mine.wrap, a.pair.secretKey)).toEqual(Uint8Array.from(material.key));
  });
  it("leaves compaction to the hub's own schedule outside local development", async () => {
    const a = await owner(), socket = await socketFor(a.token), requestId = randomUUID();
    try {
      const reply = new Promise<ReturnType<typeof parseBridgeServerFrame>>((resolve) => socket.on("message", (data) => {
        const frame = parseBridgeServerFrame(data.toString());
        if ("requestId" in frame && frame.requestId === requestId) resolve(frame);
      }));
      socket.send(JSON.stringify({ requestId, message: { type: "compact" } }));
      expect(await reply).toMatchObject({ requestId, error: { code: "forbidden" } });
      await pullSocket(socket);
    } finally { socket.terminate(); }
  });
  it("keeps the old credential and its socket until the replacement is first used", async () => {
    const a = await owner(), socket = await socketFor(a.token);
    let closed: number | null = null; socket.once("close", (code) => { closed = code; });
    try {
      await pullSocket(socket);
      const blob = { blobId: randomBytes(32).toString("base64url"), size: 3 };
      const presign = async (token: string, op: string) => (await (await rpc("/v1/blobs/presign", token, { op, blobs: [blob] })).json() as BridgeBlobPresignResult).blobs[0].chunks[0].url;
      const put = await presign(a.token, "put");
      expect((await fetch(put, { method: "PUT", body: randomBytes(43) })).status).toBe(204);
      const capability = await presign(a.token, "get");
      const next = await renew(a.token);
      expect((await rpc("/v1/keys/mine", a.token)).status).toBe(200);
      expect((await fetch(capability)).status).toBe(200);
      await pullSocket(socket); expect(closed).toBeNull();
      expect((await rpc("/v1/log", next.token)).status).toBe(426);
      expect((await rpc("/v1/log", a.token)).status).toBe(401);
      expect((await fetch(capability)).status).toBe(403);
      expect((await fetch(await presign(next.token, "get"))).status).toBe(200);
      await vi.waitFor(() => expect(closed).toBe(1008));
    } finally { socket.terminate(); }
  });
  it.each(["/v1/quota", "/v1/subscription", "/v1/blobs/presign"])("commits first use through %s and invalidates the predecessor's cached socket", async (path) => {
    const a = await owner(), socket = await socketFor(a.token);
    let closed: number | null = null; socket.once("close", (code) => { closed = code; });
    try {
      await pullSocket(socket);
      const next = await renew(a.token);
      const body = path === "/v1/blobs/presign" ? { op: "put", blobs: [{ blobId: randomBytes(32).toString("base64url"), size: 3 }] } : undefined;
      expect((await rpc(path, next.token, body)).status).toBe(200);
      expect((await rpc("/v1/keys/mine", a.token)).status).toBe(401);
      await vi.waitFor(() => expect(closed).toBe(1008));
    } finally { socket.terminate(); }
  });
  it("recovers a lost refresh response with an idempotent retry, including concurrent retries and first use", async () => {
    const a = await owner(), token = `b7_${randomBytes(32).toString("hex")}`, proposal = { nextTokenHash: tokenHash(token) };
    // Deliberately discard the first response after D1 committed it.
    const discarded = await rpc("/v1/backends/refresh", a.token, proposal); expect(discarded.status).toBe(200); await discarded.arrayBuffer();
    expect((await rpc("/v1/keys/mine", a.token)).status).toBe(200);
    const replies = await Promise.all(Array.from({ length: 5 }, () => rpc("/v1/backends/refresh", a.token, proposal)));
    expect(replies.map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);
    const replacements = await Promise.all(replies.map((response) => response.json())) as { expiresAt: number }[];
    expect(replacements.every((value) => Object.keys(value).length === 2)).toBe(true);
    expect(new Set(replacements.map((value) => value.expiresAt)).size).toBe(1);
    const uses = await Promise.all(Array.from({ length: 5 }, () => rpc("/v1/keys/mine", token)));
    expect(uses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);
    expect((await rpc("/v1/keys/mine", a.token)).status).toBe(401);
    expect((await rpc("/v1/backends/refresh", a.token, {})).status).toBe(401);
    const row = await (await hub.database()).prepare("SELECT token_hash,next_token_hash,next_token_expires_at FROM bridge_backends WHERE account_id=? AND backend_id=?").bind(a.accountId, a.backendId).first();
    expect(row).toEqual({ token_hash: tokenHash(token), next_token_hash: null, next_token_expires_at: null });
  });
  it("revokes both credentials during a pending handover and never revives the revoked backend", async () => {
    const a = await owner(), next = await renew(a.token);
    expect((await revoke(a, a)).status).toBe(200);
    expect((await rpc("/v1/keys/mine", a.token)).status).toBe(401);
    expect((await rpc("/v1/keys/mine", next.token)).status).toBe(401);
  });
  it("does not extend the old token's natural expiry and can still activate its unexpired successor", async () => {
    const a = await owner(), next = await renew(a.token);
    await (await hub.database()).prepare("UPDATE bridge_backends SET token_expires_at=? WHERE account_id=? AND backend_id=?").bind(Date.now() - 1, a.accountId, a.backendId).run();
    expect((await rpc("/v1/keys/mine", a.token)).status).toBe(401);
    // A restarting client can acknowledge its saved proposal using that token.
    expect(await renew(next.token, next.token)).toEqual(next);
    expect((await rpc("/v1/keys/mine", next.token)).status).toBe(200);
  });
  it("rejects an expired candidate without erasing or replacing the valid current token", async () => {
    const a = await owner(), next = await renew(a.token);
    await (await hub.database()).prepare("UPDATE bridge_backends SET next_token_expires_at=? WHERE account_id=? AND backend_id=?").bind(Date.now() - 1, a.accountId, a.backendId).run();
    expect((await rpc("/v1/keys/mine", next.token)).status).toBe(401);
    expect((await rpc("/v1/keys/mine", a.token)).status).toBe(200);
    const renewed = await renew(a.token, next.token);
    expect(renewed.token).toBe(next.token); expect(renewed.expiresAt).toBeGreaterThan(Date.now());
    expect((await rpc("/v1/keys/mine", renewed.token)).status).toBe(200);
    expect((await rpc("/v1/keys/mine", a.token)).status).toBe(401);
  });
  it.each(["client", "thief"])("detects a conflicting proposal when the %s proposes first", async (first) => {
    const a = await owner(), candidates = { client: `b7_${randomBytes(32).toString("hex")}`, thief: `b7_${randomBytes(32).toString("hex")}` };
    const winner = candidates[first as keyof typeof candidates], loser = candidates[first === "client" ? "thief" : "client"];
    const next = await renew(a.token, winner);
    const response = await rpc("/v1/backends/refresh", a.token, { nextTokenHash: tokenHash(loser) });
    expect(response.status).toBe(409); expect(JSON.stringify(await response.json())).not.toContain(winner);
    expect(await renew(a.token, winner)).toEqual(next);
    expect((await rpc("/v1/keys/mine", loser)).status).toBe(401);
    expect((await rpc("/v1/keys/mine", a.token)).status).toBe(200);
  });
  it.each([{}, { nextTokenHash: "invalid" }, { nextTokenHash: `b7_${"a".repeat(64)}` }, { nextTokenHash: "A".repeat(64) }])("rejects a malformed hash without staging a credential (%j)", async (body) => {
    const a = await owner();
    expect((await rpc("/v1/backends/refresh", a.token, body)).status).toBe(400);
    expect(await (await hub.database()).prepare("SELECT next_token_hash FROM bridge_backends WHERE account_id=? AND backend_id=?")
      .bind(a.accountId, a.backendId).first()).toEqual({ next_token_hash: null });
  });
});

describe("Native browser sign-in with loopback and PKCE", () => {
  it("serializes sign-out against an in-flight native callback so cancelled enrollment cannot restore stored keys", async () => {
    const browser = await login(), dir = await mkdtemp(join(tmpdir(), "mains-native-login-"));
    let release!: () => void, entered!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; }), ready = new Promise<void>((resolve) => { entered = resolve; });
    const backendId = randomUUID(), identity = createBridgeIdentity({ backendId, dataDir: dir, storage: createNodeBackendRuntime({ dataDir: dir, appVersion: "test" }).secretStorage,
      kind: "electron", openExternal: async () => {}, changed() {}, approval() {}, revoked: async () => {}, ready: async () => { entered(); await blocked; } });
    try {
      await identity.start(); const status = await identity.signIn({ hubUrl: hub.url, includeExisting: true, flow: "loopback" }), url = new URL(status.login!.url);
      const consent = await fetch(new URL("/v1/auth/authorize", hub.url), { method: "POST", headers: { Cookie: browser.cookie, Origin: new URL(hub.url).origin },
        body: JSON.stringify({ redirectUri: url.searchParams.get("redirect_uri"), challenge: url.searchParams.get("code_challenge"), state: url.searchParams.get("state") }) });
      expect(consent.status).toBe(200);
      const callback = fetch((await consent.json() as { redirect: string }).redirect).catch(() => null);
      await ready; const signingOut = identity.signOut(); release(); await callback; await signingOut;
      expect(identity.status().state).toBe("signed-out"); expect(identity.takeRecoveryCode()).toBeNull();
      await expect(access(join(dir, "bridge", "identity.json"))).rejects.toThrow();
      const row = await (await hub.database()).prepare("SELECT status FROM bridge_backends WHERE account_id=? AND backend_id=?").bind(browser.user.id, backendId).first();
      expect(row!.status).toBe("revoked");
    } finally { release(); await identity.stop(); await rm(dir, { recursive: true, force: true }); }
  });
  it("rejects foreign redirects, CSRF, a wrong verifier and code replay, then completes an actual loopback callback", async () => {
    const browser = await login(); let token: string | undefined;
    const listener = await startBridgeLoopback(hub.url, async (value) => { token = value; }, () => {});
    try {
      const authorize = new URL(listener.url), args = { redirectUri: authorize.searchParams.get("redirect_uri"), challenge: authorize.searchParams.get("code_challenge"), state: authorize.searchParams.get("state") };
      const post = (body: unknown, origin = new URL(hub.url).origin) => fetch(new URL("/v1/auth/authorize", hub.url), { method: "POST", headers: { Cookie: browser.cookie, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      expect((await post({ ...args, redirectUri: "https://attacker.example/callback" })).status).toBe(400);
      expect((await post(args, "https://attacker.example")).status).toBe(403);
      const response = await post(args); expect(response.status).toBe(200);
      const callback = new URL((await response.json() as { redirect: string }).redirect);
      const bad = new URL(callback); bad.searchParams.set("state", randomBytes(32).toString("base64url")); expect((await fetch(bad)).status).toBe(400);
      expect((await rpc("/v1/auth/exchange", "", { code: callback.searchParams.get("code"), verifier: randomBytes(32).toString("base64url"), redirectUri: args.redirectUri })).status).toBe(401);
      expect((await fetch(callback)).status).toBe(200); expect(token).toBeTruthy();
      const registration = await rpc("/v1/backends", token!, { backendId: randomUUID(), publicKey: randomBytes(32).toString("base64url"), signingPublicKey: randomBytes(32).toString("base64url"), label: "Desktop", platform: "darwin" }); expect(registration.status).toBe(201);
      const saved = await (await hub.database()).prepare("SELECT count(*) AS n FROM bridge_login_codes WHERE user_id=?").bind(browser.user.id).first(); expect(saved!.n).toBe(0);
      expect((await rpc("/v1/auth/exchange", "", { code: callback.searchParams.get("code"), verifier: randomBytes(32).toString("base64url"), redirectUri: args.redirectUri })).status).toBe(401);
    } finally { listener.close(); }
  });
});
