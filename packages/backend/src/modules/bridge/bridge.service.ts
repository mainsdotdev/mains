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

let replicator: BridgeReplicator | null = null;
let startupError: string | null = null;
let removeSink: (() => void) | null = null;
let starting: Promise<void> | null = null;
let identity: BridgeIdentityClient | null = null;
const changed = () => emit(CHANNELS.bridge.statusChanged, {});
const localWrites: ReadonlySet<string> = new Set([CHANNELS.runs.updated, CHANNELS.runs.eventPersisted, CHANNELS.space.changed, CHANNELS.atlas.changed]);
async function stopReplication() {
  removeSink?.(); removeSink = null; const current = replicator; replicator = null; await current?.stop();
}
function replicate(config: BridgeDevConfig, token: () => Promise<string>, stageLocalBeforePull = false, autoStart = true) {
  replicator = createBridgeReplicator({ sqlite: getSqlite(), backendId: getLocalBackendId(), config,
    dataDir: getBackendRuntime().getPath("userData"), token, onStatus: changed, stageLocalBeforePull, autoStart,
    onApproval() { void identity?.refresh(); },
    onApplied(changes) { emit(CHANNELS.bridge.recordsApplied, { tables: [...new Set(changes.map((entry) => entry.table))] }); },
  });
  removeSink = registerEventSink({ kind: "bridge-local-writes", send(channel) { if (localWrites.has(channel)) replicator?.wake(); } });
}
let mutation: Promise<unknown> = Promise.resolve();
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const next = mutation.then(work); mutation = next.catch(() => {}); return next;
}
function logoutState() {
  return getSqlite().prepare("SELECT logout_pending,logout_revoked,logout_remove_synced FROM bridge_config WHERE id=1").get() as
    { logout_pending: number; logout_revoked: number; logout_remove_synced: number } | undefined;
}
async function finishLogout() {
  const state = logoutState(); if (!state?.logout_pending) return;
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
    if (starting) return starting;
    if (identity || replicator) return;
    starting = (async () => {
      startupError = null;
      try {
        if (getSqlite().prepare("SELECT 1 FROM bridge_config WHERE id=1 AND tracking_enabled=1").get()) installBridgeCapture(getSqlite());
        const runtime = getBackendRuntime();
        identity = createBridgeIdentity({ backendId: getLocalBackendId(), dataDir: runtime.getPath("userData"), storage: runtime.secretStorage, kind: runtime.kind,
          openExternal: (url) => runtime.openExternal(url), changed,
          approval(request) { emit(CHANNELS.bridge.deviceApprovalRequested, request); },
          async ready(config, _includeExisting, fresh, accountId) {
            startupError = null; await stopReplication();
            if (logoutState()?.logout_pending) {
              replicate(config, async () => identity!.token(), false, false);
              getSqlite().exec("UPDATE bridge_config SET enabled=0 WHERE id=1");
              return;
            }
            const fingerprint = createHash("sha256").update(config.accountKey).digest("hex");
            const stage = fresh ? bindBridgeAccount(getSqlite(), fingerprint, new URL(config.url.replace(/^ws/, "http")).origin, accountId) : false;
            replicate(config, async () => identity!.token(), stage);
          },
          async revoked() {
            if (logoutState()?.logout_pending) getSqlite().exec("UPDATE bridge_config SET logout_revoked=1 WHERE id=1");
            await replicator?.pause(); await replicator?.preserveAccountFiles();
            await stopReplication(); getSqlite().exec("UPDATE bridge_config SET enabled=0 WHERE id=1"); changed();
          },
        });
        await identity.start();
        if (logoutState()?.logout_pending) { await finishLogout(); return; }
        if (identity.status().state !== "signed-out") return;
        if (getSqlite().prepare("SELECT 1 FROM bridge_config WHERE id=1 AND dev_disabled=1").get()) return;
        const file = bridgeDevConfigPath(getBackendRuntime().getPath("userData"));
        const config = await readBridgeDevConfig(file);
        if (!config) { getSqlite().prepare("UPDATE bridge_config SET enabled=0 WHERE id=1").run(); return; }
        const fingerprint = createHash("sha256").update(config.accountKey).digest("hex");
        const backendId = getLocalBackendId();
        try {
          replicate(config, async () => {
              const next = await readBridgeDevConfig(file);
              if (!next) throw new Error("Bridge configuration was disabled; restart this backend");
              try {
                if (next.backendId !== backendId || next.url !== config.url || createHash("sha256").update(next.accountKey).digest("hex") !== fingerprint)
                  throw new Error("Bridge account or backend configuration changed; restart this backend");
                return next.token;
              } finally { next.accountKey.fill(0); }
          });
        } finally { config.accountKey.fill(0); }
      } catch (error) {
        getSqlite().prepare("UPDATE bridge_config SET enabled=0 WHERE id=1").run();
        startupError = error instanceof Error ? error.message : "Bridge could not start";
        console.warn("[bridge]", startupError);
      } finally { changed(); }
    })();
    try { await starting; } finally { starting = null; }
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
      label: hostname(), verificationCode: null, login: null, approvals: [], backends: [], recoveryCodeAvailable: false, error: startupError };
    const runs = (sqlite.prepare("SELECT count(*) n FROM runs WHERE owner_backend_id=?").get(backendId) as { n: number }).n;
    const pages = (sqlite.prepare("SELECT count(*) n FROM atlas_items WHERE kind='page'").get() as { n: number }).n;
    const history = (sqlite.prepare("SELECT count(*) n FROM bridge_exclusions WHERE reason IN ('history','enrollment')").get() as { n: number }).n;
    return { ...current, localHistory: history, logoutPending: !!logoutState()?.logout_pending, existing: { runs, pages }, ...(startupError ? { error: startupError } : {}) };
  },
  async signIn(input: BridgeSignInInput) {
    await starting;
    if (!identity) await this.start();
    if (!identity) throw new Error(startupError ?? "Bridge sign-in unavailable");
    const current = identity.status();
    if (current.accountId || current.state === "signing-in") throw new Error("Bridge sign-in is already active");
    await stopReplication(); getSqlite().prepare("UPDATE bridge_config SET enabled=0 WHERE id=1").run();
    if (logoutState()?.logout_pending) throw new Error("Finish signing out before signing in again");
    if (typeof input.includeExisting !== "boolean") throw new Error("Choose whether to sync existing history");
    beginBridgeEnrollment(getSqlite(), getLocalBackendId(), input.includeExisting);
    startupError = null;
    return identity.signIn(input);
  },
  async refreshAuth() { await identity?.refresh(); return this.getAuthStatus(); },
  async approveBackend(input: Parameters<BridgeIdentityClient["approve"]>[0]) { if (!identity) throw new Error("Sign in first"); await identity.approve(input); },
  async rejectBackend(requestId: string) { if (!identity) throw new Error("Sign in first"); await identity.reject(requestId); },
  async requestApproval() { if (!identity) throw new Error("Sign in first"); await identity.requestApproval(); },
  async revokeBackend(backendId: string) { if (!identity) throw new Error("Sign in first"); await identity.revoke(backendId); },
  async enterRecoveryCode(code: string) { if (!identity) throw new Error("Sign in first"); await identity.enterRecoveryCode(code); },
  takeRecoveryCode() { return identity?.takeRecoveryCode() ?? null; },
  async regenerateRecoveryCode() { if (!identity) throw new Error("Sign in first"); return identity.regenerateRecoveryCode(); },
  getProjectScopes() { return bridgeProjectScopes(getSqlite(), getLocalBackendId()); },
  async setProjectLocalOnly(projectId: string, localOnly: boolean) {
    return exclusive(async () => {
      if (logoutState()?.logout_pending) throw new Error("Finish signing out before changing sync scope");
      await replicator?.pause();
      try { setBridgeProjectScope(getSqlite(), getLocalBackendId(), projectId, localOnly); changed(); }
      finally { replicator?.resume(); }
    });
  },
  async includeLocalHistory() {
    return exclusive(async () => {
      if (logoutState()?.logout_pending) throw new Error("Finish signing out before changing sync scope");
      await replicator?.pause();
      try { includeBridgeLocalHistory(getSqlite()); changed(); }
      finally { replicator?.resume(); }
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
  async syncNow(): Promise<void> { if (!replicator) throw new Error(startupError ?? "Bridge is not configured"); await replicator.syncNow(); },
  resolveFile(table: BridgeFileTable, id: string | number, column?: string, sourcePath?: string): Promise<string> {
    if (!replicator) throw new Error(startupError ?? "Bridge is not configured");
    return replicator.resolveFile(table, id, column, sourcePath);
  },
  captureOutput(file: string, roots: string[], mime: string | null) { return replicator?.captureOutput(file, roots, mime); },
  watchRun(runId: string, watcherId: string): void { replicator?.watchRun(runId, watcherId); },
  unwatchRun(watcherId: string): void { replicator?.unwatchRun(watcherId); },
  async stop(): Promise<void> {
    await starting; const currentIdentity = identity; identity = null; await currentIdentity?.stop();
    await stopReplication(); startupError = null;
  },
};
