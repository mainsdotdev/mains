import { createBridgeSyncLifecycle } from "./bridge.sync-lifecycle";
import { createBridgeRunWatches } from "./bridge.run-watch-lifecycle";
import { createHash } from "node:crypto";
import type { BridgeStatus, BridgeBackendInfo, BridgeQuota } from "@mains/contracts/bridge";
import type { BridgeServerMessage, BridgeStream } from "@mains/contracts/bridge-protocol";
import type { SQLiteInstance } from "../../db/types";
import { createBridgeEngine } from "./bridge.engine";
import { createBridgeSealingCodec } from "./bridge.crypto";
import { deriveBridgeKeys } from "./bridge.keys";
import { createBridgeWebSocketTransport } from "./bridge.websocket";
import type { AppliedChange } from "./bridge.applier";
import type { BridgeDevConfig } from "./bridge.config";
import { createBridgeBlobs } from "./bridge.blobs";
import { createBridgeBlobRecords, type BridgeFileTable } from "./bridge.blob-records";
import { refreshClaudeSessionMirrors } from "./bridge.session-mirror";
import { createBridgeSigningCodec } from "./bridge.signing";
import { BRIDGE_MEMBERSHIP_HEARTBEAT_MS, bridgeMember } from "@mains/contracts/bridge-membership";
import { bridgeAccountKeyCommitment } from "./bridge.keys";
import { bridgeMembershipConflict, createBridgeMembershipView, deviceSigner, signBridgeMembershipEntry } from "./bridge.membership";
import { bridgeHttp } from "./bridge.login";

export interface BridgeReplicatorOptions {
  onApproval?: (request: import("@mains/contracts/bridge-auth").BridgeApprovalRequest) => void;
  onAccessChanged?: () => void;
  sqlite: SQLiteInstance;
  backendId: string;
  config: BridgeDevConfig;
  token?: () => Promise<string>;
  onStatus?: () => void;
  onApplied?: (changes: AppliedChange[]) => void;
  /** Tests can pump explicitly or use short intervals without changing production defaults. */
  autoStart?: boolean;
  /** Local outbox inspection and queued upload progress; no idle remote RPC. */
  activeIntervalMs?: number;
  /** Safety pull for missed change hints; defaults to five minutes. */
  idleIntervalMs?: number;
  requestTimeoutMs?: number;
  dataDir?: string;
  stageLocalBeforePull?: boolean;
}
const quotaRefreshIntervalMs = 60_000;
const fallbackPollIntervalMs = 300_000;

/** One serialized background loop per database; a hub outage never blocks local execution. */
export function createBridgeReplicator(options: BridgeReplicatorOptions) {
  const { sqlite, backendId, config } = options;
  if (config.backendId !== backendId) throw new Error("Bridge configuration belongs to another backend");
  const fingerprint = createHash("sha256").update(config.accountKey).digest("hex");
  const binding = sqlite.prepare("SELECT account_fingerprint,enrollment_staging FROM bridge_config WHERE id=1").get() as { account_fingerprint: string | null; enrollment_staging: number } | undefined;
  if (binding?.account_fingerprint && binding.account_fingerprint !== fingerprint) throw new Error("This database is already bound to another Bridge account key");

  const lifecycle = createBridgeSyncLifecycle(options);
  let initialized = false, state: BridgeStatus["state"] = "connecting";
  let lastSyncedAt: string | null = null, error: string | null = null;
  let subscribed = "";
  // Membership is re-read at start, after a reconnect or failure (hints may have been missed), on a hint
  // and with the safety read; a page that binds a newer head also refreshes it first.
  let pullAllRequested = true, nextSafetyPullAt = 0, membershipStale = true;
  const changedStreams = new Set<BridgeStream>();
  let quota: BridgeQuota | null = null;
  let quotaDirty = true, nextQuotaRefreshAt = 0;
  function readOnly() {
    const current = quota?.subscription;
    return !!current && (!current.canUpload || !!current.expiresAt && Date.parse(current.expiresAt) <= Date.now());
  }
  async function refreshQuota(force = false) {
    if (!force && (!quotaDirty || Date.now() < nextQuotaRefreshAt)) return;
    nextQuotaRefreshAt = Date.now() + quotaRefreshIntervalMs;
    quotaDirty = false;
    try {
      const token = options.token ? await options.token() : config.token;
      const response = await fetch(new URL("/v1/quota", config.url.replace(/^ws/, "http")), { headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Bridge quota request failed (${response.status})`);
      quota = await response.json() as BridgeQuota;
    } catch {
      // Usage is a cached UI sample. The hub enforces limits on every write;
      // a failed sample must neither block replication nor hammer the endpoint.
      quotaDirty = true;
    }
  }
  const watches = createBridgeRunWatches();
  const online = new Map<string, boolean>();
  const notify = () => {
    if (!lifecycle.stopped) { try { options.onStatus?.(); } catch { /* UI listeners cannot interrupt durable replication. */ } }
  };
  const pending = () => (sqlite.prepare("SELECT count(*) AS n FROM bridge_outbox").get() as { n: number }).n;
  /** Every local capture raises the outbox generation, so a new write ends a stall. */
  const outboxSignature = () => {
    const row = sqlite.prepare("SELECT count(*) AS n,coalesce(max(generation),0) AS g FROM bridge_outbox").get() as { n: number; g: number };
    return `${row.n}:${row.g}`;
  };

  function presence(value: Extract<BridgeServerMessage, { type: "presence" }>) {
    if (lifecycle.stopped) return;
    const peerJoined = value.online && value.backendId !== backendId && online.get(value.backendId) !== true;
    const previous = sqlite.prepare("SELECT label,platform FROM bridge_peers WHERE backend_id=?").get(value.backendId) as { label: string; platform: string | null } | undefined;
    sqlite.prepare(`INSERT INTO bridge_peers(backend_id,label,platform,last_seen_ms) VALUES(?,?,?,?)
      ON CONFLICT(backend_id) DO UPDATE SET label=excluded.label,platform=excluded.platform,last_seen_ms=max(coalesce(last_seen_ms,0),excluded.last_seen_ms)`)
      .run(value.backendId, value.label ?? previous?.label ?? `Device ${value.backendId.slice(0, 8)}`, value.platform ?? previous?.platform ?? null, Date.parse(value.lastSeen));
    online.set(value.backendId, value.online); notify();
    // Recovery admits a peer without another approval event. Presence is a hint
    // to re-read device/approval state from HTTP, never proof of admission.
    if (peerJoined) options.onAccessChanged?.();
  }
  const transport = createBridgeWebSocketTransport({
    url: config.url, token: options.token ?? config.token, metadata: { label: config.label, platform: process.platform },
    requestTimeoutMs: options.requestTimeoutMs,
    onPresence: presence,
    onApproval: (request) => { if (!lifecycle.stopped) options.onApproval?.(request); },
    onAccessChanged: () => { if (!lifecycle.stopped) options.onAccessChanged?.(); },
    onChanged: (stream) => { changedStreams.add(stream); quotaDirty = true; lifecycle.request(); schedule(0); },
    onMembership: (seq) => { if (seq > (membership.current()?.seq ?? -1)) { membershipStale = true; lifecycle.request(); schedule(0); } },
    onStatusChange(next) {
      if (lifecycle.stopped) return;
      if (next === "offline") {
        online.clear(); subscribed = ""; pullAllRequested = true; membershipStale = true; state = "offline";
        if (!lifecycle.inFlight && !lifecycle.failures) { lifecycle.request(); schedule(1000); }
      }
      else if (next === "connecting") state = "connecting";
      else if (next === "connected") quotaDirty = true;
      notify();
    },
  });
  const blobs = options.dataDir ? createBridgeBlobs({ dataDir: options.dataDir, accountKey: config.accountKey, url: config.url, token: options.token ?? config.token }) : undefined;
  const files = blobs ? createBridgeBlobRecords({ sqlite, backendId, dataDir: options.dataDir!, blobs }) : undefined;
  // Identity supplies membership verified from its pinned head; a development config verifies the hub's log
  // from genesis against its own account key.
  const membership = config.membership ?? createBridgeMembershipView({ hubUrl: config.url.replace(/^ws/, "http"), token: async () => options.token ? options.token() : config.token,
    accountId: config.accountId, accountKeyCommitment: bridgeAccountKeyCommitment(config.accountKey) });
  async function refreshMembership() {
    const state = await membership.refresh();
    if (!bridgeMember(state, backendId)) throw new Error("This backend was removed from the Bridge account");
    return state;
  }
  const membershipSecret = Uint8Array.from(config.signingPrivateKey);
  let nextHeartbeatAt = 0;
  /** Keeps the replay horizon moving while membership is quiet (MEMBERSHIP.md §8). The hub's time only
   * triggers it; a device tries at most once a day whatever the hub reports. Best effort: another member
   * may get there first, and replication never waits on it. */
  async function heartbeat(current: () => boolean) {
    const state = membership.current(), newest = membership.headAppendedAt(), self = state && bridgeMember(state, backendId);
    if (!self || newest === null || Date.now() < nextHeartbeatAt || Date.now() - newest < BRIDGE_MEMBERSHIP_HEARTBEAT_MS) return;
    nextHeartbeatAt = Date.now() + 86_400_000;
    try {
      const entry = signBridgeMembershipEntry(state, { kind: "checkpoint", body: { horizon: true } }, deviceSigner(self), membershipSecret);
      await bridgeHttp(config.url.replace(/^ws/, "http"), "/v1/membership", options.token ? await options.token() : config.token, { entry });
      if (!current()) return;
      await refreshMembership();
    } catch { /* A concurrent change or an unreachable hub leaves this to the next day or another member. */ }
  }
  const signedCodec = createBridgeSigningCodec(createBridgeSealingCodec(config.accountKey), config, membership);
  const engine = createBridgeEngine({ sqlite, backendId, recordKey: deriveBridgeKeys(config.accountKey).recordKey,
    codec: signedCodec, transport, blobs: files,
    async prepareIncoming(envelopes) {
      // Records bind their writer's head: catch up before a page that binds a newer one, and stop on
      // another history instead of applying any of it (MEMBERSHIP.md §5).
      const bound = envelopes.flatMap(({ auth }) => auth?.accountId === config.accountId && Number.isSafeInteger(auth.membership?.seq) && auth.membership.seq >= 0 ? [auth.membership] : []);
      let state = membership.current();
      if (!state || bound.some((head) => head.seq > state!.seq)) state = await refreshMembership();
      for (const head of bound) {
        if (head.seq > state.seq) throw new Error("Bridge records bind account membership the hub did not provide");
        if (state.hashes[head.seq] !== head.hash) throw bridgeMembershipConflict(new Error("a record binds a different history"));
      }
    },
    // The hub refused records bound below its replay horizon: bind the newest head and sign again once.
    async membershipStale() { await refreshMembership(); },
    onApplied: (changes) => { quotaDirty = true; options.onApplied?.(changes); },
    stageLocalBeforePull: options.stageLocalBeforePull || !!binding?.enrollment_staging });
  sqlite.prepare("UPDATE bridge_config SET account_fingerprint=? WHERE id=1").run(fingerprint);

  const watchedRuns = watches.ids;
  function schedule(delay: number) {
    lifecycle.schedule(delay, (due) => {
      const streams = ["account", ...watchedRuns().map((id) => `run:${id}`)].join(",");
      const work = !lifecycle.failures && (!readOnly() && Date.now() >= lifecycle.writeRetryAt && pending() > 0 && !lifecycle.stalled(outboxSignature()) || streams !== subscribed ||
        readOnly() && pending() > 0 && Date.now() >= nextQuotaRefreshAt);
      if (Date.now() < due && (lifecycle.failures > 0 || !lifecycle.requested && !work)) { schedule(due - Date.now()); return; }
      void runCycle().catch(() => {});
    });
  }
  async function drain(stream: BridgeStream, deletesOnly: boolean, current: () => boolean) {
    let total = 0;
    // Bound a busy publisher's work so account pulls and open transcripts keep progressing.
    for (let batch = 0; batch < 10 && current(); batch++) {
      const pushed = await engine.push(stream, 100, deletesOnly);
      total += pushed;
      if (pushed) quotaDirty = true;
      if (pushed < 100) break;
    }
    return total;
  }
  async function cycle(refreshUsage: boolean, current: () => boolean) {
    lifecycle.beginCycle();
    const incoming = new Set(changedStreams); changedStreams.clear();
    const safetyDue = Date.now() >= nextSafetyPullAt;
    const watched = watches.snapshot();
    let pullAll = pullAllRequested || !initialized || safetyDue;
    pullAllRequested = false;
    try {
      const streams: BridgeStream[] = ["account", ...watched.map(({ value }): BridgeStream => `run:${value.runId}`)];
      const signature = streams.join(",");
      if (subscribed !== signature) { await transport.subscribe(streams); if (!current()) return; subscribed = signature; pullAll = true; }
      if (membershipStale || safetyDue) { membershipStale = false; await refreshMembership(); if (!current()) return; await heartbeat(current); }
      if (!current()) return;
      if (!initialized) {
        state = "syncing"; notify();
        await engine.bootstrap(); initialized = true;
      } else if (pullAll || incoming.size) await engine.pull("account");
      if (!current()) return;
      const wasReadOnly = readOnly();
      // An inactive publisher checks for renewal once a minute, without retrying
      // its whole outbox. Explicit UI sync may refresh the cached usage sooner.
      if (wasReadOnly) { if (pending() || refreshUsage) quotaDirty = true; await refreshQuota(refreshUsage); }
      if (!current()) return;
      const deletesOnly = readOnly();
      refreshClaudeSessionMirrors(sqlite, backendId);
      while (!(sqlite.prepare("SELECT backfill_done FROM bridge_config WHERE id=1").get() as { backfill_done: number }).backfill_done) {
        await engine.backfill(100); await new Promise<void>((resolve) => setImmediate(resolve));
        if (!current()) return;
      }
      let writeError: unknown;
      let sent = 0;
      const publish = async (stream: BridgeStream, onlyDeletes: boolean) => {
        try { sent += await drain(stream, onlyDeletes, current); }
        catch (cause) {
          // A write failure never skips the remaining streams or watched reads.
          writeError ??= cause;
          if (/write rate limit/i.test(String(cause))) lifecycle.rateLimited();
          if (!onlyDeletes && current()) await drain(stream, true, current).catch(() => {});
        }
      };
      await publish("account", deletesOnly || Date.now() < lifecycle.writeRetryAt);
      if (!current()) return;
      const outgoing = sqlite.prepare("SELECT DISTINCT stream FROM bridge_outbox WHERE stream<>'account' ORDER BY stream").all() as { stream: BridgeStream }[];
      for (const { stream } of outgoing) {
        if (!current()) return;
        // Only this run's acknowledged roots unlock its children; unrelated blocked account rows
        // do not hold it back. Tombstones can still close a never-published run.
        await publish(stream, deletesOnly || Date.now() < lifecycle.writeRetryAt || !engine.canPushRun(stream.slice(4)));
      }
      if (!deletesOnly) lifecycle.progress(sent, pending(), outboxSignature());
      for (const ticket of watched) {
        const runId = ticket.value.runId;
        if (!current()) return;
        if (!watches.current(ticket)) continue;
        if (!pullAll && !incoming.has(`run:${runId}`)) continue;
        await engine.pull(`run:${runId}`);
        if (!current()) return;
        watches.ready(ticket);
      }
      // Local publishing and incremental hints cannot postpone the safety read.
      if (pullAll) nextSafetyPullAt = Date.now() + (options.idleIntervalMs ?? fallbackPollIntervalMs);
      if (writeError && !/write rate limit/i.test(String(writeError))) throw writeError;
      // Entering/leaving a quota refusal needs a fresh plan/usage sample. The
      // ordinary live-update path and repeated refusals remain rate limited.
      await refreshQuota(refreshUsage && !wasReadOnly || !!error && /quota|rate limit/i.test(error));
      if (!current()) return;
      state = readOnly() ? "read-only" : pending() > 0 ? "syncing" : "connected"; error = null; lifecycle.succeeded(); lastSyncedAt = new Date().toISOString(); notify();
    } catch (cause) {
      if (!current()) return;
      if (/quota|rate limit|subscription required/i.test(String(cause))) { quotaDirty = true; await refreshQuota(!error || !/quota|rate limit|subscription required/i.test(error)); }
      if (!current()) return;
      if (/subscription required/i.test(String(cause)) && readOnly()) {
        // Bootstrap can discover inactive access before completing its first
        // read. Retry with the renewal sample, not a zero-delay timer loop.
        pullAllRequested = true;
        nextSafetyPullAt = Date.now() + Math.min(quotaRefreshIntervalMs, options.idleIntervalMs ?? fallbackPollIntervalMs);
        state = "read-only"; error = null; lifecycle.succeeded(); lastSyncedAt = new Date().toISOString(); notify(); return;
      }
      lifecycle.failed();
      error = cause instanceof Error ? cause.message : "Bridge replication failed";
      state = /connection|timed out/i.test(error) ? "offline" : "error";
      online.clear(); subscribed = ""; pullAllRequested = true; membershipStale = true;
      for (const stream of incoming) changedStreams.add(stream);
      watches.fail(watched, error);
      notify(); throw cause;
    } finally {
      if (!current() && !lifecycle.stopped) {
        for (const stream of incoming) changedStreams.add(stream);
        pullAllRequested ||= pullAll;
        membershipStale = true;
      }
      schedule(lifecycle.delay({ active: pending() > 0 && !readOnly(), safety: Math.max(0, nextSafetyPullAt - Date.now()),
        readOnly: readOnly(), pending: pending(), quotaAt: nextQuotaRefreshAt }));
    }
  }
  function runCycle(refreshUsage = false, retryBlocked = false): Promise<void> {
    return lifecycle.run((current) => {
      if (retryBlocked) engine.retryBlocked();
      return cycle(refreshUsage, current);
    });
  }
  function syncNow(refreshUsage = false): Promise<void> {
    pullAllRequested = true;
    const run = () => runCycle(refreshUsage, true);
    return lifecycle.inFlight ? lifecycle.inFlight.catch(() => {}).then(run) : run();
  }
  const api = {
    syncNow,
    pause: lifecycle.pause,
    resume() { if (lifecycle.stopped) return; lifecycle.resume(); pullAllRequested = true; api.wake(); },
    async preserveAccountFiles() { await files?.preserveAccountFiles(); },
    isCachedFile(realPath: string): Promise<boolean> { return blobs?.isCachedFile(realPath) ?? Promise.resolve(false); },
    captureOutput(file: string, roots: string[], mime: string | null) { return files?.captureOutput(file, roots, mime); },
    resolveFile(table: BridgeFileTable, id: string | number, column?: string, sourcePath?: string): Promise<string> {
      if (!files) throw new Error("Bridge file transfer is not configured");
      return files.resolve(table, id, column, sourcePath);
    },
    wake() { lifecycle.request(); schedule(0); },
    watchRun(runId: string, watcherId: string) {
      if (lifecycle.stopped) throw new Error("Bridge replicator is stopped");
      const run = sqlite.prepare("SELECT owner_backend_id FROM runs WHERE id=?").get(runId) as { owner_backend_id: string } | undefined;
      if (!run) throw new Error("Run not found");
      const changed = watches.watch(runId, watcherId, run.owner_backend_id === backendId,
        () => !!sqlite.prepare("SELECT 1 FROM bridge_cursors WHERE stream=?").get(`run:${runId}`));
      notify(); if (changed) api.wake();
    },
    unwatchRun(watcherId: string) {
      if (watches.unwatch(watcherId)) { notify(); api.wake(); }
    },
    getStatus(): BridgeStatus {
      const peers = sqlite.prepare("SELECT backend_id,label,platform,last_seen_ms FROM bridge_peers ORDER BY backend_id").all() as { backend_id: string; label: string; platform: string | null; last_seen_ms: number | null }[];
      const backends = new Map<string, BridgeBackendInfo>(peers.map((peer) => [peer.backend_id, { backendId: peer.backend_id, label: peer.label, platform: peer.platform,
        online: online.get(peer.backend_id) ?? null, lastSeen: peer.last_seen_ms === null ? null : new Date(peer.last_seen_ms).toISOString() }]));
      const owners = sqlite.prepare("SELECT DISTINCT owner_backend_id AS id FROM runs UNION SELECT DISTINCT owner_backend_id FROM workspaces").all() as { id: string }[];
      for (const { id } of owners) if (!backends.has(id)) backends.set(id, { backendId: id, label: `Device ${id.slice(0, 8)}`, platform: null, online: null, lastSeen: null });
      backends.set(backendId, { backendId, label: config.label, platform: process.platform, online: state === "connected" || state === "syncing" || state === "read-only", lastSeen: lastSyncedAt });
      const current = quota?.subscription;
      const displayQuota = current?.canUpload && current.expiresAt && Date.parse(current.expiresAt) <= Date.now()
        ? { ...quota!, subscription: { ...current, status: "expired" as const, canUpload: false } } : quota;
      const blocked = engine.blocked();
      return { enabled: true, state: (state === "connected" || state === "syncing") && readOnly() ? "read-only" : state, backendId, label: config.label, lastSyncedAt, error,
        pendingRecords: pending(), rejectedRecords: engine.unverified(), blockedRecordCount: blocked.total, blockedRecords: blocked.records,
        writeRetryAt: Date.now() < lifecycle.writeRetryAt ? new Date(lifecycle.writeRetryAt).toISOString() : null,
        backends: [...backends.values()], runs: watches.status(), quota: displayQuota };
    },
    stop() { return lifecycle.stop(async (pending) => {
      transport.close(); await blobs?.stop(); await pending?.catch(() => {}); await engine.stop(); membershipSecret.fill(0);
      watches.stop(); online.clear();
    }); },
  };
  schedule(0);
  return api;
}
export type BridgeReplicator = ReturnType<typeof createBridgeReplicator>;
