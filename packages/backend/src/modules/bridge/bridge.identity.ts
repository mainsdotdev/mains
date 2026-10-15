import { hostname } from "node:os";
import { x25519 } from "@noble/curves/ed25519.js";
import { bridgeApprovalCode, bridgeBase64, bridgeBytes, type BridgeApprovalRequest, type BridgeAuthStatus, type BridgeRegisteredBackend,
  type BridgeSignInInput, type BridgeSealedAccountKey, type BridgeAccountKeys } from "@mains/contracts/bridge-auth";
import type { SecretStorageAdapter } from "../../runtime/backend-runtime";
import { createBridgeIdentityStorage, type BridgeSavedIdentity } from "./bridge.identity-storage";
import { generateBridgeAccountKey, generateBridgeDeviceKeyPair, openBridgeAccountKey, sealBridgeAccountKey } from "./bridge.keys";
import { bridgeRecoveryPublicKey, generateBridgeRecoveryCode, openBridgeRecovery, sealBridgeRecovery, signBridgeRecovery } from "./bridge.recovery";
import { bridgeHttp, bridgeHubUrl, BridgeHttpError, pollBridgeDeviceLogin, startBridgeDeviceLogin, startBridgeLoopback } from "./bridge.login";
import type { BridgeDevConfig } from "./bridge.config";

type Mine = { accountId: string; initialized: boolean; backend: BridgeRegisteredBackend; wrap: BridgeSealedAccountKey | null; recoveryPublicKey: string | null; approval: { status: string; expires_at: number } | null };
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
  let login: BridgeAuthStatus["login"] = null, timer: ReturnType<typeof setTimeout> | undefined, closed = false, running: Promise<void> | undefined;
  let stopLogin: (() => void) | undefined, deviceCode: string | null = null, interval = 5000, epoch = 0, activated = false;
  let requests: BridgeApprovalRequest[] = [], backends: BridgeRegisteredBackend[] = [];
  let operations: Promise<unknown> = Promise.resolve(), cancelling = false;
  function exclusive<T>(action: () => Promise<T>): Promise<T> {
    const next = operations.then(action); operations = next.catch(() => {}); return next;
  }
  const notified = new Set<string>();
  const notify = () => { if (!closed) options.changed(); };
  const schedule = (ms = 5000) => { if (closed || cancelling || !saved && !deviceCode) return; if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = undefined; void refresh(); }, ms); timer.unref(); };
  async function request<T>(path: string, body?: unknown, method?: string): Promise<T> {
    if (!saved) throw new Error("Sign in to Bridge first");
    return bridgeHttp<T>(saved.hubUrl, path, saved.token, body, method);
  }
  function config(): BridgeDevConfig {
    if (!saved?.accountKey) throw new Error("Backend approval is required");
    return { url: new URL("/v1/log", saved.hubUrl).toString().replace(/^http/, "ws"), token: saved.token,
      accountKey: bridgeBytes(saved.accountKey, 32), backendId: options.backendId, label: saved.label };
  }
  async function activate(key: Uint8Array, publicVerifier: string) {
    if (!saved || closed || cancelling) throw new Error("Sign-in was cancelled");
    if (bridgeRecoveryPublicKey(key) !== publicVerifier) throw new Error("The approved account key does not match this account");
    saved.accountKey = bridgeBase64(key); await vault.write(saved);
    if (closed || cancelling) return;
    if (!activated) {
      const value = config();
      try { await options.ready(value, saved.includeExisting, saved.activationPending, saved.accountId); activated = true; saved.includeExisting = true; saved.activationPending = false; await vault.write(saved); }
      finally { value.accountKey.fill(0); }
    }
    state = "ready"; error = null; login = null; deviceCode = null; stopLogin = undefined; notify();
  }
  async function update() {
    if (!saved || closed || cancelling) return;
    const mine = await request<Mine>("/v1/keys/mine");
    if (mine.backend.publicKey !== saved.publicKey) throw new Error("Backend public key changed; sign in again");
    if (mine.backend.status === "approved" && mine.wrap && mine.recoveryPublicKey) {
      if (!activated || !saved.accountKey) {
        const secret = bridgeBytes(saved.privateKey, 32), key = openBridgeAccountKey(mine.wrap, secret);
        try { await activate(key, mine.recoveryPublicKey); } finally { secret.fill(0); key.fill(0); }
      } else { state = "ready"; error = null; }
      if (saved.expiresAt - Date.now() < 7 * 24 * 60 * 60 * 1000) {
        const next = await request<{ token: string; expiresAt: number }>("/v1/backends/refresh", {});
        saved.token = next.token; saved.expiresAt = next.expiresAt; await vault.write(saved);
      }
      [requests, backends] = await Promise.all([request<BridgeApprovalRequest[]>("/v1/approvals"), request<BridgeRegisteredBackend[]>("/v1/backends")]);
      for (const entry of requests) if (!notified.has(entry.requestId)) { notified.add(entry.requestId); options.approval(entry); }
      return;
    }
    login = null;
    if (!mine.initialized) {
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
  async function refresh() {
    if (closed) return;
    if (running) return running;
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
          state = "revoked"; saved.accountKey = null; await vault.write(saved); await options.revoked(); activated = false;
          error = "Backend access expired or was revoked; sign out and sign in again";
        } else { error = failure instanceof Error ? failure.message : "Bridge sign-in failed"; if (!saved) state = "error"; }
      } finally { if (generation === epoch && !closed) { notify(); schedule(state === "signing-in" ? interval : 5000); } }
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
        label, verificationCode: state === "needs-approval" ? code : null, login, approvals: requests, backends, recoveryCodeAvailable: recoveryCode !== null, error };
    },
    token(): string { if (!saved?.accountKey || state === "revoked") throw new Error("Bridge backend approval is required"); return saved.token; },
    refresh,
    async requestApproval() { return exclusive(async () => { await request("/v1/approvals", {}); error = null; await update(); notify(); }); },
    async approve(input: { requestId: string; backendId: string; publicKey: string; code: string }) { return exclusive(async () => {
      if (!saved?.accountKey) throw new Error("Backend approval is required");
      const key = bridgeBytes(saved.accountKey, 32);
      try { await request("/v1/keys/wraps", { ...input, wrap: sealBridgeAccountKey(key, bridgeBytes(input.publicKey, 32)) }); }
      finally { key.fill(0); }
      await update(); notify();
    }); },
    async reject(requestId: string) { return exclusive(async () => { await request(`/v1/approvals/${encodeURIComponent(requestId)}`, undefined, "DELETE"); await update(); notify(); }); },
    async revoke(backendId: string) { return exclusive(async () => {
      await request(`/v1/backends/${encodeURIComponent(backendId)}`, undefined, "DELETE");
      if (backendId === options.backendId && saved) { saved.accountKey = null; await vault.write(saved); state = "revoked"; activated = false; await options.revoked(); }
      else await update(); notify();
    }); },
    async enterRecoveryCode(value: string) { return exclusive(async () => {
      if (!saved || state !== "needs-approval") throw new Error("Sign in on the new backend first");
      const keys = await request<BridgeAccountKeys>("/v1/keys/recovery"), key = await openBridgeRecovery(keys.recovery, value);
      try {
        if (bridgeRecoveryPublicKey(key) !== keys.recoveryPublicKey) throw new Error("Recovery key does not match the account");
        const wrap = sealBridgeAccountKey(key, bridgeBytes(saved.publicKey, 32)), { challenge } = await request<{ challenge: string }>("/v1/keys/recovery/challenge", {});
        const signature = signBridgeRecovery(key, saved.accountId, options.backendId, saved.publicKey, challenge, wrap);
        await request("/v1/keys/recovery/unlock", { wrap, signature, challenge }); await update(); notify();
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
          await options.revoked(); await vault.remove(); saved = null; recoveryCode = null; activated = false;
          if (timer) clearTimeout(timer);
          requests = []; backends = []; error = null; state = "signed-out"; notify();
        } finally { cancelling = false; if (saved) schedule(); }
      });
    },
    async stop() { closed = true; epoch++; if (timer) clearTimeout(timer); stopLogin?.(); await operations; saved = null; recoveryCode = null; },
  };
  return api;
}
export type BridgeIdentityClient = ReturnType<typeof createBridgeIdentity>;
