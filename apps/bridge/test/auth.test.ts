import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdtemp, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { bridgeApprovalCode, bridgeBase64, type BridgeAccountKeys, type BridgeApprovalRequest, type BridgeSealedAccountKey } from "@mains/contracts/bridge-auth";
import type { BridgeBlobPresignResult } from "@mains/contracts/bridge-blobs";
import { parseBridgeServerFrame } from "@mains/contracts/bridge-wire";
import type { BridgeServerMessage } from "@mains/contracts/bridge-protocol";
import { generateBridgeDeviceKeyPair, openBridgeAccountKey, sealBridgeAccountKey } from "../../../packages/backend/src/modules/bridge/bridge.keys";
import { bridgeRecoveryPublicKey, signBridgeRecovery } from "../../../packages/backend/src/modules/bridge/bridge.recovery";
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
  const pair = generateBridgeDeviceKeyPair(), publicKey = bridgeBase64(pair.publicKey);
  const response = await fetch(new URL("/v1/backends", hub.url), { method: "POST", headers: { Cookie: browser.cookie, Origin: new URL(hub.url).origin, "Content-Type": "application/json" }, body: JSON.stringify({ backendId, publicKey, label: backendId, platform: "test" }) });
  expect(response.status).toBe(201);
  return { ...await response.json() as { accountId: string; token: string }, backendId, pair, publicKey, browser };
}
type Backend = Awaited<ReturnType<typeof register>>;
const recoveryWrap = (): BridgeAccountKeys["recovery"] => ({ v: 1, kdf: { name: "argon2id", memoryKiB: 65536, iterations: 3, parallelism: 1, salt: randomBytes(16).toString("base64url") }, nonce: randomBytes(24).toString("base64url"), payload: randomBytes(48).toString("base64url") });
function bootstrapBody(backend: Backend, key = randomBytes(32)) {
  return { key, body: { wrap: sealBridgeAccountKey(key, backend.pair.publicKey), recovery: recoveryWrap(), recoveryPublicKey: bridgeRecoveryPublicKey(key) } };
}
async function owner() {
  const a = await register(await login()), material = bootstrapBody(a);
  expect((await rpc("/v1/keys/bootstrap", a.token, material.body)).status).toBe(200);
  return { ...a, key: material.key };
}
async function requestApproval(b: Backend) {
  const response = await rpc("/v1/approvals", b.token, {}); expect(response.status).toBe(201);
  return await response.json() as BridgeApprovalRequest;
}
async function approval(a: Backend & { key: Uint8Array }, b: Backend) {
  const request = await requestApproval(b);
  const body = { ...request, wrap: sealBridgeAccountKey(a.key, b.pair.publicKey) };
  expect((await rpc("/v1/keys/wraps", a.token, body)).status).toBe(200); return body;
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
    expect((await rpc(`/v1/backends/${winner.backendId}`, winner.token, undefined, "DELETE")).status).toBe(200);
    const replacement = await register(browser, winner.backendId);
    expect((await rpc("/v1/keys/bootstrap", replacement.token, bootstrapBody(replacement).body)).status).toBe(409);
    expect((await rpc("/v1/log", replacement.token)).status).toBe(401);
  });
  it("binds approval to account, request, recipient public key and a matching code, and rejects replay", async () => {
    const a = await owner(), b = await register(a.browser), outsider = await owner(), request = await requestApproval(b);
    const body = { ...request, wrap: sealBridgeAccountKey(a.key, b.pair.publicKey) };
    expect(request.code).toBe(await bridgeApprovalCode(b.publicKey));
    expect(request.code.replaceAll("-", "")).toHaveLength(12);
    expect((await rpc("/v1/keys/wraps", a.token, { ...body, code: "ABC234" })).status).toBe(400);
    expect((await rpc("/v1/keys/wraps", a.token, { ...body, code: "WRONG1" })).status).toBe(400);
    expect((await rpc("/v1/keys/wraps", a.token, { ...body, requestId: randomUUID() })).status).toBe(409);
    expect((await rpc("/v1/keys/wraps", outsider.token, body)).status).toBe(409);
    const wrongPublicKey = bridgeBase64(generateBridgeDeviceKeyPair().publicKey);
    expect((await rpc("/v1/keys/wraps", a.token, { ...body, publicKey: wrongPublicKey, code: await bridgeApprovalCode(wrongPublicKey) })).status).toBe(409);
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
  it("requires a fresh, account- and recipient-bound recovery signature; rejects tampering, expiry and replay", async () => {
    const a = await owner(), b = await register(a.browser), c = await register(a.browser), db = await hub.database();
    const wrap = sealBridgeAccountKey(a.key, b.pair.publicKey);
    const { challenge } = await (await rpc("/v1/keys/recovery/challenge", b.token, {})).json() as { challenge: string };
    const signature = signBridgeRecovery(a.key, b.accountId, b.backendId, b.publicKey, challenge, wrap), body = { wrap, signature, challenge };
    expect((await rpc("/v1/keys/recovery/unlock", c.token, body)).status).toBe(403);
    expect((await rpc("/v1/keys/recovery/unlock", b.token, { ...body, wrap: sealBridgeAccountKey(a.key, c.pair.publicKey) })).status).toBe(403);
    expect((await rpc("/v1/keys/recovery/unlock", b.token, { ...body, signature: randomBytes(64).toString("base64url") })).status).toBe(403);
    await db.prepare("UPDATE bridge_backends SET challenge_expires_at=0 WHERE account_id=? AND backend_id=?").bind(b.accountId, b.backendId).run();
    expect((await rpc("/v1/keys/recovery/unlock", b.token, body)).status).toBe(403);
    const fresh = await (await rpc("/v1/keys/recovery/challenge", b.token, {})).json() as { challenge: string };
    const valid = { wrap, challenge: fresh.challenge, signature: signBridgeRecovery(a.key, b.accountId, b.backendId, b.publicKey, fresh.challenge, wrap) };
    expect((await rpc("/v1/keys/recovery/unlock", b.token, body)).status).toBe(403);
    expect((await rpc("/v1/keys/recovery/unlock", b.token, valid)).status).toBe(200);
    expect((await rpc("/v1/keys/recovery/unlock", b.token, valid)).status).toBe(409);
    expect((await rpc("/v1/log", b.token)).status).toBe(426);
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
        expect((await rpc(`/v1/backends/${b.backendId}`, a.token, undefined, "DELETE")).status).toBe(200);
        expect(await closed).toBe(1008);
        expect((await fetch(get)).status).toBe(403); expect((await fetch(put, { method: "PUT", body: bytes })).status).toBe(403);
        expect((await rpc("/v1/keys/mine", b.token)).status).toBe(401);
      } finally { bSocket.terminate(); }
    } finally { socket.terminate(); }
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
    expect((await rpc(`/v1/backends/${a.backendId}`, a.token, undefined, "DELETE")).status).toBe(200);
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
      const registration = await rpc("/v1/backends", token!, { backendId: randomUUID(), publicKey: randomBytes(32).toString("base64url"), label: "Desktop", platform: "darwin" }); expect(registration.status).toBe(201);
      const saved = await (await hub.database()).prepare("SELECT count(*) AS n FROM bridge_login_codes WHERE user_id=?").bind(browser.user.id).first(); expect(saved!.n).toBe(0);
      expect((await rpc("/v1/auth/exchange", "", { code: callback.searchParams.get("code"), verifier: randomBytes(32).toString("base64url"), redirectUri: args.redirectUri })).status).toBe(401);
    } finally { listener.close(); }
  });
});
