import { createHash } from "node:crypto";
import type { BridgeStatus, BridgeBackendInfo, BridgeRunState, BridgeQuota } from "@mains/contracts/bridge";
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
const watcherLeaseMs = 90_000;
const quotaRefreshIntervalMs = 60_000;
const fallbackPollIntervalMs = 300_000;
const stalledRetryMaxMs = 60_000;

/** One serialized background loop per database; a hub outage never blocks local execution. */
export function createBridgeReplicator(options: BridgeReplicatorOptions) {
  const { sqlite, backendId, config } = options;
  if (config.backendId !== backendId) throw new Error("Bridge configuration belongs to another backend");
  const fingerprint = createHash("sha256").update(config.accountKey).digest("hex");
  const binding = sqlite.prepare("SELECT account_fingerprint,enrollment_staging FROM bridge_config WHERE id=1").get() as { account_fingerprint: string | null; enrollment_staging: number } | undefined;
  if (binding?.account_fingerprint && binding.account_fingerprint !== fingerprint) throw new Error("This database is already bound to another Bridge account key");

  let stopped = false, paused = false, initialized = false, state: BridgeStatus["state"] = "connecting";
  let lastSyncedAt: string | null = null, error: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined, inFlight: Promise<void> | undefined;
  let requested = false, failures = 0, subscribed = "";
  // Consecutive write cycles that sent nothing while changes stayed queued, and the outbox they saw.
  let stalls = 0, stalledOutbox = "";
  let writeRetryAt = 0;
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
  const watchers = new Map<string, { runId: string; expires: number }>();
  const runStates = new Map<string, BridgeRunState>();
  const online = new Map<string, boolean>();
  const notify = () => {
    if (!stopped) { try { options.onStatus?.(); } catch { /* UI listeners cannot interrupt durable replication. */ } }
  };
  const pending = () => (sqlite.prepare("SELECT count(*) AS n FROM bridge_outbox").get() as { n: number }).n;
  /** Every local capture raises the outbox generation, so a new write ends a stall. */
  const outboxSignature = () => {
    const row = sqlite.prepare("SELECT count(*) AS n,coalesce(max(generation),0) AS g FROM bridge_outbox").get() as { n: number; g: number };
    return `${row.n}:${row.g}`;
  };

  function presence(value: Extract<BridgeServerMessage, { type: "presence" }>) {
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
    onApproval: options.onApproval,
    onAccessChanged: options.onAccessChanged,
    onChanged: (stream) => { changedStreams.add(stream); quotaDirty = true; requested = true; schedule(0); },
    onMembership: (seq) => { if (seq > (membership.current()?.seq ?? -1)) { membershipStale = true; requested = true; schedule(0); } },
    onStatusChange(next) {
      if (stopped) return;
      if (next === "offline") {
        online.clear(); subscribed = ""; pullAllRequested = true; membershipStale = true; state = "offline";
        if (!inFlight && !failures) { requested = true; schedule(1000); }
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
  async function heartbeat() {
    const state = membership.current(), newest = membership.headAppendedAt(), self = state && bridgeMember(state, backendId);
    if (!self || newest === null || Date.now() < nextHeartbeatAt || Date.now() - newest < BRIDGE_MEMBERSHIP_HEARTBEAT_MS) return;
    nextHeartbeatAt = Date.now() + 86_400_000;
    try {
      const entry = signBridgeMembershipEntry(state, { kind: "checkpoint", body: { horizon: true } }, deviceSigner(self), membershipSecret);
      await bridgeHttp(config.url.replace(/^ws/, "http"), "/v1/membership", options.token ? await options.token() : config.token, { entry });
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

  function watchedRuns(): string[] {
    const now = Date.now();
    for (const [id, watcher] of watchers) if (watcher.expires < now) watchers.delete(id);
    const runs = [...new Set([...watchers.values()].map((value) => value.runId))].sort();
    for (const id of runStates.keys()) if (!runs.includes(id)) runStates.delete(id);
    return runs;
  }
  function schedule(delay: number) {
    if (stopped || paused || options.autoStart === false) return;
    if (timer) clearTimeout(timer);
    const due = Date.now() + delay;
    timer = setTimeout(() => {
      timer = undefined;
      // Discover durable local writes without sending a remote pull. This also
      // covers SQL writers that do not emit a renderer/domain event.
      const streams = ["account", ...watchedRuns().map((id) => `run:${id}`)].join(",");
      const work = !failures && (!readOnly() && Date.now() >= writeRetryAt && pending() > 0 && (!stalls || outboxSignature() !== stalledOutbox) || streams !== subscribed ||
        readOnly() && pending() > 0 && Date.now() >= nextQuotaRefreshAt);
      if (Date.now() < due && (failures > 0 || !requested && !work)) { schedule(due - Date.now()); return; }
      void runCycle().catch(() => {});
    }, Math.min(delay, options.activeIntervalMs ?? 1000));
    timer.unref();
  }
  async function drain(stream: BridgeStream, deletesOnly = false) {
    let total = 0;
    // Bound a busy publisher's work so account pulls and open transcripts keep progressing.
    for (let batch = 0; batch < 10 && !stopped && !paused; batch++) {
      const pushed = await engine.push(stream, 100, deletesOnly);
      total += pushed;
      if (pushed) quotaDirty = true;
      if (pushed < 100) break;
    }
    return total;
  }
  async function cycle(refreshUsage = false) {
    requested = false;
    const incoming = new Set(changedStreams); changedStreams.clear();
    const safetyDue = Date.now() >= nextSafetyPullAt;
    let pullAll = pullAllRequested || !initialized || safetyDue;
    pullAllRequested = false;
    try {
      const streams: BridgeStream[] = ["account", ...watchedRuns().map((id): BridgeStream => `run:${id}`)];
      const signature = streams.join(",");
      if (subscribed !== signature) { await transport.subscribe(streams); subscribed = signature; pullAll = true; }
      if (membershipStale || safetyDue) { membershipStale = false; await refreshMembership(); await heartbeat(); }
      if (!initialized) {
        state = "syncing"; notify();
        await engine.bootstrap(); initialized = true;
      } else if (pullAll || incoming.size) await engine.pull("account");
      if (stopped || paused) return;
      const wasReadOnly = readOnly();
      // An inactive publisher checks for renewal once a minute, without retrying
      // its whole outbox. Explicit UI sync may refresh the cached usage sooner.
      if (wasReadOnly) { if (pending() || refreshUsage) quotaDirty = true; await refreshQuota(refreshUsage); }
      const deletesOnly = readOnly();
      refreshClaudeSessionMirrors(sqlite, backendId);
      while (!(sqlite.prepare("SELECT backfill_done FROM bridge_config WHERE id=1").get() as { backfill_done: number }).backfill_done) {
        await engine.backfill(100); await new Promise<void>((resolve) => setImmediate(resolve));
        if (stopped || paused) return;
      }
      let writeError: unknown;
      let sent = 0;
      const publish = async (stream: BridgeStream, onlyDeletes: boolean) => {
        try { sent += await drain(stream, onlyDeletes); }
        catch (cause) {
          // A write failure never skips the remaining streams or watched reads.
          writeError ??= cause;
          if (/write rate limit/i.test(String(cause))) writeRetryAt = Date.now() + 60_000;
          if (!onlyDeletes) await drain(stream, true).catch(() => {});
        }
      };
      await publish("account", deletesOnly || Date.now() < writeRetryAt);
      const outgoing = sqlite.prepare("SELECT DISTINCT stream FROM bridge_outbox WHERE stream<>'account' ORDER BY stream").all() as { stream: BridgeStream }[];
      for (const { stream } of outgoing) {
        if (stopped || paused) return;
        // Only this run's acknowledged roots unlock its children; unrelated blocked account rows
        // do not hold it back. Tombstones can still close a never-published run.
        await publish(stream, deletesOnly || Date.now() < writeRetryAt || !engine.canPushRun(stream.slice(4)));
      }
      if (!deletesOnly) {
        if (sent || !pending()) { stalls = 0; stalledOutbox = ""; }
        else { stalls++; stalledOutbox = outboxSignature(); }
      }
      for (const runId of watchedRuns()) {
        if (stopped || paused) return;
        if (!pullAll && !incoming.has(`run:${runId}`)) continue;
        await engine.pull(`run:${runId}`);
        runStates.set(runId, { runId, ready: true, error: null });
      }
      // Local publishing and incremental hints cannot postpone the safety read.
      if (pullAll) nextSafetyPullAt = Date.now() + (options.idleIntervalMs ?? fallbackPollIntervalMs);
      if (writeError && !/write rate limit/i.test(String(writeError))) throw writeError;
      // Entering/leaving a quota refusal needs a fresh plan/usage sample. The
      // ordinary live-update path and repeated refusals remain rate limited.
      await refreshQuota(refreshUsage && !wasReadOnly || !!error && /quota|rate limit/i.test(error));
      state = readOnly() ? "read-only" : pending() > 0 ? "syncing" : "connected"; error = null; failures = 0; lastSyncedAt = new Date().toISOString(); notify();
    } catch (cause) {
      if (stopped) return;
      if (/quota|rate limit|subscription required/i.test(String(cause))) { quotaDirty = true; await refreshQuota(!error || !/quota|rate limit|subscription required/i.test(error)); }
      if (/subscription required/i.test(String(cause)) && readOnly()) {
        // Bootstrap can discover inactive access before completing its first
        // read. Retry with the renewal sample, not a zero-delay timer loop.
        pullAllRequested = true;
        nextSafetyPullAt = Date.now() + Math.min(quotaRefreshIntervalMs, options.idleIntervalMs ?? fallbackPollIntervalMs);
        state = "read-only"; error = null; failures = 0; lastSyncedAt = new Date().toISOString(); notify(); return;
      }
      failures++;
      error = cause instanceof Error ? cause.message : "Bridge replication failed";
      state = /connection|timed out/i.test(error) ? "offline" : "error";
      online.clear(); subscribed = ""; pullAllRequested = true; membershipStale = true;
      for (const stream of incoming) changedStreams.add(stream);
      for (const runId of watchedRuns()) {
        const previous = runStates.get(runId);
        runStates.set(runId, { runId, ready: previous?.ready ?? false, error });
      }
      notify(); throw cause;
    } finally {
      if (!stopped) {
        const active = pending() > 0 && !readOnly();
        const safety = Math.max(0, nextSafetyPullAt - Date.now());
        const activeInterval = options.activeIntervalMs ?? 1000;
        const retry = Date.now() < writeRetryAt ? writeRetryAt - Date.now() :
          stalls ? Math.min(stalledRetryMaxMs, activeInterval * 2 ** Math.min(stalls, 6)) : activeInterval;
        const interval = active ? Math.min(retry, safety) :
          readOnly() && pending() > 0 ? Math.min(safety, Math.max(0, nextQuotaRefreshAt - Date.now())) : safety;
        const delay = failures ? Math.min(30_000, 1000 * 2 ** Math.min(failures - 1, 5)) : requested ? 0 : interval;
        schedule(delay);
      }
    }
  }
  function runCycle(refreshUsage = false): Promise<void> {
    if (stopped) return Promise.reject(new Error("Bridge replicator is stopped"));
    if (paused) return Promise.reject(new Error("Bridge replication is paused"));
    if (inFlight) return inFlight;
    inFlight = cycle(refreshUsage).finally(() => { inFlight = undefined; });
    return inFlight;
  }
  function syncNow(refreshUsage = false): Promise<void> {
    pullAllRequested = true;
    const run = () => { engine.retryBlocked(); return runCycle(refreshUsage); };
    return inFlight ? inFlight.catch(() => {}).then(run) : run();
  }
  const api = {
    syncNow,
    async pause() { paused = true; if (timer) clearTimeout(timer); timer = undefined; await inFlight?.catch(() => {}); },
    resume() { if (stopped) return; paused = false; pullAllRequested = true; api.wake(); },
    async preserveAccountFiles() { await files?.preserveAccountFiles(); },
    isCachedFile(realPath: string): Promise<boolean> { return blobs?.isCachedFile(realPath) ?? Promise.resolve(false); },
    captureOutput(file: string, roots: string[], mime: string | null) { return files?.captureOutput(file, roots, mime); },
    resolveFile(table: BridgeFileTable, id: string | number, column?: string, sourcePath?: string): Promise<string> {
      if (!files) throw new Error("Bridge file transfer is not configured");
      return files.resolve(table, id, column, sourcePath);
    },
    wake() { requested = true; schedule(0); },
    watchRun(runId: string, watcherId: string) {
      if (stopped) throw new Error("Bridge replicator is stopped");
      const run = sqlite.prepare("SELECT owner_backend_id FROM runs WHERE id=?").get(runId) as { owner_backend_id: string } | undefined;
      if (!run) throw new Error("Run not found");
      if (run.owner_backend_id === backendId) return;
      if (watchers.size >= 512 && !watchers.has(watcherId)) throw new Error("Too many open Bridge views");
      const runs = watchedRuns();
      if (!runs.includes(runId) && runs.length >= 127) throw new Error("Too many open Bridge streams");
      watchers.set(watcherId, { runId, expires: Date.now() + watcherLeaseMs });
      if (!runStates.has(runId)) {
        const cached = !!sqlite.prepare("SELECT 1 FROM bridge_cursors WHERE stream=?").get(`run:${runId}`);
        runStates.set(runId, { runId, ready: cached, error: null });
      }
      notify(); if (!runs.includes(runId)) api.wake();
    },
    unwatchRun(watcherId: string) {
      const before = watchedRuns().join(",");
      if (watchers.delete(watcherId)) { const after = watchedRuns().join(","); notify(); if (before !== after) api.wake(); }
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
        writeRetryAt: Date.now() < writeRetryAt ? new Date(writeRetryAt).toISOString() : null,
        backends: [...backends.values()], runs: [...runStates.values()], quota: displayQuota };
    },
    async stop() {
      stopped = true; if (timer) clearTimeout(timer); timer = undefined;
      transport.close(); await blobs?.stop(); await inFlight?.catch(() => {}); await engine.stop(); membershipSecret.fill(0);
      watchers.clear(); online.clear();
    },
  };
  schedule(0);
  return api;
}
export type BridgeReplicator = ReturnType<typeof createBridgeReplicator>;
