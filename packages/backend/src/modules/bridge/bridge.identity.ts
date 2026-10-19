import { hostname } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { bridgeApprovalCode, bridgeBase64, bridgeBytes, normalizeBridgeVerificationCode, type BridgeApprovalRequest, type BridgeAuthStatus, type BridgeJoinCode,
  type BridgeRegisteredBackend, type BridgeSignInInput, type BridgeSealedAccountKey, type BridgeAccountKeys } from "@mains/contracts/bridge-auth";
import { applyBridgeMembershipEntry, bridgeMember, bridgeMembershipEntryHash, currentBridgeMembers, extendBridgeMembership, verifyBridgeMembershipLog, type BridgeMember,
  type BridgeMembershipChange, type BridgeMembershipEntry, type BridgeMembershipHead, type BridgeMembershipSigner, type BridgeMembershipState } from "@mains/contracts/bridge-membership";
import type { SecretStorageAdapter } from "../../runtime/backend-runtime";
import { createBridgeIdentityStorage, createBridgeMembershipStorage, type BridgeSavedIdentity } from "./bridge.identity-storage";
import { bridgeAccountKeyCommitment, bridgeJoinCode, generateBridgeAccountKey, generateBridgeDeviceKeyPair, generateBridgeSigningKeyPair, openBridgeAccountKey, sealBridgeAccountKey } from "./bridge.keys";
import { generateBridgeRecoveryCode, openBridgeRecovery, sealBridgeRecovery } from "./bridge.recovery";
import { bridgeHttp, bridgeHubUrl, BridgeHttpError, pollBridgeDeviceLogin, startBridgeDeviceLogin, startBridgeLoopback } from "./bridge.login";
import { bridgeMembershipConflict, createBridgeMembershipView, deviceSigner, fetchBridgeMembership, pullBridgeAccountFence, signBridgeMembershipEntry, verifyBridgeSignature,
  type BridgeRemovalFence, type BridgeVerifiedMembership } from "./bridge.membership";
import type { BridgeDevConfig } from "./bridge.config";

const sameMember = (a: BridgeMember | undefined, b: BridgeMember) =>
  !!a && a.backendId === b.backendId && a.publicKey === b.publicKey && a.signingPublicKey === b.signingPublicKey;
/** The hub refused an entry signed on a head that moved; re-sign on the new head. */
const membershipMoved = (failure: unknown) => failure instanceof BridgeHttpError && failure.status === 409 && /membership changed/i.test(failure.message);

type Mine = { accountId: string; initialized: boolean; backend: BridgeRegisteredBackend; wrap: BridgeSealedAccountKey | null; recoveryPublicKey: string | null; approval: { status: string; expires_at: number } | null; tokenRenewal?: string };
export interface BridgeIdentityOptions {
  backendId: string; dataDir: string; storage: SecretStorageAdapter; kind: "electron" | "node";
  openExternal(url: string): Promise<unknown>;
  ready(config: BridgeDevConfig, includeExisting: boolean, firstEnrollment: boolean, accountId: string): Promise<void>;
  changed(): void;
  approval(request: BridgeApprovalRequest): void;
  revoked(): Promise<void>;
  /** Reads the account stream for a removal's fence; defaults to a short-lived connection to the hub. */
  accountFence?(backendId: string): Promise<BridgeRemovalFence>;
}
/** Identity/key state owns no SQLite and has no renderer-facing credential getter. */
export function createBridgeIdentity(options: BridgeIdentityOptions) {
  const vault = createBridgeIdentityStorage(options.dataDir, options.storage);
  const membershipFiles = createBridgeMembershipStorage(options.dataDir);
  let saved: BridgeSavedIdentity | null = null, state: BridgeAuthStatus["state"] = "signed-out", error: string | null = null;
  let hub: string | null = null, label = hostname(), code: string | null = null, recoveryCode: string | null = null;
  /** Verified from a pinned head; never trusted from the hub alone. */
  let membership: BridgeVerifiedMembership | null = null;
  let joinCodes: BridgeJoinCode[] = [];
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
  const self = (): BridgeMember => ({ backendId: options.backendId, publicKey: saved!.publicKey, signingPublicKey: saved!.signingPublicKey });
  async function fetchMembership(after: number) {
    if (!saved) throw new Error("Sign in to Bridge first");
    return (await fetchBridgeMembership(saved.hubUrl, saved.token, after)).entries;
  }
  /** The account's whole log from the hub, verified from genesis; `anchor` must be part of it. */
  async function verifiedRemote(anchor?: BridgeMembershipHead) {
    const entries = await fetchMembership(-1);
    return { state: await verifyBridgeMembershipLog(entries, verifyBridgeSignature, anchor), entries };
  }
  function computeJoinCodes() {
    joinCodes = [];
    if (!saved?.accountKey || !membership) return;
    const key = bridgeBytes(saved.accountKey, 32);
    try {
      for (const member of currentBridgeMembers(membership.state)) {
        const admitted = membership.entries[member.from];
        if (member.backendId === options.backendId || admitted?.kind !== "add" || admitted.body.via !== "approval") continue;
        joinCodes.push({ backendId: member.backendId, label: backends.find((entry) => entry.backendId === member.backendId)?.label ?? member.backendId,
          code: bridgeJoinCode(key, saved.accountId, member.backendId, membership.state.hashes[member.from]) });
      }
    } finally { key.fill(0); }
  }
  /** Persists verified entries first, then advances the pinned head, so the copy is never behind it. */
  async function pinMembership(next: BridgeMembershipState, entries: BridgeMembershipEntry[]) {
    membership = { state: next, entries };
    await membershipFiles.write(saved!.accountId, entries);
    if (saved!.membership?.seq !== next.seq || saved!.membership.hash !== next.head) { saved!.membership = { seq: next.seq, hash: next.head }; await vault.write(saved!); }
    computeJoinCodes();
  }
  /** Loads the pinned log (local copy, else the hub), then extends it with the hub's newer entries.
   * Any history that does not contain the pinned head is a membership conflict, never a reset. */
  async function syncMembership(offline = false): Promise<BridgeMembershipState> {
    if (!saved?.membership) throw new Error("Bridge account membership is not pinned on this backend");
    if (!membership) {
      const local = await membershipFiles.read(saved.accountId);
      if (local) try { membership = { state: await verifyBridgeMembershipLog(local, verifyBridgeSignature, saved.membership), entries: local as BridgeMembershipEntry[] }; } catch { membership = null; }
      if (!membership && offline) throw new Error("Bridge account membership is unavailable offline");
      if (!membership) {
        try { membership = await verifiedRemote(saved.membership); }
        catch (failure) { throw bridgeMembershipConflict(failure); }
        await membershipFiles.write(saved.accountId, membership.entries);
      }
      computeJoinCodes();
    }
    if (offline) return membership.state;
    const more = await fetchMembership(membership.state.seq);
    if (more.length) {
      let next: BridgeMembershipState;
      try { next = await extendBridgeMembership(membership.state, more, verifyBridgeSignature); }
      catch (failure) { throw bridgeMembershipConflict(failure); }
      await pinMembership(next, [...membership.entries, ...more]);
    }
    return membership.state;
  }
  /** Signs `change` on the newest verified head and sends it, re-signing if another change lands first.
   * `read` supplies that head; without a log there is nothing to sign. */
  async function changeMembership(change: (state: BridgeMembershipState) => BridgeMembershipChange | null | Promise<BridgeMembershipChange | null>,
    send: (entry: BridgeMembershipEntry | undefined) => Promise<unknown>, refreshAfter = true, read: () => Promise<BridgeMembershipState | null> = syncMembership) {
    for (let attempt = 0; ; attempt++) {
      const current = await read(), wanted = current && await change(current);
      const secret = bridgeBytes(saved!.signingPrivateKey, 32);
      let entry: BridgeMembershipEntry | undefined;
      try { entry = wanted ? signBridgeMembershipEntry(current!, wanted, deviceSigner(self()), secret) : undefined; } finally { secret.fill(0); }
      try { await send(entry); break; }
      catch (failure) { if (!membershipMoved(failure) || attempt >= 2) throw failure; }
    }
    // A backend that removed itself no longer has access to read the result.
    if (refreshAfter) await syncMembership();
  }
  function accountFence(backendId: string) {
    if (options.accountFence) return options.accountFence(backendId);
    return pullBridgeAccountFence(new URL("/v1/log", saved!.hubUrl).toString().replace(/^http/, "ws"), saved!.token, backendId);
  }
  /** Removes a member with the fence of its account records, read again on every attempt: the hub derives
   * the list from what it stores and refuses a removal whose fence no longer matches it. Keys its
   * registration holds leave with that registration; keys no registration holds any more (it re-enrolled
   * with new ones) leave through the membership route, apart from any newer registration. */
  async function removeMember(backendId: string, refreshAfter = true, via: "registration" | "membership" = "registration", read?: () => Promise<BridgeMembershipState | null>) {
    await changeMembership(async (current) => {
      if (!bridgeMember(current, backendId)) return null;
      return { kind: "remove", body: { backendId, account: (await accountFence(backendId)).account } };
    }, async (entry) => {
      if (via === "membership") { if (entry) await request("/v1/membership", { entry }); }
      else await request(`/v1/backends/${encodeURIComponent(backendId)}`, entry ? { entry } : undefined, "DELETE");
    }, refreshAfter, read);
  }
  /** This backend leaving. Before it pins a head (its join code not yet entered, or its bootstrap reply lost)
   * the log may already admit it, and then only its own signed, fenced removal revokes it. It signs on the
   * hub's current log, verified from the entry that admitted it when it has one; a registration whose keys
   * the log never admitted is revoked by credential alone. */
  function removeSelf() {
    if (saved!.accountKey && saved!.membership) return removeMember(options.backendId, false);
    const anchor = saved!.pendingMembership ?? undefined;
    return removeMember(options.backendId, false, "registration", async () => {
      const entries = await fetchMembership(-1), state = entries.length ? await verifyBridgeMembershipLog(entries, verifyBridgeSignature, anchor) : null;
      // Keys an earlier registration of this backend left in the log are not this registration's to remove.
      return state && sameMember(bridgeMember(state, options.backendId), self()) ? state : null;
    });
  }
  /** Replication extends its own copy without waiting on this queue; its verified progress is pinned here. */
  async function adoptMembership(next: BridgeVerifiedMembership) {
    if (!saved?.accountKey || !membership || next.state.accountId !== saved.accountId || next.state.seq <= membership.state.seq ||
        next.state.hashes[membership.state.seq] !== membership.state.head) return;
    await pinMembership(next.state, next.entries);
  }
  function config(): BridgeDevConfig {
    if (!saved?.accountKey || !membership) throw new Error("Backend approval is required");
    return { url: new URL("/v1/log", saved.hubUrl).toString().replace(/^http/, "ws"), token: saved.token,
      accountKey: bridgeBytes(saved.accountKey, 32), backendId: options.backendId, label: saved.label,
      accountId: saved.accountId, signingPrivateKey: bridgeBytes(saved.signingPrivateKey, 32),
      membership: createBridgeMembershipView({ hubUrl: saved.hubUrl, token: async () => api.token(), accountId: saved.accountId,
        accountKeyCommitment: membership.state.accountKeyCommitment, initial: membership,
        extended: (next) => { void exclusive(() => adoptMembership(next)).catch(() => {}); } }) };
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
  /** Requires verified membership from a pinned head; the key must match its genesis commitment. */
  async function activate(key: Uint8Array) {
    if (!saved || closed || cancelling) throw new Error("Sign-in was cancelled");
    if (!membership || bridgeAccountKeyCommitment(key) !== membership.state.accountKeyCommitment) throw new Error("The approved account key does not match this account");
    saved.accountKey = bridgeBase64(key); saved.pendingAccountKey = null; saved.pendingMembership = null; saved.accountInitialized = true;
    await vault.write(saved); computeJoinCodes();
    if (closed || cancelling) return;
    if (!activated) {
      const value = config();
      try { await options.ready(value, saved.includeExisting, saved.activationPending, saved.accountId); activated = true; saved.includeExisting = true; saved.activationPending = false; await vault.write(saved); }
      finally { value.accountKey.fill(0); value.signingPrivateKey.fill(0); }
    }
    state = "ready"; error = null; login = null; deviceCode = null; stopLogin = undefined; schedule(); notify();
  }
  /** Initializes the account from a proposal saved before it is first sent. A lost reply is then resent
   * unchanged, or found accepted (`accepted`: the hub approved this backend), and never strands the account's
   * only key and recovery code on the hub. */
  async function bootstrap(accepted: boolean) {
    if (!saved!.pendingBootstrap) {
      const key = generateBridgeAccountKey(), code = generateBridgeRecoveryCode(), secret = bridgeBytes(saved!.signingPrivateKey, 32);
      try {
        const recovery = await sealBridgeRecovery(key, code);
        const entry = signBridgeMembershipEntry({ accountId: saved!.accountId, seq: -1, head: null }, { kind: "genesis", body: { member: self(),
          recoverySigningPublicKey: recovery.signingPublicKey, accountKeyCommitment: bridgeAccountKeyCommitment(key) } }, deviceSigner(self()), secret);
        if (closed || cancelling) return;
        const proposed = { ...saved!, pendingBootstrap: { accountKey: bridgeBase64(key), recoveryCode: code,
          wrap: sealBridgeAccountKey(key, bridgeBytes(saved!.publicKey, 32)), recovery: recovery.wrap, entry } };
        // Persist before contacting the hub, including before a request whose reply is lost.
        await vault.write(proposed); saved = proposed;
      } finally { key.fill(0); secret.fill(0); }
    }
    const proposal = saved!.pendingBootstrap!;
    if (closed || cancelling) return;
    // The log must start with exactly the proposed genesis, which only this backend could sign.
    const genesis = await applyBridgeMembershipEntry(null, proposal.entry, verifyBridgeSignature);
    if (!accepted) {
      try { await request("/v1/keys/bootstrap", { wrap: proposal.wrap, recovery: proposal.recovery, entry: proposal.entry }); }
      catch (failure) {
        if (!(failure instanceof BridgeHttpError && failure.status === 409)) throw failure;
        // A retry is refused too once its own earlier attempt has completed in the meantime. Only another
        // backend's genesis rules this proposal out; with its own, it activates once the hub approves it.
        const [first] = await fetchMembership(-1);
        if (first && await bridgeMembershipEntryHash(first as BridgeMembershipEntry) !== genesis.head) {
          const declined = { ...saved!, pendingBootstrap: null }; await vault.write(declined); saved = declined;
          return;
        }
        if ((await request<Mine>("/v1/keys/mine")).backend.status !== "approved") throw failure;
      }
    }
    const remote = await verifiedRemote({ seq: 0, hash: genesis.head }), key = bridgeBytes(proposal.accountKey, 32);
    try {
      await pinMembership(remote.state, remote.entries);
      recoveryCode = proposal.recoveryCode; saved!.pendingBootstrap = null;
      await activate(key);
    } finally { key.fill(0); }
    // Read devices and requests now rather than at the next scheduled refresh; that refresh retries a failure.
    if (saved?.accountKey) await update().catch(() => {});
  }
  async function update() {
    if (!saved || closed || cancelling) return;
    if (saved.pendingToken) await renewToken();
    const mine = await request<Mine>("/v1/keys/mine");
    if (mine.accountId !== saved.accountId || mine.backend.backendId !== options.backendId || mine.backend.publicKey !== saved.publicKey || mine.backend.signingPublicKey !== saved.signingPublicKey)
      throw new Error("Backend identity changed; sign in again");
    if (typeof mine.initialized !== "boolean") throw new Error("Invalid Bridge account initialization state");
    if (mine.initialized && !saved.accountInitialized) { saved.accountInitialized = true; await vault.write(saved); }
    if (saved.accountKey) {
      // A locally trusted key is never replaced by a hub-provided wrap/verifier.
      if (mine.backend.status !== "approved") throw new Error("Backend approval changed; sign in again");
      const members = await syncMembership();
      if (!sameMember(bridgeMember(members, options.backendId), self())) throw new Error("This backend was removed from the account; sign out and sign in again");
      if (!activated) {
        const key = bridgeBytes(saved.accountKey, 32);
        try { await activate(key); } finally { key.fill(0); }
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
        return { ...entry, code: await bridgeApprovalCode({ ...entry, accountId: saved!.accountId }) };
      }));
      requests = verified.filter((entry) => Date.parse(entry.expiresAt) > Date.now()); backends = devices; computeJoinCodes();
      for (const entry of requests) if (!notified.has(entry.requestId)) { notified.add(entry.requestId); options.approval(entry); }
      return;
    }
    // A proposal whose reply was lost is resent unchanged, or found accepted, before anything else.
    if (saved.pendingBootstrap) { login = null; await bootstrap(mine.backend.status === "approved"); return; }
    if (mine.backend.status === "approved") {
      if (!mine.wrap) throw new Error("Approved account key is unavailable");
      const secret = bridgeBytes(saved.privateKey, 32);
      try {
        const key = openBridgeAccountKey(mine.wrap, secret);
        try {
          // Pin the entry that admitted exactly these keys; the join code from the approver covers it.
          const remote = await verifiedRemote(), admitted = bridgeMember(remote.state, options.backendId);
          if (!sameMember(admitted, self())) throw new Error("The account membership does not include this backend yet");
          if (bridgeAccountKeyCommitment(key) !== remote.state.accountKeyCommitment) throw new Error("The offered account key does not match the account");
          const encoded = bridgeBase64(key), head = { seq: admitted!.from, hash: remote.state.hashes[admitted!.from] };
          if (saved.pendingAccountKey && (saved.pendingAccountKey !== encoded || saved.pendingMembership?.hash !== head.hash))
            throw new Error("Account key or membership changed during verification; disconnect and try again");
          if (!saved.pendingAccountKey) { saved.pendingAccountKey = encoded; saved.pendingMembership = head; await vault.write(saved); }
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
      await bootstrap(false);
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
    const pair = generateBridgeDeviceKeyPair(), signing = generateBridgeSigningKeyPair();
    const publicKey = bridgeBase64(pair.publicKey), signingPublicKey = bridgeBase64(signing.publicKey);
    try {
      const registered = await bridgeHttp<{ accountId: string; email: string; token: string; expiresAt: number; backend: BridgeRegisteredBackend }>(hub!, "/v1/backends", token,
        { backendId: options.backendId, publicKey, signingPublicKey, label, platform: process.platform });
      if (generation !== epoch || closed) {
        await bridgeHttp(hub!, `/v1/backends/${encodeURIComponent(options.backendId)}`, registered.token, undefined, "DELETE").catch(() => {});
        return;
      }
      try {
        if (registered.backend.backendId !== options.backendId || registered.backend.publicKey !== publicKey || registered.backend.signingPublicKey !== signingPublicKey)
          throw new Error("Registered Bridge device keys changed");
        const candidate: BridgeSavedIdentity = { v: 3, backendId: options.backendId, hubUrl: hub!, label, accountId: registered.accountId, email: registered.email,
          publicKey, privateKey: bridgeBase64(pair.secretKey), signingPublicKey, signingPrivateKey: bridgeBase64(signing.secretKey), token: registered.token, expiresAt: registered.expiresAt,
          accountKey: null, includeExisting: input.includeExisting, activationPending: true };
        await vault.write(candidate); saved = candidate;
      } catch (failure) {
        // Use the issued device credential and the requested id, never a
        // substituted response id or the browser session, to revoke this attempt.
        await bridgeHttp(hub!, `/v1/backends/${encodeURIComponent(options.backendId)}`, registered.token, undefined, "DELETE").catch(() => {});
        throw failure;
      }
      code = await bridgeApprovalCode(saved); state = "signing-in"; login = null; deviceCode = null;
      await update(); schedule();
    } finally {
      pair.secretKey.fill(0); signing.secretKey.fill(0);
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
          state = "revoked"; saved.accountKey = null; saved.pendingAccountKey = null; saved.pendingMembership = null; saved.pendingToken = null; joinCodes = []; await vault.write(saved); await options.revoked(); activated = false;
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
      // The hub was reset with the membership log, so an identity from before it can only be replaced.
      if (!saved) { if (vault.superseded) { error = "Bridge was reset in this version of Mains. Sign in again to sync this backend."; notify(); } return; }
      if (saved.backendId !== options.backendId) throw new Error("Bridge identity does not match this backend");
      hub = bridgeHubUrl(saved.hubUrl); label = saved.label; code = await bridgeApprovalCode(saved);
      // A stored key can read the local replica offline once its pinned membership verifies from the
      // local copy; network access is still checked by the hub and stops on a revoked response.
      if (saved.accountKey) {
        try { await syncMembership(true); } catch { membership = null; }
        if (membership) { const key = bridgeBytes(saved.accountKey, 32); try { await activate(key); } finally { key.fill(0); } }
        else state = "signing-in"; // The first update verifies the pinned history from the hub, then activates.
      }
      else if (saved.pendingAccountKey) state = "needs-verification";
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
        joinCodes: state === "ready" ? joinCodes : [], login, approvals: requests, backends, recoveryCodeAvailable: recoveryCode !== null, error };
    },
    token(): string { if (!saved?.accountKey || state === "revoked") throw new Error("Bridge backend approval is required"); return saved.token; },
    refresh,
    async requestApproval() { return exclusive(async () => {
      if (state !== "needs-approval") throw new Error("This device is not waiting for approval");
      await request("/v1/approvals", {}); error = null; await update(); notify();
    }); },
    async approve(input: Pick<BridgeApprovalRequest, "requestId" | "backendId" | "publicKey" | "signingPublicKey" | "code">) { return exclusive(async () => {
      if (closed || cancelling) throw new Error("Sign-in was cancelled");
      if (!saved?.accountKey || state !== "ready") throw new Error("Backend approval is required");
      const supplied = normalizeBridgeVerificationCode(input.code), expected = await bridgeApprovalCode({ ...input, accountId: saved.accountId });
      if (supplied !== expected) throw new Error("The approval codes do not match");
      const pending = requests.find((entry) => entry.requestId === input.requestId);
      if (!pending || pending.backendId !== input.backendId || pending.publicKey !== input.publicKey || pending.signingPublicKey !== input.signingPublicKey || Date.parse(pending.expiresAt) <= Date.now())
        throw new Error("Approval expired or changed; compare the current pending request again");
      const member: BridgeMember = { backendId: pending.backendId, publicKey: pending.publicKey, signingPublicKey: pending.signingPublicKey };
      // A backend that re-enrolled with new keys while its old ones are still admitted replaces them:
      // the old keys are removed with their fence first, which leaves the new registration pending.
      const previous = membership && bridgeMember(membership.state, member.backendId);
      if (previous && !sameMember(previous, member)) await removeMember(member.backendId, true, "membership");
      const key = bridgeBytes(saved.accountKey, 32);
      try {
        // A retry after a lost response finds the addition already in the log and only releases the wrap.
        await changeMembership((current) => sameMember(bridgeMember(current, member.backendId), member) ? null : { kind: "add", body: { member, via: "approval" } },
          (entry) => request("/v1/keys/wraps", { requestId: pending.requestId, ...member, code: expected, wrap: sealBridgeAccountKey(key, bridgeBytes(member.publicKey, 32)), ...(entry ? { entry } : {}) }));
      } finally { key.fill(0); }
      await update(); notify();
    }); },
    /** Confirms the join code shown by the approving device, which binds the offered key to the exact
     * membership entry that admitted this backend. */
    async confirmAccountKey(joinCode: string) { return exclusive(async () => {
      if (closed || cancelling) throw new Error("Sign-in was cancelled");
      if (!saved?.pendingAccountKey || !saved.pendingMembership || saved.accountKey || state !== "needs-verification") throw new Error("No account key is waiting for verification");
      const supplied = normalizeBridgeVerificationCode(joinCode), key = bridgeBytes(saved.pendingAccountKey, 32);
      try {
        if (supplied !== bridgeJoinCode(key, saved.accountId, options.backendId, saved.pendingMembership.hash)) throw new Error("Join codes do not match; do not enable sync");
        const remote = await verifiedRemote(saved.pendingMembership);
        await pinMembership(remote.state, remote.entries);
        await activate(key);
      } finally { key.fill(0); }
      // Read devices and requests now rather than at the next scheduled refresh; that refresh retries a failure.
      await update().catch(() => {}); notify();
    }); },
    async reject(requestId: string) { return exclusive(async () => { await request(`/v1/approvals/${encodeURIComponent(requestId)}`, undefined, "DELETE"); await update(); notify(); }); },
    async revoke(backendId: string) { return exclusive(async () => {
      const path = `/v1/backends/${encodeURIComponent(backendId)}`, leaving = backendId === options.backendId;
      if (saved?.accountKey && saved.membership) {
        // A registration holding the member's keys leaves with a signed removal. Otherwise the backend
        // re-enrolled with new keys: its old keys leave the log, and its newer registration is revoked by
        // credential, each on its own.
        const member = bridgeMember(await syncMembership(), backendId);
        const registration = (await request<BridgeRegisteredBackend[]>("/v1/backends")).find((entry) => entry.backendId === backendId);
        if (member && registration?.signingPublicKey === member.signingPublicKey) await removeMember(backendId, !leaving);
        else {
          if (member) await removeMember(backendId, true, "membership");
          if (registration && registration.status !== "revoked") await request(path, undefined, "DELETE");
        }
      }
      else if (leaving) await removeSelf();
      else await request(path, undefined, "DELETE");
      if (leaving && saved) { saved.accountKey = null; saved.pendingAccountKey = null; saved.pendingMembership = null; saved.pendingToken = null; joinCodes = []; await vault.write(saved); state = "revoked"; activated = false; await options.revoked(); }
      else await update(); notify();
    }); },
    async enterRecoveryCode(value: string) { return exclusive(async () => {
      if (!saved || state !== "needs-approval" && state !== "needs-verification") throw new Error("Sign in on the new backend first");
      const keys = await request<BridgeAccountKeys>("/v1/keys/recovery"), opened = await openBridgeRecovery(keys.recovery, value);
      try {
        // With no member to compare against, recovery trusts the newest history the hub presents.
        let remote = await verifiedRemote();
        if (bridgeAccountKeyCommitment(opened.accountKey) !== remote.state.accountKeyCommitment) throw new Error("Recovery key does not match the account");
        if (opened.signingPublicKey !== remote.state.recoverySigningPublicKey) throw new Error("This recovery code was replaced; use the account's current recovery code");
        if (state === "needs-verification" && saved.pendingAccountKey !== bridgeBase64(opened.accountKey)) throw new Error("Recovery key does not match the key offered to this backend");
        if (state === "needs-approval") {
          const authority: BridgeMembershipSigner = { kind: "recovery", signingPublicKey: opened.signingPublicKey };
          for (let attempt = 0; ; attempt++) {
            // A retry after a lost response finds this backend already admitted and only uploads its wrap.
            const entry = sameMember(bridgeMember(remote.state, options.backendId), self()) ? undefined
              : signBridgeMembershipEntry(remote.state, { kind: "add", body: { member: self(), via: "recovery" } }, authority, opened.signingSecret);
            try { await request("/v1/keys/recovery/unlock", { wrap: sealBridgeAccountKey(opened.accountKey, bridgeBytes(saved.publicKey, 32)), ...(entry ? { entry } : {}) }); break; }
            catch (failure) { if (!membershipMoved(failure) || attempt >= 2) throw failure; }
            remote = await verifiedRemote();
          }
          remote = await verifiedRemote();
        }
        await pinMembership(remote.state, remote.entries);
        // Recovery authenticates the locally decrypted key, never a subsequent hub wrap.
        await activate(opened.accountKey); await update(); notify();
      } finally { opened.accountKey.fill(0); opened.signingSecret.fill(0); }
    }); },
    takeRecoveryCode() { if (closed || cancelling || state !== "ready") return null; const result = recoveryCode; recoveryCode = null; notify(); return result; },
    /** Replaces the code together with the recovery authority derived from it. */
    async regenerateRecoveryCode() { return exclusive(async () => {
      if (!saved?.accountKey) throw new Error("Backend approval is required");
      const generated = generateBridgeRecoveryCode(), key = bridgeBytes(saved.accountKey, 32);
      try {
        const sealed = await sealBridgeRecovery(key, generated);
        await changeMembership(() => ({ kind: "recovery", body: { recoverySigningPublicKey: sealed.signingPublicKey } }),
          (entry) => request("/v1/keys/recovery", { recovery: sealed.wrap, entry }, "PUT"));
        recoveryCode = null; notify(); return generated;
      } finally { key.fill(0); }
    }); },
    async signOut(logout: { skipRevoke?: boolean } = {}) {
      epoch++; cancelling = true; if (timer) clearTimeout(timer); stopLogin?.(); stopLogin = undefined; deviceCode = null; login = null;
      return exclusive(async () => {
        try {
          epoch++;
          if (!logout.skipRevoke && saved && state !== "revoked" && saved.expiresAt > Date.now()) {
            // A member leaves the account through its own signed, fenced removal.
            try { await removeSelf(); }
            catch (failure) { if (!(failure instanceof BridgeHttpError && failure.status === 401)) throw failure; }
          }
          await options.revoked(); await vault.remove(); await membershipFiles.remove();
          saved = null; membership = null; joinCodes = []; recoveryCode = null; activated = false;
          if (timer) clearTimeout(timer);
          requests = []; backends = []; error = null; state = "signed-out"; notify();
        } finally { cancelling = false; if (saved) schedule(); }
      });
    },
    async stop() { closed = true; epoch++; if (timer) clearTimeout(timer); stopLogin?.(); await operations; saved = null; membership = null; joinCodes = []; recoveryCode = null; },
  };
  return api;
}
export type BridgeIdentityClient = ReturnType<typeof createBridgeIdentity>;
