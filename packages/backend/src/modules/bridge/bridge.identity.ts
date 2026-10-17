import { hostname } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { x25519 } from "@noble/curves/ed25519.js";
import { bridgeApprovalCode, bridgeBase64, bridgeBytes, normalizeBridgeVerificationCode, type BridgeApprovalRequest, type BridgeAuthStatus, type BridgeRegisteredBackend,
  type BridgeSignInInput, type BridgeSealedAccountKey, type BridgeAccountKeys } from "@mains/contracts/bridge-auth";
import type { SecretStorageAdapter } from "../../runtime/backend-runtime";
import { createBridgeIdentityStorage, type BridgeSavedIdentity } from "./bridge.identity-storage";
import { bridgeAccountFingerprint, generateBridgeAccountKey, generateBridgeDeviceKeyPair, openBridgeAccountKey, sealBridgeAccountKey } from "./bridge.keys";
import { bridgeRecoveryPublicKey, generateBridgeRecoveryCode, openBridgeRecovery, sealBridgeRecovery, signBridgeRecovery } from "./bridge.recovery";
import { bridgeHttp, bridgeHubUrl, BridgeHttpError, pollBridgeDeviceLogin, startBridgeDeviceLogin, startBridgeLoopback } from "./bridge.login";
import type { BridgeDevConfig } from "./bridge.config";

type Mine = { accountId: string; initialized: boolean; backend: BridgeRegisteredBackend; wrap: BridgeSealedAccountKey | null; recoveryPublicKey: string | null; approval: { status: string; expires_at: number } | null; tokenRenewal?: string };
export interface BridgeIdentityOptions {
  backendId: string; dataDir: string; storage: SecretStorageAdapter; kind: "electron" | "node";
  openExternal(url: string): Promise<unknown>;
  ready(config: BridgeDevConfig, includeExisting: boolean, firstEnrollment: boolean, accountId: string): Promise<void>;
  changed(): void;
  approval(request: BridgeApprovalRequest): void;
  revoked(): Promise<void>;
}
/** Identity/key state owns no SQLite and has no renderer-facing credential getter. */
export function createBridgeIdentity(options: BridgeIdentityOptions) {
  const vault = createBridgeIdentityStorage(options.dataDir, options.storage);
  let saved: BridgeSavedIdentity | null = null, state: BridgeAuthStatus["state"] = "signed-out", error: string | null = null;
  let hub: string | null = null, label = hostname(), code: string | null = null, recoveryCode: string | null = null;
  let accountFingerprint: string | null = null;
  let login: BridgeAuthStatus["login"] = null, timer: ReturnType<typeof setTimeout> | undefined, closed = false, running: Promise<void> | undefined;
  let stopLogin: (() => void) | undefined, deviceCode: string | null = null, interval = 5000, epoch = 0, activated = false;
  let requests: BridgeApprovalRequest[] = [], backends: BridgeRegisteredBackend[] = [];
  let operations: Promise<unknown> = Promise.resolve(), cancelling = false;
  function exclusive<T>(action: () => Promise<T>): Promise<T> {
    const next = operations.then(action); operations = next.catch(() => {}); return next;
  }
  const notified = new Set<string>();
  const notify = () => { if (!closed) options.changed(); };
  const schedule = (ms = state === "ready" || state === "needs-verification" ? 300_000 : state === "signing-in" ? interval : 5000) => {
    if (timer) clearTimeout(timer); timer = undefined;
    if (closed || cancelling || state === "revoked" || !saved && !deviceCode) return;
    timer = setTimeout(() => { timer = undefined; void refresh(); }, ms); timer.unref();
  };
  async function request<T>(path: string, body?: unknown, method?: string): Promise<T> {
    if (!saved) throw new Error("Sign in to Bridge first");
    return bridgeHttp<T>(saved.hubUrl, path, saved.token, body, method);
  }
  function config(): BridgeDevConfig {
    if (!saved?.accountKey) throw new Error("Backend approval is required");
    return { url: new URL("/v1/log", saved.hubUrl).toString().replace(/^http/, "ws"), token: saved.token,
      accountKey: bridgeBytes(saved.accountKey, 32), backendId: options.backendId, label: saved.label };
  }
  async function renewToken() {
    if (!saved?.accountKey) throw new Error("Backend approval is required");
    if (!saved.pendingToken) {
      const proposed = { ...saved, pendingToken: `b7_${randomBytes(32).toString("hex")}` };
      // Persist before contacting the hub, including before a request whose
      // reply is lost. Retry/restart always proposes the same random token.
      await vault.write(proposed); saved = proposed;
    }
    const token = saved.pendingToken!, body = { nextTokenHash: createHash("sha256").update(token).digest("hex") };
    let reply: { nextTokenHash: string; expiresAt: number };
    try { reply = await request("/v1/backends/refresh", body); }
    catch (failure) {
      if (!(failure instanceof BridgeHttpError && failure.status === 401)) throw failure;
      // Both credentials are already durable. The proposal may have been
      // accepted before an outage outlasted the predecessor's natural expiry.
      reply = await bridgeHttp(saved.hubUrl, "/v1/backends/refresh", token, body);
    }
    if (!reply || reply.nextTokenHash !== body.nextTokenHash || !Number.isSafeInteger(reply.expiresAt) || reply.expiresAt <= Date.now()) throw new Error("Invalid Bridge token renewal response");
    const renewed = { ...saved, token, expiresAt: reply.expiresAt, pendingToken: null };
    // Replication only sees the successor after this write succeeds. A failed
    // write retains the saved proposal and retries the acknowledgement.
    await vault.write(renewed); saved = renewed;
  }
  async function activate(key: Uint8Array, publicVerifier: string) {
    if (!saved || closed || cancelling) throw new Error("Sign-in was cancelled");
    if (bridgeRecoveryPublicKey(key) !== publicVerifier) throw new Error("The approved account key does not match this account");
    saved.accountKey = bridgeBase64(key); saved.pendingAccountKey = null; saved.accountInitialized = true;
    accountFingerprint = bridgeAccountFingerprint(key); await vault.write(saved);
    if (closed || cancelling) return;
    if (!activated) {
      const value = config();
      try { await options.ready(value, saved.includeExisting, saved.activationPending, saved.accountId); activated = true; saved.includeExisting = true; saved.activationPending = false; await vault.write(saved); }
      finally { value.accountKey.fill(0); }
    }
    state = "ready"; error = null; login = null; deviceCode = null; stopLogin = undefined; schedule(); notify();
  }
  async function update() {
    if (!saved || closed || cancelling) return;
    if (saved.pendingToken) await renewToken();
    const mine = await request<Mine>("/v1/keys/mine");
    if (mine.accountId !== saved.accountId || mine.backend.backendId !== options.backendId || mine.backend.publicKey !== saved.publicKey)
      throw new Error("Backend identity changed; sign in again");
    if (typeof mine.initialized !== "boolean") throw new Error("Invalid Bridge account initialization state");
    if (mine.initialized && !saved.accountInitialized) { saved.accountInitialized = true; await vault.write(saved); }
    if (saved.accountKey) {
      // A locally trusted key is never replaced by a hub-provided wrap/verifier.
      if (mine.backend.status !== "approved") throw new Error("Backend approval changed; sign in again");
      if (!activated) {
        const key = bridgeBytes(saved.accountKey, 32);
        try { await activate(key, bridgeRecoveryPublicKey(key)); } finally { key.fill(0); }
      } else { state = "ready"; error = null; }
      if (saved.expiresAt - Date.now() < 7 * 24 * 60 * 60 * 1000) {
        // Do not let an older hub issue a different, server-generated token
        // which this client cannot safely acknowledge as its own proposal.
        if (mine.tokenRenewal !== "client-hash-v1") throw new Error("Update the Bridge hub before renewing this device's credential");
        await renewToken();
      }
      const [incoming, devices] = await Promise.all([request<BridgeApprovalRequest[]>("/v1/approvals"), request<BridgeRegisteredBackend[]>("/v1/backends")]);
      const verified = await Promise.all(incoming.map(async (entry) => {
        if (!entry || typeof entry.requestId !== "string" || !entry.requestId || typeof entry.backendId !== "string" || !entry.backendId ||
          !Number.isFinite(Date.parse(entry.expiresAt))) throw new Error("Invalid Bridge approval request");
        // The hub's code is not an authentication source, including for notifications/CLI.
        return { ...entry, code: await bridgeApprovalCode(entry.publicKey) };
      }));
      requests = verified.filter((entry) => Date.parse(entry.expiresAt) > Date.now()); backends = devices;
      for (const entry of requests) if (!notified.has(entry.requestId)) { notified.add(entry.requestId); options.approval(entry); }
      return;
    }
    if (mine.backend.status === "approved") {
      if (!mine.wrap || !mine.recoveryPublicKey) throw new Error("Approved account key is unavailable");
      const secret = bridgeBytes(saved.privateKey, 32);
      try {
        const key = openBridgeAccountKey(mine.wrap, secret);
        try {
          if (bridgeRecoveryPublicKey(key) !== mine.recoveryPublicKey) throw new Error("The offered account key does not match its verifier");
          const encoded = bridgeBase64(key);
          if (saved.pendingAccountKey && saved.pendingAccountKey !== encoded) throw new Error("Account key changed during verification; disconnect and try again");
          if (!saved.pendingAccountKey) { saved.pendingAccountKey = encoded; await vault.write(saved); }
          accountFingerprint = bridgeAccountFingerprint(key);
          state = "needs-verification"; error = null; login = null; notify();
        } finally { key.fill(0); }
      } finally { secret.fill(0); }
      return;
    }
    // An untrusted status/initialized flag cannot reset an in-progress comparison.
    if (saved.pendingAccountKey) { state = "needs-verification"; return; }
    login = null;
    if (!mine.initialized) {
      if (saved.accountInitialized) throw new Error("Account keys disappeared; use recovery or disconnect instead of creating a new key");
      const key = generateBridgeAccountKey(), generated = generateBridgeRecoveryCode();
      try {
        const wrap = sealBridgeAccountKey(key, bridgeBytes(saved.publicKey, 32)), recovery = await sealBridgeRecovery(key, generated), recoveryPublicKey = bridgeRecoveryPublicKey(key);
        if (closed || cancelling) return;
        try { await request("/v1/keys/bootstrap", { wrap, recovery, recoveryPublicKey }); recoveryCode = generated; await activate(key, recoveryPublicKey); }
        catch (failure) { if (!(failure instanceof BridgeHttpError && failure.status === 409)) throw failure; }
      } finally { key.fill(0); }
      return;
    }
    state = "needs-approval";
    if (!mine.approval) await request("/v1/approvals", {});
    else if (mine.approval.status === "rejected") error = "This backend's approval request was declined";
    else if (mine.approval.expires_at <= Date.now()) error = "Approval expired; request access again";
    notify();
  }
  async function complete(token: string, input: BridgeSignInInput, generation: number) {
    if (generation !== epoch || closed) return;
    const pair = generateBridgeDeviceKeyPair();
    try {
      const registered = await bridgeHttp<{ accountId: string; email: string; token: string; expiresAt: number; backend: BridgeRegisteredBackend }>(hub!, "/v1/backends", token,
        { backendId: options.backendId, publicKey: bridgeBase64(pair.publicKey), label, platform: process.platform });
      if (generation !== epoch || closed) {
        await bridgeHttp(hub!, `/v1/backends/${encodeURIComponent(options.backendId)}`, registered.token, undefined, "DELETE").catch(() => {});
        return;
      }
      saved = { v: 1, backendId: options.backendId, hubUrl: hub!, label, accountId: registered.accountId, email: registered.email,
        publicKey: bridgeBase64(pair.publicKey), privateKey: bridgeBase64(pair.secretKey), token: registered.token, expiresAt: registered.expiresAt,
        accountKey: null, includeExisting: input.includeExisting, activationPending: true };
      await vault.write(saved); code = await bridgeApprovalCode(saved.publicKey); state = "signing-in"; login = null; deviceCode = null;
      await update(); schedule();
    } finally {
      pair.secretKey.fill(0);
      await bridgeHttp(hub!, "/api/auth/sign-out", token, {}).catch(() => {});
    }
  }
  async function refresh(afterCurrent = false): Promise<void> {
    if (closed) return;
    // A notification received during a stale HTTP snapshot must run once more
    // afterwards, rather than disappear until the five-minute fallback.
    if (running) return afterCurrent ? running.catch(() => {}).then(() => refresh()) : running;
    const generation = epoch;
    running = exclusive(async () => {
      try {
        if (saved) await update();
        else if (deviceCode && login) {
          if (Date.parse(login.expiresAt) <= Date.now()) throw new Error("Sign-in expired; try again");
          const token = await pollBridgeDeviceLogin(hub!, deviceCode);
          await complete(token.access_token, pendingInput!, generation);
        }
      } catch (failure) {
        if (generation !== epoch || closed) return;
        if (failure instanceof BridgeHttpError && /authorization_pending|slow_down/i.test(failure.code ?? failure.message)) { if (/slow_down/i.test(failure.code ?? failure.message)) interval += 5000; }
        else if (failure instanceof BridgeHttpError && failure.status === 401 && saved) {
          state = "revoked"; saved.accountKey = null; saved.pendingAccountKey = null; saved.pendingToken = null; accountFingerprint = null; await vault.write(saved); await options.revoked(); activated = false;
          error = "Backend access expired or was revoked; sign out and sign in again";
        } else { error = failure instanceof Error ? failure.message : "Bridge sign-in failed"; if (!saved) state = "error"; }
      } finally { if (generation === epoch && !closed) { notify(); schedule(); } }
    });
    try { await running; } finally { running = undefined; }
  }
  let pendingInput: BridgeSignInInput | null = null;
  const api = {
    async start() {
      saved = await vault.read();
      if (!saved) return;
      if (saved.backendId !== options.backendId || bridgeBase64(x25519.getPublicKey(bridgeBytes(saved.privateKey, 32))) !== saved.publicKey) throw new Error("Bridge identity does not match this backend");
      hub = bridgeHubUrl(saved.hubUrl); label = saved.label; code = await bridgeApprovalCode(saved.publicKey);
      // A stored key can read the local replica offline; network access is still
      // checked by the hub before every request and stops on a revoked response.
      if (saved.accountKey) { const key = bridgeBytes(saved.accountKey, 32); try { await activate(key, bridgeRecoveryPublicKey(key)); } finally { key.fill(0); } }
      else if (saved.pendingAccountKey) {
        const key = bridgeBytes(saved.pendingAccountKey, 32);
        try { accountFingerprint = bridgeAccountFingerprint(key); } finally { key.fill(0); }
        state = "needs-verification";
      }
      else state = "needs-approval";
      schedule(0); notify();
    },
    async signIn(input: BridgeSignInInput) { return exclusive(async () => {
      if (saved || state === "signing-in") throw new Error("Bridge sign-in is already active");
      if (typeof input.includeExisting !== "boolean") throw new Error("Choose whether to sync existing history");
      if (!options.storage.isEncryptionAvailable()) throw new Error("Secure key storage is unavailable");
      stopLogin?.(); stopLogin = undefined; if (timer) clearTimeout(timer); deviceCode = null; login = null;
      epoch++; hub = bridgeHubUrl(input.hubUrl); label = input.label?.trim() || hostname();
      if (label.length > 128 || [...label].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw new Error("Backend name is too long or invalid");
      pendingInput = input; error = null; state = "signing-in"; const generation = epoch;
      try {
      if (input.flow === "loopback" && options.kind === "electron") {
        const listener = await startBridgeLoopback(hub, (token) => exclusive(() => complete(token, input, generation)), (failure) => { if (generation !== epoch || closed) return; error = failure instanceof Error ? failure.message : "Sign-in failed"; state = "error"; notify(); });
        stopLogin = listener.close; login = { url: listener.url, code: null, expiresAt: listener.expiresAt };
        await options.openExternal(listener.url);
      } else {
        const auth = await startBridgeDeviceLogin(hub); deviceCode = auth.device_code; interval = Math.max(5000, auth.interval * 1000);
        login = { url: auth.verification_uri_complete, code: auth.user_code, expiresAt: new Date(Date.now() + auth.expires_in * 1000).toISOString() };
        schedule(interval);
      }
      notify(); return api.status();
      } catch (failure) { stopLogin?.(); stopLogin = undefined; state = "error"; error = failure instanceof Error ? failure.message : "Sign-in failed"; notify(); throw failure; }
    }); },
    status(): Omit<BridgeAuthStatus, "existing"> {
      return { state, hubUrl: hub, accountId: saved?.accountId ?? null, email: saved?.email ?? null, backendId: options.backendId,
        label, verificationCode: state === "needs-approval" ? code : null,
        accountFingerprint: state === "ready" ? accountFingerprint : null, login, approvals: requests, backends, recoveryCodeAvailable: recoveryCode !== null, error };
    },
    token(): string { if (!saved?.accountKey || state === "revoked") throw new Error("Bridge backend approval is required"); return saved.token; },
    refresh,
    async requestApproval() { return exclusive(async () => {
      if (state !== "needs-approval") throw new Error("This device is not waiting for approval");
      await request("/v1/approvals", {}); error = null; await update(); notify();
    }); },
    async approve(input: { requestId: string; backendId: string; publicKey: string; code: string }) { return exclusive(async () => {
      if (closed || cancelling) throw new Error("Sign-in was cancelled");
      if (!saved?.accountKey || state !== "ready") throw new Error("Backend approval is required");
      const supplied = normalizeBridgeVerificationCode(input.code), expected = await bridgeApprovalCode(input.publicKey);
      if (supplied !== expected) throw new Error("The approval codes do not match");
      const pending = requests.find((entry) => entry.requestId === input.requestId);
      if (!pending || pending.backendId !== input.backendId || pending.publicKey !== input.publicKey || Date.parse(pending.expiresAt) <= Date.now())
        throw new Error("Approval expired or changed; compare the current pending request again");
      const key = bridgeBytes(saved.accountKey, 32);
      try { await request("/v1/keys/wraps", { requestId: pending.requestId, backendId: pending.backendId, publicKey: pending.publicKey,
        code: expected, wrap: sealBridgeAccountKey(key, bridgeBytes(pending.publicKey, 32)) }); }
      finally { key.fill(0); }
      await update(); notify();
    }); },
    async confirmAccountKey(fingerprint: string) { return exclusive(async () => {
      if (closed || cancelling) throw new Error("Sign-in was cancelled");
      if (!saved?.pendingAccountKey || saved.accountKey || state !== "needs-verification") throw new Error("No account key is waiting for verification");
      const supplied = normalizeBridgeVerificationCode(fingerprint), key = bridgeBytes(saved.pendingAccountKey, 32);
      try {
        if (supplied !== bridgeAccountFingerprint(key)) throw new Error("Account fingerprints do not match; do not enable sync");
        await activate(key, bridgeRecoveryPublicKey(key));
      } finally { key.fill(0); }
    }); },
    async reject(requestId: string) { return exclusive(async () => { await request(`/v1/approvals/${encodeURIComponent(requestId)}`, undefined, "DELETE"); await update(); notify(); }); },
    async revoke(backendId: string) { return exclusive(async () => {
      await request(`/v1/backends/${encodeURIComponent(backendId)}`, undefined, "DELETE");
      if (backendId === options.backendId && saved) { saved.accountKey = null; saved.pendingAccountKey = null; saved.pendingToken = null; accountFingerprint = null; await vault.write(saved); state = "revoked"; activated = false; await options.revoked(); }
      else await update(); notify();
    }); },
    async enterRecoveryCode(value: string) { return exclusive(async () => {
      if (!saved || state !== "needs-approval" && state !== "needs-verification") throw new Error("Sign in on the new backend first");
      const keys = await request<BridgeAccountKeys>("/v1/keys/recovery"), key = await openBridgeRecovery(keys.recovery, value);
      try {
        if (bridgeRecoveryPublicKey(key) !== keys.recoveryPublicKey) throw new Error("Recovery key does not match the account");
        if (state === "needs-verification") { await activate(key, bridgeRecoveryPublicKey(key)); await update(); notify(); return; }
        const wrap = sealBridgeAccountKey(key, bridgeBytes(saved.publicKey, 32)), { challenge } = await request<{ challenge: string }>("/v1/keys/recovery/challenge", {});
        const signature = signBridgeRecovery(key, saved.accountId, options.backendId, saved.publicKey, challenge, wrap);
        await request("/v1/keys/recovery/unlock", { wrap, signature, challenge });
        // Recovery authenticates the locally decrypted key, never a subsequent hub wrap.
        await activate(key, bridgeRecoveryPublicKey(key)); await update(); notify();
      } finally { key.fill(0); }
    }); },
    takeRecoveryCode() { if (closed || cancelling || state !== "ready") return null; const result = recoveryCode; recoveryCode = null; notify(); return result; },
    async regenerateRecoveryCode() { return exclusive(async () => {
      if (!saved?.accountKey) throw new Error("Backend approval is required");
      const generated = generateBridgeRecoveryCode(), key = bridgeBytes(saved.accountKey, 32);
      try { await request("/v1/keys/recovery", { recovery: await sealBridgeRecovery(key, generated), recoveryPublicKey: bridgeRecoveryPublicKey(key) }, "PUT"); recoveryCode = null; notify(); return generated; }
      finally { key.fill(0); }
    }); },
    async signOut(logout: { skipRevoke?: boolean } = {}) {
      epoch++; cancelling = true; if (timer) clearTimeout(timer); stopLogin?.(); stopLogin = undefined; deviceCode = null; login = null;
      return exclusive(async () => {
        try {
          epoch++;
          if (!logout.skipRevoke && saved && state !== "revoked" && saved.expiresAt > Date.now()) {
            try { await request(`/v1/backends/${encodeURIComponent(options.backendId)}`, undefined, "DELETE"); }
            catch (failure) { if (!(failure instanceof BridgeHttpError && failure.status === 401)) throw failure; }
          }
          await options.revoked(); await vault.remove(); saved = null; recoveryCode = null; accountFingerprint = null; activated = false;
          if (timer) clearTimeout(timer);
          requests = []; backends = []; error = null; state = "signed-out"; notify();
        } finally { cancelling = false; if (saved) schedule(); }
      });
    },
    async stop() { closed = true; epoch++; if (timer) clearTimeout(timer); stopLogin?.(); await operations; saved = null; recoveryCode = null; accountFingerprint = null; },
  };
  return api;
}
export type BridgeIdentityClient = ReturnType<typeof createBridgeIdentity>;
