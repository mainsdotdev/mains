import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { BridgeAuthStatus, BridgeSignInInput } from "@mains/contracts/bridge-auth";
import { CHANNELS } from "@mains/contracts/channels";
import type { BridgeStatus } from "@mains/contracts/bridge";
import { getSqlite } from "../../db/client";
import { getLocalBackendId } from "../../db/backend-identity";
import { getBackendRuntime } from "../../runtime/backend-runtime";
import { emit, registerEventSink } from "../../ipc-kit/event-bus";
import { bridgeDevConfigPath, readBridgeDevConfig } from "./bridge.config";
import { createBridgeReplicator, type BridgeReplicator } from "./bridge.replicator";
import type { BridgeFileTable } from "./bridge.blob-records";
import { createBridgeIdentity, type BridgeIdentityClient } from "./bridge.identity";
import type { BridgeDevConfig } from "./bridge.config";
import { beginBridgeEnrollment, bindBridgeAccount, bridgeProjectScopes, includeBridgeLocalHistory, removeBridgeReplicas, setBridgeProjectScope } from "./bridge.product";
import { installBridgeCapture } from "./bridge.capture";
import { importClaudeSessionMirror } from "./bridge.session-mirror";
import { createBridgeServiceLifecycle, type BridgeServiceScope } from "./bridge.service-lifecycle";

let replicator: BridgeReplicator | null = null;
let startupError: string | null = null;
let removeSink: (() => void) | null = null;
const lifecycle = createBridgeServiceLifecycle();
let identity: BridgeIdentityClient | null = null;
const changed = () => emit(CHANNELS.bridge.statusChanged, {});
const localWrites: ReadonlySet<string> = new Set([CHANNELS.runs.updated, CHANNELS.runs.eventPersisted, CHANNELS.space.changed, CHANNELS.atlas.changed]);
async function stopReplication() {
  const current = replicator;
  await current?.stop();
  if (replicator === current) { removeSink?.(); removeSink = null; replicator = null; }
}
function replicate(scope: BridgeServiceScope, owner: BridgeIdentityClient, config: BridgeDevConfig, token: () => Promise<string>, stageLocalBeforePull = false, autoStart = true) {
  replicator = createBridgeReplicator({ sqlite: getSqlite(), backendId: getLocalBackendId(), config,
    dataDir: getBackendRuntime().getPath("userData"), token, onStatus: changed, stageLocalBeforePull, autoStart,
    onApproval() { if (scope.current()) void owner.refresh(true).catch(() => {}); },
    onAccessChanged() { if (scope.current()) void owner.refresh(true).catch(() => {}); },
    onApplied(changes) { if (scope.current()) emit(CHANNELS.bridge.recordsApplied, { tables: [...new Set(changes.map((entry) => entry.table))] }); },
  });
  const current = replicator;
  removeSink = registerEventSink({ kind: "bridge-local-writes", send(channel) { if (scope.current() && replicator === current && localWrites.has(channel)) current.wake(); } });
}
const exclusive = lifecycle.run;
function requireIdentity(): BridgeIdentityClient {
  if (!lifecycle.active || !identity) throw new Error("Bridge service is closing or unavailable");
  return identity;
}
function logoutState() {
  return getSqlite().prepare("SELECT logout_pending,logout_revoked,logout_remove_synced FROM bridge_config WHERE id=1").get() as
    { logout_pending: number; logout_revoked: number; logout_remove_synced: number } | undefined;
}
async function finishLogout() {
  const state = logoutState(); if (!state?.logout_pending) return;
  identity!.prepareSignOut();
  await replicator?.pause();
  await replicator?.preserveAccountFiles();
  await identity!.signOut({ skipRevoke: !!state.logout_revoked });
  removeBridgeReplicas(getSqlite(), getLocalBackendId(), !!state.logout_remove_synced);
  await fs.rm(path.join(getBackendRuntime().getPath("userData"), "bridge", "blobs"), { recursive: true, force: true });
  getSqlite().exec("UPDATE bridge_config SET logout_pending=0,logout_revoked=0,logout_remove_synced=0,dev_disabled=1 WHERE id=1");
  changed(); emit(CHANNELS.bridge.recordsApplied, { tables: ["runs", "projects", "workspaces", "spaces", "collections", "atlas_items"] });
}

export const bridgeService = {
  isRunning(): boolean { return replicator !== null; },
  isCachedFile(realPath: string): Promise<boolean> { return replicator?.isCachedFile(realPath) ?? Promise.resolve(false); },
  /** Missing/disabled config preserves today's local backend and remote-control behavior. */
  async start(): Promise<void> {
    try {
      await lifecycle.start(async (scope) => {
        startupError = null;
        scope.defer(stopReplication);
        scope.defer(lifecycle.drain);
        if (getSqlite().prepare("SELECT 1 FROM bridge_config WHERE id=1 AND tracking_enabled=1").get()) installBridgeCapture(getSqlite());
        const runtime = getBackendRuntime();
        const client = createBridgeIdentity({ backendId: getLocalBackendId(), dataDir: runtime.getPath("userData"), storage: runtime.secretStorage, kind: runtime.kind,
          openExternal: (url) => runtime.openExternal(url), changed,
          approval(request) { emit(CHANNELS.bridge.deviceApprovalRequested, request); },
          async ready(config, _includeExisting, fresh, accountId) {
            if (!scope.current()) return;
            startupError = null; await stopReplication(); scope.assertCurrent();
            if (logoutState()?.logout_pending) {
              replicate(scope, client, config, async () => client.token(), false, false);
              getSqlite().exec("UPDATE bridge_config SET enabled=0 WHERE id=1");
              return;
            }
            const fingerprint = createHash("sha256").update(config.accountKey).digest("hex");
            const stage = fresh ? bindBridgeAccount(getSqlite(), fingerprint, new URL(config.url.replace(/^ws/, "http")).origin, accountId) : false;
            replicate(scope, client, config, async () => client.token(), stage);
          },
          async revoked() {
            if (!scope.current()) return;
            if (logoutState()?.logout_pending) getSqlite().exec("UPDATE bridge_config SET logout_revoked=1 WHERE id=1");
            await replicator?.pause(); await replicator?.preserveAccountFiles();
            await stopReplication(); scope.assertCurrent(); getSqlite().exec("UPDATE bridge_config SET enabled=0 WHERE id=1"); changed();
          },
        });
        identity = client;
        let stoppingIdentity: Promise<void> | undefined;
        function stopIdentity() {
          if (stoppingIdentity) return stoppingIdentity;
          const result = Promise.resolve().then(() => client.stop()); stoppingIdentity = result;
          void result.catch(() => { if (stoppingIdentity === result) stoppingIdentity = undefined; });
          return result;
        }
        scope.defer(async () => { await stopIdentity(); if (identity === client) identity = null; });
        const retire = () => { void stopIdentity().catch(() => {}); };
        scope.signal.addEventListener("abort", retire, { once: true });
        scope.defer(() => scope.signal.removeEventListener("abort", retire));
        await client.start(); scope.assertCurrent();
        if (logoutState()?.logout_pending) {
          try { await finishLogout(); }
          catch (error) {
            scope.assertCurrent();
            // Offline logout keeps its fenced identity so an explicit retry can
            // finish cleanup without rolling back the whole service owner.
            startupError = error instanceof Error ? error.message : "Sign-out cleanup failed; retry signing out";
          }
          return;
        }
        if (client.status().state !== "signed-out") return;
        if (getSqlite().prepare("SELECT 1 FROM bridge_config WHERE id=1 AND dev_disabled=1").get()) return;
        const file = bridgeDevConfigPath(getBackendRuntime().getPath("userData"));
        const config = await readBridgeDevConfig(file);
        if (!config) { scope.assertCurrent(); getSqlite().prepare("UPDATE bridge_config SET enabled=0 WHERE id=1").run(); return; }
        const fingerprint = createHash("sha256").update(config.accountKey).digest("hex");
        const writerFingerprint = createHash("sha256").update(config.signingPrivateKey).digest("hex");
        const backendId = getLocalBackendId();
        try {
          scope.assertCurrent();
          replicate(scope, client, config, async () => {
              const next = await readBridgeDevConfig(file);
              if (!next) throw new Error("Bridge configuration was disabled; restart this backend");
              try {
                if (next.backendId !== backendId || next.accountId !== config.accountId || next.url !== config.url || createHash("sha256").update(next.accountKey).digest("hex") !== fingerprint ||
                    createHash("sha256").update(next.signingPrivateKey).digest("hex") !== writerFingerprint)
                  throw new Error("Bridge account or backend configuration changed; restart this backend");
                return next.token;
              } finally { next.accountKey.fill(0); next.signingPrivateKey.fill(0); }
          });
        } finally { config.accountKey.fill(0); config.signingPrivateKey.fill(0); }
      });
    } catch (error) {
      if (lifecycle.closing) throw error;
      getSqlite().prepare("UPDATE bridge_config SET enabled=0 WHERE id=1").run();
      startupError = error instanceof Error ? error.message : "Bridge could not start";
      console.warn("[bridge]", startupError);
    } finally { changed(); }
  },
  getStatus(): BridgeStatus {
    if (replicator) return replicator.getStatus();
    const backendId = getLocalBackendId(), label = hostname();
    const peers = getSqlite().prepare("SELECT backend_id,label,platform,last_seen_ms FROM bridge_peers ORDER BY backend_id").all() as { backend_id: string; label: string; platform: string | null; last_seen_ms: number | null }[];
    const pendingRecords = (getSqlite().prepare("SELECT count(*) n FROM bridge_outbox").get() as { n: number }).n;
    return { enabled: !!startupError, state: startupError ? "error" : "disabled", backendId, label, lastSyncedAt: null, error: startupError, pendingRecords, runs: [],
      backends: peers.map((peer) => ({ backendId: peer.backend_id, label: peer.label, platform: peer.platform, online: null, lastSeen: peer.last_seen_ms === null ? null : new Date(peer.last_seen_ms).toISOString() })) };
  },
  getAuthStatus(): BridgeAuthStatus {
    const sqlite = getSqlite(), backendId = getLocalBackendId();
    const current = identity?.status() ?? { state: "signed-out" as const, hubUrl: null, accountId: null, email: null, backendId,
      label: hostname(), verificationCode: null, joinCodes: [], login: null, approvals: [], backends: [], recoveryCodeAvailable: false, error: startupError };
    const runs = (sqlite.prepare("SELECT count(*) n FROM runs WHERE owner_backend_id=?").get(backendId) as { n: number }).n;
    const pages = (sqlite.prepare("SELECT count(*) n FROM atlas_items WHERE kind='page'").get() as { n: number }).n;
    const history = (sqlite.prepare("SELECT count(*) n FROM bridge_exclusions WHERE reason IN ('history','enrollment')").get() as { n: number }).n;
    // A pending verification never starts replication. Once this registration has
    // connected, its join code is no longer needed. Earlier enrollments do not count.
    const connected = sqlite.prepare("SELECT 1 FROM bridge_peers WHERE backend_id=? AND last_seen_ms>=?");
    const joinCodes = current.joinCodes.filter((join) => {
      const backend = current.backends.find((entry) => entry.backendId === join.backendId);
      return backend?.status === "approved" && !connected.get(join.backendId, Date.parse(backend.createdAt));
    });
    return { ...current, joinCodes, localHistory: history, logoutPending: !!logoutState()?.logout_pending, existing: { runs, pages }, ...(startupError ? { error: startupError } : {}) };
  },
  async signIn(input: BridgeSignInInput) {
    await this.start();
    return exclusive(async () => {
      const client = requireIdentity();
      const current = client.status();
      if (current.accountId || current.state === "signing-in") throw new Error("Bridge sign-in is already active");
      await stopReplication(); getSqlite().prepare("UPDATE bridge_config SET enabled=0 WHERE id=1").run();
      if (logoutState()?.logout_pending) throw new Error("Finish signing out before signing in again");
      if (typeof input.includeExisting !== "boolean") throw new Error("Choose whether to sync existing history");
      beginBridgeEnrollment(getSqlite(), getLocalBackendId(), input.includeExisting);
      startupError = null;
      return client.signIn(input);
    });
  },
  async refreshAuth() { await requireIdentity().refresh(); return this.getAuthStatus(); },
  async approveBackend(input: Parameters<BridgeIdentityClient["approve"]>[0]) { await requireIdentity().approve(input); },
  async confirmAccountKey(joinCode: string) { await requireIdentity().confirmAccountKey(joinCode); },
  async rejectBackend(requestId: string) { await requireIdentity().reject(requestId); },
  async requestApproval() { await requireIdentity().requestApproval(); },
  async revokeBackend(backendId: string) { await requireIdentity().revoke(backendId); },
  async enterRecoveryCode(code: string) { await requireIdentity().enterRecoveryCode(code); },
  takeRecoveryCode() { return lifecycle.active ? identity?.takeRecoveryCode() ?? null : null; },
  async regenerateRecoveryCode() { return requireIdentity().regenerateRecoveryCode(); },
  getProjectScopes() { return bridgeProjectScopes(getSqlite(), getLocalBackendId()); },
  async setProjectLocalOnly(projectId: string, localOnly: boolean) {
    return exclusive(async () => {
      if (logoutState()?.logout_pending) throw new Error("Finish signing out before changing sync scope");
      await replicator?.pause();
      try { setBridgeProjectScope(getSqlite(), getLocalBackendId(), projectId, localOnly); changed(); }
      finally { if (lifecycle.active) replicator?.resume(); }
    });
  },
  async includeLocalHistory() {
    return exclusive(async () => {
      if (logoutState()?.logout_pending) throw new Error("Finish signing out before changing sync scope");
      await replicator?.pause();
      try { includeBridgeLocalHistory(getSqlite()); changed(); }
      finally { if (lifecycle.active) replicator?.resume(); }
    });
  },
  async signOut(removeAccountObjects = false) {
    return exclusive(async () => {
      if (!identity) throw new Error("Bridge is not signed in");
      getSqlite().prepare("UPDATE bridge_config SET enabled=0,logout_pending=1,logout_remove_synced=max(logout_remove_synced,?) WHERE id=1").run(Number(removeAccountObjects));
      try { await finishLogout(); startupError = null; }
      catch (error) { startupError = error instanceof Error ? error.message : "Sign-out cleanup failed; retry signing out"; changed(); throw error; }
    });
  },
  async syncNow(): Promise<void> { if (!lifecycle.active || !replicator) throw new Error(startupError ?? "Bridge is not configured"); await replicator.syncNow(true); },
  resolveFile(table: BridgeFileTable, id: string | number, column?: string, sourcePath?: string): Promise<string> {
    if (!lifecycle.active || !replicator) throw new Error(startupError ?? "Bridge is not configured");
    return replicator.resolveFile(table, id, column, sourcePath);
  },
  captureOutput(file: string, roots: string[], mime: string | null) { return lifecycle.active ? replicator?.captureOutput(file, roots, mime) : undefined; },
  async mirrorClaudeSession(input: { runId: string; sessionId: string; dir: string }): Promise<void> {
    if (!lifecycle.active || !identity && !replicator) return;
    await exclusive(async () => {
      if (!lifecycle.active || !identity && !replicator) return;
      const sqlite = getSqlite();
      if (!sqlite.prepare("SELECT 1 FROM bridge_config WHERE id=1 AND (enabled=1 OR tracking_enabled=1)").get()) return;
      await importClaudeSessionMirror({ ...input, sqlite, backendId: getLocalBackendId() });
      replicator?.wake();
    });
  },
  watchRun(runId: string, watcherId: string): void { if (lifecycle.active) replicator?.watchRun(runId, watcherId); },
  unwatchRun(watcherId: string): void { replicator?.unwatchRun(watcherId); },
  async stop(): Promise<void> {
    await lifecycle.stop(); startupError = null;
  },
};
