import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, hkdfSync } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bridgeApprovalCode, bridgeBase64, formatBridgeVerificationCode, type BridgeApprovalRequest } from "@mains/contracts/bridge-auth";
import { createNodeBackendRuntime } from "../../runtime/node-backend-runtime";
import { createBridgeIdentity, type BridgeIdentityClient } from "./bridge.identity";
import { createBridgeIdentityStorage, type BridgeSavedIdentity } from "./bridge.identity-storage";
import { generateBridgeAccountKey, generateBridgeDeviceKeyPair, openBridgeAccountKey, sealBridgeAccountKey } from "./bridge.keys";
import { bridgeRecoveryPublicKey, sealBridgeRecovery } from "./bridge.recovery";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
// Independent Node/OpenSSL answers, including all 60 comparison bits.
function fingerprint(bytes: Uint8Array) {
  const n = BigInt(`0x${Buffer.from(bytes).subarray(0, 8).toString("hex")}`) >> 4n;
  return Array.from({ length: 12 }, (_, i) => alphabet[Number(n >> BigInt(55 - 5 * i) & 31n)]).join("").match(/.{4}/g)!.join("-");
}
const deviceCode = (publicKey: string) => fingerprint(createHash("sha256").update(JSON.stringify([2, "mains.bridge.v2/device-approval", publicKey])).digest());
const accountCode = (key: Uint8Array) => fingerprint(new Uint8Array(hkdfSync("sha256", key, "mains.bridge.v2", "account-verification", 32)));
const dirs: string[] = [], clients: BridgeIdentityClient[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) await client.stop();
  vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("Bridge identity background cadence", () => {
  it.each([null, {}, { expiresAt: "invalid" }, { expiresAt: 0 }, { nextTokenHash: "a".repeat(64), expiresAt: 9999999999999 },
    { token: `b7_${"2".repeat(64)}`, expiresAt: 9999999999999 }])("preserves trusted keys and the current token for a truncated or malformed renewal response (%j)", async (response) => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const key = generateBridgeAccountKey(), f = await fixture(key); await f.client.stop();
    await f.vault.write({ ...(await f.vault.read())!, expiresAt: Date.now() + 86400_000 });
    const restarted = f.makeClient(); await restarted.start(); f.state.renewalResponse = response;
    await restarted.refresh();
    expect(restarted.status()).toMatchObject({ state: "ready", error: expect.stringContaining("renewal response") });
    expect(restarted.token()).toBe(f.saved.token);
    expect((await f.vault.read())!.token).toBe(f.saved.token);
    expect((await f.vault.read())!.accountKey).toBe(bridgeBase64(key));
  });
  it("keeps trusted keys after a lost refresh response and retries with the old token after restart", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const key = generateBridgeAccountKey(), f = await fixture(key); await f.client.stop();
    await f.vault.write({ ...(await f.vault.read())!, expiresAt: Date.now() + 86400_000 });
    const beforeRestart = f.makeClient(); await beforeRestart.start(); f.state.refreshFailures = 1;
    await beforeRestart.refresh();
    expect(beforeRestart.status()).toMatchObject({ state: "ready", error: expect.stringContaining("lost refresh response") });
    expect((await f.vault.read())!.accountKey).toBe(bridgeBase64(key)); expect(beforeRestart.token()).toBe(f.saved.token);
    const pending = (await f.vault.read())!.pendingToken;
    expect(pending).toBe(f.state.replacement.token);
    expect(f.state.calls.filter((call) => call.path.endsWith("/refresh")).at(-1)!.body)
      .toEqual({ nextTokenHash: createHash("sha256").update(pending!).digest("hex") });
    await beforeRestart.stop();
    const restarted = f.makeClient(); await restarted.start(); await restarted.refresh();
    expect(restarted.status()).toMatchObject({ state: "ready", error: null });
    expect(restarted.token()).toBe(f.state.replacement.token);
    expect(restarted.token()).toBe(pending);
    expect((await f.vault.read())!.pendingToken).toBeNull();
    expect((await f.vault.read())!.accountKey).toBe(bridgeBase64(key));
  });
  it("does not send a proposal before its random token is durable", async () => {
    const f = await fixture(generateBridgeAccountKey()); await f.client.stop();
    await f.vault.write({ ...(await f.vault.read())!, expiresAt: Date.now() + 86400_000 });
    const restarted = f.makeClient(); await restarted.start(); f.state.calls = [];
    const encrypt = f.storage.encryptString.bind(f.storage);
    vi.spyOn(f.storage, "encryptString").mockImplementation((value) => {
      if (JSON.parse(value).pendingToken) throw new Error("Injected proposal-storage failure");
      return encrypt(value);
    });
    await restarted.refresh();
    expect(restarted.status()).toMatchObject({ state: "ready", error: expect.stringContaining("proposal-storage failure") });
    expect(f.state.calls.some((call) => call.path.endsWith("/refresh"))).toBe(false);
    expect((await f.vault.read())!.pendingToken).toBeUndefined();
    expect(restarted.token()).toBe(f.saved.token);
  });
  it("does not stage a proposal on a hub that still uses server-generated credentials", async () => {
    const f = await fixture(generateBridgeAccountKey()); await f.client.stop();
    await f.vault.write({ ...(await f.vault.read())!, expiresAt: Date.now() + 86400_000 });
    f.state.mine.tokenRenewal = undefined;
    const restarted = f.makeClient(); await restarted.start(); f.state.calls = []; await restarted.refresh();
    expect(restarted.status()).toMatchObject({ state: "ready", error: expect.stringContaining("Update the Bridge hub") });
    expect(f.state.calls.some((call) => call.path.endsWith("/refresh"))).toBe(false);
    expect((await f.vault.read())!.pendingToken).toBeUndefined(); expect(restarted.token()).toBe(f.saved.token);
  });
  it("reports a competing successor as a conflict without erasing trusted keys", async () => {
    const key = generateBridgeAccountKey(), f = await fixture(key); await f.client.stop();
    await f.vault.write({ ...(await f.vault.read())!, expiresAt: Date.now() + 86400_000 });
    const restarted = f.makeClient(); await restarted.start(); f.state.proposedHash = "a".repeat(64);
    await restarted.refresh();
    expect(restarted.status()).toMatchObject({ state: "ready", error: expect.stringContaining("conflict") });
    expect(restarted.token()).toBe(f.saved.token);
    expect((await f.vault.read())!.accountKey).toBe(bridgeBase64(key));
  });
  it("resumes a saved successor even after the predecessor expires during an outage", async () => {
    const key = generateBridgeAccountKey(), f = await fixture(key); await f.client.stop();
    const pendingToken = `b7_${"3".repeat(64)}`;
    await f.vault.write({ ...(await f.vault.read())!, pendingToken, expiresAt: Date.now() - 1 });
    f.state.proposedHash = createHash("sha256").update(pendingToken).digest("hex");
    f.state.rejectedTokens.add(f.saved.token);
    const restarted = f.makeClient(); await restarted.start(); await restarted.refresh();
    expect(restarted.status()).toMatchObject({ state: "ready", error: null });
    expect(restarted.token()).toBe(pendingToken);
    expect((await f.vault.read())!.accountKey).toBe(bridgeBase64(key));
  });
  it("publishes a replacement token only after protected storage succeeds and preserves the old identity on failure", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const key = generateBridgeAccountKey(), f = await fixture(key); await f.client.stop();
    await f.vault.write({ ...(await f.vault.read())!, expiresAt: Date.now() + 86400_000 });
    const restarted = f.makeClient(); await restarted.start();
    const encrypt = f.storage.encryptString.bind(f.storage), observed: string[] = [];
    let fail = true;
    const write = vi.spyOn(f.storage, "encryptString").mockImplementation((value) => {
      if (JSON.parse(value).token === f.state.replacement.token) {
        observed.push(restarted.token());
        if (fail) throw new Error("Injected protected-storage failure");
      }
      return encrypt(value);
    });
    try {
      await restarted.refresh();
      expect(restarted.status()).toMatchObject({ state: "ready", error: expect.stringContaining("protected-storage failure") });
      expect(restarted.token()).toBe(f.saved.token);
      expect((await f.vault.read())!.token).toBe(f.saved.token);
      expect((await f.vault.read())!.accountKey).toBe(bridgeBase64(key));
      fail = false; await restarted.refresh();
      expect(observed).toEqual([f.saved.token, f.saved.token]);
      expect(restarted.token()).toBe(f.state.replacement.token);
      expect((await f.vault.read())!.token).toBe(f.state.replacement.token);
      expect((await f.vault.read())!.accountKey).toBe(bridgeBase64(key));
    } finally { write.mockRestore(); }
  });
  it("does not lose an approval notification that arrives during an older HTTP snapshot", async () => {
    const f = await fixture(generateBridgeAccountKey()), original = globalThis.fetch;
    let release!: () => void, entered!: () => void, hold = true;
    const blocked = new Promise<void>((resolve) => { release = resolve; }), snapshot = new Promise<void>((resolve) => { entered = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (...args: Parameters<typeof fetch>) => {
      const response = await original(...args);
      if (new URL(String(args[0])).pathname === "/v1/approvals" && hold) { hold = false; entered(); await blocked; }
      return response;
    }));
    const current = f.client.refresh(); await snapshot;
    const request = approval(bridgeBase64(generateBridgeDeviceKeyPair().publicKey)); f.state.approvals = [request];
    const notified = f.client.refresh(true); release(); await Promise.all([current, notified]);
    expect(f.client.status().approvals).toEqual([request]);
  });
  it("checks a ready identity every five minutes instead of every five seconds", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const f = await fixture(generateBridgeAccountKey()); f.state.calls = [];
    await vi.advanceTimersByTimeAsync(299_999);
    expect(f.state.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.state.calls.map((call) => call.path)).toEqual(["/v1/keys/mine", "/v1/approvals", "/v1/backends"]);
  });
  it("keeps short approval checks, but waits five minutes without rewriting a pending fingerprint", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const f = await fixture(); f.state.calls = [];
    await vi.advanceTimersByTimeAsync(4999); expect(f.state.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.state.calls.map((call) => call.path)).toEqual(["/v1/keys/mine"]);
    const key = generateBridgeAccountKey(); f.offer(key); await f.client.refresh(); f.state.calls = [];
    const identityFile = join(f.dir, "bridge", "identity.json"), before = await readFile(identityFile);
    await vi.advanceTimersByTimeAsync(299_999); expect(f.state.calls).toEqual([]);
    expect(await readFile(identityFile)).toEqual(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.state.calls.map((call) => call.path)).toEqual(["/v1/keys/mine"]);
    expect(await readFile(identityFile)).toEqual(before);
    await f.client.confirmAccountKey(accountCode(key)); f.state.calls = [];
    await vi.advanceTimersByTimeAsync(299_999); expect(f.state.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.state.calls.map((call) => call.path)).toEqual(["/v1/keys/mine", "/v1/approvals", "/v1/backends"]);
  });
});

async function fixture(accountKey: Uint8Array | null = null) {
  const dir = await mkdtemp(join(tmpdir(), "mains-approval-security-")); dirs.push(dir);
  const storage = createNodeBackendRuntime({ dataDir: dir, appVersion: "test" }).secretStorage;
  const vault = createBridgeIdentityStorage(dir, storage), pair = generateBridgeDeviceKeyPair(), publicKey = bridgeBase64(pair.publicKey);
  const saved: BridgeSavedIdentity = { v: 1, backendId: "local", hubUrl: "https://hub.invalid", label: "Local", accountId: "synthetic-account", email: "test@example.invalid",
    publicKey, privateKey: bridgeBase64(pair.secretKey), token: "b7_synthetic_fixture", expiresAt: Date.now() + 90 * 86400_000,
    accountKey: accountKey ? bridgeBase64(accountKey) : null, includeExisting: true, activationPending: !accountKey };
  await vault.write(saved);
  const state = {
    mine: { accountId: saved.accountId, initialized: true, tokenRenewal: "client-hash-v1" as string | undefined,
      backend: { backendId: saved.backendId, publicKey, label: "Local", platform: "test", status: accountKey ? "approved" : "pending" },
      wrap: accountKey ? sealBridgeAccountKey(accountKey, pair.publicKey) : null, recoveryPublicKey: accountKey ? bridgeRecoveryPublicKey(accountKey) : null,
      approval: { status: "pending", expires_at: Date.now() + 600_000 } },
    approvals: [] as BridgeApprovalRequest[],
    calls: [] as { path: string; body: any }[],
    recovery: null as any,
    replacement: { token: `b7_${"2".repeat(64)}`, expiresAt: Date.now() + 90 * 86400_000 },
    renewalResponse: undefined as unknown,
    proposedHash: null as string | null,
    rejectedTokens: new Set<string>(),
    refreshFailures: 0,
    unlocked: () => {},
  };
  vi.stubGlobal("fetch", vi.fn(async (url: URL, options: RequestInit) => {
    expect(url.origin).toBe("https://hub.invalid");
    const path = url.pathname, body = options.body ? JSON.parse(options.body as string) : undefined;
    state.calls.push({ path, body });
    const credential = new Headers(options.headers).get("Authorization")?.replace(/^Bearer /, "");
    if (credential && state.rejectedTokens.has(credential)) return Response.json({ error: "Expired fixture credential" }, { status: 401 });
    let value: unknown;
    if (path === "/v1/keys/mine") value = state.mine;
    else if (path === "/v1/approvals") value = state.approvals;
    else if (path === "/v1/backends") value = [];
    else if (path === "/v1/backends/refresh") {
      const pending = (await vault.read())!.pendingToken;
      expect(pending).toMatch(/^b7_[a-f0-9]{64}$/);
      expect(body).toEqual({ nextTokenHash: createHash("sha256").update(pending!).digest("hex") });
      if (state.proposedHash && state.proposedHash !== body.nextTokenHash) return Response.json({ error: "Bridge token renewal conflict" }, { status: 409 });
      state.proposedHash = body.nextTokenHash; state.replacement.token = pending!;
      if (state.refreshFailures > 0) { state.refreshFailures--; throw new TypeError("Injected lost refresh response"); }
      value = state.renewalResponse === undefined ? { nextTokenHash: body.nextTokenHash, expiresAt: state.replacement.expiresAt } : state.renewalResponse;
    }
    else if (path === "/v1/keys/wraps") value = { ok: true };
    else if (path === "/v1/keys/recovery") value = state.recovery;
    else if (path === "/v1/keys/recovery/challenge") value = { challenge: "synthetic-challenge" };
    else if (path === "/v1/keys/recovery/unlock") { state.unlocked(); value = { ok: true }; }
    else throw new Error(`Unexpected hub request: ${path}`);
    return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
  }));
  const activatedKeys: string[] = [];
  const ready = vi.fn(async (config: { accountKey: Uint8Array }) => { activatedKeys.push(bridgeBase64(config.accountKey)); });
  function makeClient() {
    const client = createBridgeIdentity({ backendId: saved.backendId, dataDir: dir, storage, kind: "node", ready,
      openExternal: async () => {}, changed() {}, approval() {}, revoked: async () => {} });
    clients.push(client); return client;
  }
  const client = makeClient(); await client.start(); await client.refresh();
  function offer(key: Uint8Array) {
    state.mine.backend.status = "approved";
    state.mine.wrap = sealBridgeAccountKey(key, pair.publicKey);
    state.mine.recoveryPublicKey = bridgeRecoveryPublicKey(key);
  }
  return { state, client, makeClient, ready, activatedKeys, vault, saved, pair, offer, dir, storage };
}
function approval(publicKey: string, code = deviceCode(publicKey)): BridgeApprovalRequest {
  return { requestId: "request", backendId: "new-device", publicKey, code, label: "New device", platform: "test", expiresAt: new Date(Date.now() + 600_000).toISOString() };
}

describe("Bridge approval with an untrusted hub", () => {
  it("preserves every one of the 60 comparison bits and excludes unused tail bits", () => {
    const zero = new Uint8Array(8), codes = new Set<string>();
    for (let bit = 0; bit < 60; bit++) {
      const bytes = zero.slice(); bytes[bit >>> 3] = 1 << (7 - (bit & 7));
      const code = formatBridgeVerificationCode(bytes); expect(code).not.toBe(formatBridgeVerificationCode(zero)); codes.add(code);
    }
    expect(codes.size).toBe(60);
    const tail = zero.slice(); tail[7] = 15;
    expect(formatBridgeVerificationCode(tail)).toBe(formatBridgeVerificationCode(zero));
  });
  it("uses a domain-separated 60-bit device code instead of the legacy six characters", async () => {
    const publicKey = bridgeBase64(new Uint8Array(32).fill(42));
    expect(await bridgeApprovalCode(publicKey)).toBe(deviceCode(publicKey));
    expect(await bridgeApprovalCode(publicKey)).toMatch(/^(?:[A-HJ-NP-Z2-9]{4}-){2}[A-HJ-NP-Z2-9]{4}$/);
  });
  it("derives displayed codes locally and rejects the real device's code paired with an attacker's key before sealing", async () => {
    const f = await fixture(generateBridgeAccountKey()), honest = generateBridgeDeviceKeyPair(), attacker = generateBridgeDeviceKeyPair();
    const forged = approval(bridgeBase64(attacker.publicKey), deviceCode(bridgeBase64(honest.publicKey)));
    f.state.approvals = [forged]; await f.client.refresh();
    expect(f.client.status().approvals[0].code).toBe(deviceCode(forged.publicKey));
    expect(f.client.status().approvals[0].code).not.toBe(forged.code);
    await expect(f.client.approve(forged)).rejects.toThrow(/codes do not match/i);
    expect(f.state.calls.some((call) => call.path === "/v1/keys/wraps")).toBe(false);
  });
  it("rejects a substituted or stale approval snapshot and six-character downgrade", async () => {
    const f = await fixture(generateBridgeAccountKey()), peer = generateBridgeDeviceKeyPair(), attacker = generateBridgeDeviceKeyPair();
    const request = approval(bridgeBase64(peer.publicKey)); f.state.approvals = [request]; await f.client.refresh();
    await expect(f.client.approve({ ...request, publicKey: bridgeBase64(attacker.publicKey), code: deviceCode(bridgeBase64(attacker.publicKey)) })).rejects.toThrow(/changed|pending/i);
    await expect(f.client.approve({ ...request, code: "ABC234" })).rejects.toThrow(/12-character/i);
    request.expiresAt = new Date(Date.now() - 1).toISOString(); await f.client.refresh();
    await expect(f.client.approve(request)).rejects.toThrow(/expired|pending/i);
    expect(f.state.calls.some((call) => call.path === "/v1/keys/wraps")).toBe(false);
  });
  it("seals the real key to the locally verified recipient for a matching current request", async () => {
    const key = generateBridgeAccountKey(), f = await fixture(key), peer = generateBridgeDeviceKeyPair();
    const request = approval(bridgeBase64(peer.publicKey)); f.state.approvals = [request]; await f.client.refresh();
    await f.client.approve({ ...request, code: request.code.toLowerCase().replace(/-/g, " ") });
    const posted = f.state.calls.find((call) => call.path === "/v1/keys/wraps")!.body;
    expect(posted.code).toBe(request.code);
    expect(openBridgeAccountKey(posted.wrap, peer.secretKey)).toEqual(key);
  });
  it("holds an offered key outside the active identity until the approved device's fingerprint is entered", async () => {
    const f = await fixture(), key = generateBridgeAccountKey(); f.offer(key); await f.client.refresh();
    expect(f.client.status()).toMatchObject({ state: "needs-verification", accountFingerprint: null });
    expect(JSON.stringify(f.client.status())).not.toContain(accountCode(key));
    expect(f.ready).not.toHaveBeenCalled(); expect(() => f.client.token()).toThrow(/approval|verification/i);
    expect(await f.vault.read()).toMatchObject({ accountKey: null, pendingAccountKey: bridgeBase64(key) });
    await expect(f.client.confirmAccountKey("ABC234")).rejects.toThrow(/12-character/i);
    await f.client.confirmAccountKey(accountCode(key));
    expect(f.client.status()).toMatchObject({ state: "ready", accountFingerprint: accountCode(key) }); expect(f.ready).toHaveBeenCalledOnce();
    expect(await f.vault.read()).toMatchObject({ accountKey: bridgeBase64(key), pendingAccountKey: null });
  });
  it("blocks sync when a malicious hub substitutes both the wrapped account key and recovery verifier", async () => {
    const f = await fixture(), actual = generateBridgeAccountKey(), fake = generateBridgeAccountKey();
    f.offer(fake); await f.client.refresh();
    await expect(f.client.confirmAccountKey(accountCode(actual))).rejects.toThrow(/fingerprints do not match/i);
    expect(f.client.status().state).toBe("needs-verification"); expect(f.ready).not.toHaveBeenCalled();
    expect((await f.vault.read())!.accountKey).toBeNull();
  });
  it("rejects a wrong recipient or inconsistent verifier without saving an active or pending key", async () => {
    const f = await fixture(), key = generateBridgeAccountKey(); f.offer(key);
    f.state.mine.wrap = sealBridgeAccountKey(key, generateBridgeDeviceKeyPair().publicKey); await f.client.refresh();
    expect(f.client.status().state).toBe("needs-approval"); expect(f.ready).not.toHaveBeenCalled();
    f.offer(key); f.state.mine.recoveryPublicKey = bridgeRecoveryPublicKey(generateBridgeAccountKey()); await f.client.refresh();
    expect(f.client.status().error).toMatch(/verifier/i); expect(f.ready).not.toHaveBeenCalled();
    expect((await f.vault.read())!.accountKey).toBeNull(); expect((await f.vault.read())!.pendingAccountKey).toBeUndefined();
  });
  it("persists the verification gate across restart and pins the candidate against later hub replacement", async () => {
    const f = await fixture(), actual = generateBridgeAccountKey(); f.offer(actual); await f.client.refresh(); await f.client.stop();
    const restarted = f.makeClient(); await restarted.start();
    expect(restarted.status()).toMatchObject({ state: "needs-verification", accountFingerprint: null });
    f.offer(generateBridgeAccountKey()); await restarted.refresh();
    expect(restarted.status().error).toMatch(/changed/i); expect(f.ready).not.toHaveBeenCalled();
    expect((await f.vault.read())!.pendingAccountKey).toBe(bridgeBase64(actual));
    expect(restarted.status().accountFingerprint).toBeNull();
  });
  it("does not bootstrap a new account over a pending verification when the hub claims keys disappeared", async () => {
    const f = await fixture(); f.offer(generateBridgeAccountKey()); await f.client.refresh();
    f.state.mine.initialized = false; f.state.mine.backend.status = "pending"; f.state.mine.wrap = null; await f.client.refresh();
    expect(f.client.status().state).toBe("needs-verification"); expect(f.ready).not.toHaveBeenCalled();
    expect(f.state.calls.some((call) => call.path === "/v1/keys/bootstrap")).toBe(false);
  });
  it("cannot be switched to bootstrap after learning that the account already exists, even before a key offer", async () => {
    const f = await fixture();
    f.state.mine.initialized = false; await f.client.refresh();
    expect(f.client.status()).toMatchObject({ state: "needs-approval", error: expect.stringMatching(/keys disappeared/i) });
    expect(f.ready).not.toHaveBeenCalled();
    expect(f.state.calls.some((call) => call.path === "/v1/keys/bootstrap")).toBe(false);
    expect(await f.vault.read()).toMatchObject({ accountKey: null, accountInitialized: true });
  });
  it("keeps existing locally pinned keys and their fingerprint when the hub supplies a different wrap", async () => {
    const actual = generateBridgeAccountKey(), f = await fixture(actual); f.offer(generateBridgeAccountKey()); await f.client.refresh();
    expect(f.client.status()).toMatchObject({ state: "ready", accountFingerprint: accountCode(actual) });
    expect((await f.vault.read())!.accountKey).toBe(bridgeBase64(actual)); expect(f.ready).toHaveBeenCalledOnce();
  });
  it("activates recovery using the locally decrypted key even if the hub returns a forged wrap afterwards", async () => {
    const f = await fixture(), actual = generateBridgeAccountKey(), code = "AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA";
    f.state.recovery = { recovery: await sealBridgeRecovery(actual, code), recoveryPublicKey: bridgeRecoveryPublicKey(actual) };
    f.state.unlocked = () => f.offer(generateBridgeAccountKey());
    await f.client.enterRecoveryCode(code);
    expect(f.client.status()).toMatchObject({ state: "ready", accountFingerprint: accountCode(actual) });
    expect((await f.vault.read())!.accountKey).toBe(bridgeBase64(actual));
    expect(f.ready).toHaveBeenCalledOnce();
    expect(f.activatedKeys).toEqual([bridgeBase64(actual)]);
  });
});
