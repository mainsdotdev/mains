import { createHash } from "node:crypto";
import type { BridgeStatus, BridgeBackendInfo, BridgeRunState } from "@mains/contracts/bridge";
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

export interface BridgeReplicatorOptions {
  sqlite: SQLiteInstance;
  backendId: string;
  config: BridgeDevConfig;
  token?: () => Promise<string>;
  onStatus?: () => void;
  onApplied?: (changes: AppliedChange[]) => void;
  /** Tests can pump explicitly or use short intervals without changing production defaults. */
  autoStart?: boolean;
  activeIntervalMs?: number;
  idleIntervalMs?: number;
  requestTimeoutMs?: number;
  dataDir?: string;
}
const watcherLeaseMs = 90_000;

/** One serialized background loop per database; a hub outage never blocks local execution. */
export function createBridgeReplicator(options: BridgeReplicatorOptions) {
  const { sqlite, backendId, config } = options;
  if (config.backendId !== backendId) throw new Error("Bridge configuration belongs to another backend");
  const fingerprint = createHash("sha256").update(config.accountKey).digest("hex");
  const binding = sqlite.prepare("SELECT account_fingerprint FROM bridge_config WHERE id=1").get() as { account_fingerprint: string | null } | undefined;
  if (binding?.account_fingerprint && binding.account_fingerprint !== fingerprint) throw new Error("This database is already bound to another Bridge account key");

  let stopped = false, initialized = false, state: BridgeStatus["state"] = "connecting";
  let lastSyncedAt: string | null = null, error: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined, inFlight: Promise<void> | undefined;
  let requested = false, failures = 0, subscribed = "";
  const watchers = new Map<string, { runId: string; expires: number }>();
  const runStates = new Map<string, BridgeRunState>();
  const online = new Map<string, boolean>();
  const notify = () => {
    if (!stopped) { try { options.onStatus?.(); } catch { /* UI listeners cannot interrupt durable replication. */ } }
  };
  const pending = () => (sqlite.prepare("SELECT count(*) AS n FROM bridge_outbox").get() as { n: number }).n;

  function presence(value: Extract<BridgeServerMessage, { type: "presence" }>) {
    const previous = sqlite.prepare("SELECT label,platform FROM bridge_peers WHERE backend_id=?").get(value.backendId) as { label: string; platform: string | null } | undefined;
    sqlite.prepare(`INSERT INTO bridge_peers(backend_id,label,platform,last_seen_ms) VALUES(?,?,?,?)
      ON CONFLICT(backend_id) DO UPDATE SET label=excluded.label,platform=excluded.platform,last_seen_ms=max(coalesce(last_seen_ms,0),excluded.last_seen_ms)`)
      .run(value.backendId, value.label ?? previous?.label ?? `Device ${value.backendId.slice(0, 8)}`, value.platform ?? previous?.platform ?? null, Date.parse(value.lastSeen));
    online.set(value.backendId, value.online); notify();
  }
  const transport = createBridgeWebSocketTransport({
    url: config.url, token: options.token ?? config.token, metadata: { label: config.label, platform: process.platform },
    requestTimeoutMs: options.requestTimeoutMs,
    onPresence: presence,
    onChanged: () => { requested = true; schedule(0); },
    onStatusChange(next) {
      if (stopped) return;
      if (next === "offline") { online.clear(); subscribed = ""; state = "offline"; }
      else if (next === "connecting") state = "connecting";
      notify();
    },
  });
  const blobs = options.dataDir ? createBridgeBlobs({ dataDir: options.dataDir, accountKey: config.accountKey, url: config.url, token: options.token ?? config.token }) : undefined;
  const files = blobs ? createBridgeBlobRecords({ sqlite, backendId, dataDir: options.dataDir!, blobs }) : undefined;
  const engine = createBridgeEngine({ sqlite, backendId, recordKey: deriveBridgeKeys(config.accountKey).recordKey,
    codec: createBridgeSealingCodec(config.accountKey), transport, blobs: files, onApplied: options.onApplied });
  sqlite.prepare("UPDATE bridge_config SET account_fingerprint=? WHERE id=1").run(fingerprint);

  function watchedRuns(): string[] {
    const now = Date.now();
    for (const [id, watcher] of watchers) if (watcher.expires < now) watchers.delete(id);
    const runs = [...new Set([...watchers.values()].map((value) => value.runId))].sort();
    for (const id of runStates.keys()) if (!runs.includes(id)) runStates.delete(id);
    return runs;
  }
  function schedule(delay: number) {
    if (stopped || options.autoStart === false) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; void syncNow().catch(() => {}); }, delay);
    timer.unref();
  }
  async function drain(stream: BridgeStream) {
    // Bound a busy publisher's work so account pulls and open transcripts keep progressing.
    for (let batch = 0; batch < 10 && !stopped; batch++) if (await engine.push(stream, 100) < 100) break;
  }
  async function cycle() {
    requested = false;
    try {
      const streams: BridgeStream[] = ["account", ...watchedRuns().map((id): BridgeStream => `run:${id}`)];
      const signature = streams.join(",");
      if (subscribed !== signature) { await transport.subscribe(streams); subscribed = signature; }
      if (!initialized) {
        state = "syncing"; notify();
        await engine.bootstrap(); initialized = true;
      } else await engine.pull("account");
      if (stopped) return;
      await drain("account");
      const accountPending = (sqlite.prepare(`SELECT count(*) AS n FROM bridge_outbox WHERE stream='account'`).get() as { n: number }).n;
      // Run children may only be published after their account-stream roots/parents.
      if (!accountPending) {
        const outgoing = sqlite.prepare(`SELECT DISTINCT stream FROM bridge_outbox WHERE stream<>'account' ORDER BY stream`).all() as { stream: BridgeStream }[];
        for (const row of outgoing) { if (stopped) return; await drain(row.stream); }
      }
      for (const runId of watchedRuns()) {
        if (stopped) return;
        await engine.pull(`run:${runId}`);
        runStates.set(runId, { runId, ready: true, error: null });
      }
      state = "connected"; error = null; failures = 0; lastSyncedAt = new Date().toISOString(); notify();
    } catch (cause) {
      if (stopped) return;
      failures++;
      error = cause instanceof Error ? cause.message : "Bridge replication failed";
      state = /connection|timed out/i.test(error) ? "offline" : "error";
      online.clear(); subscribed = "";
      for (const runId of watchedRuns()) {
        const previous = runStates.get(runId);
        runStates.set(runId, { runId, ready: previous?.ready ?? false, error });
      }
      notify(); throw cause;
    } finally {
      if (!stopped) {
        const active = watchedRuns().length > 0 || pending() > 0;
        const interval = active ? options.activeIntervalMs ?? 1000 : options.idleIntervalMs ?? 10_000;
        const delay = failures ? Math.min(30_000, 1000 * 2 ** Math.min(failures - 1, 5)) : requested ? 0 : interval;
        schedule(delay);
      }
    }
  }
  function syncNow(): Promise<void> {
    if (stopped) return Promise.reject(new Error("Bridge replicator is stopped"));
    if (inFlight) return inFlight;
    inFlight = cycle().finally(() => { inFlight = undefined; });
    return inFlight;
  }
  const api = {
    syncNow,
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
      notify(); api.wake();
    },
    unwatchRun(watcherId: string) { if (watchers.delete(watcherId)) { watchedRuns(); notify(); api.wake(); } },
    getStatus(): BridgeStatus {
      const peers = sqlite.prepare("SELECT backend_id,label,platform,last_seen_ms FROM bridge_peers ORDER BY backend_id").all() as { backend_id: string; label: string; platform: string | null; last_seen_ms: number | null }[];
      const backends = new Map<string, BridgeBackendInfo>(peers.map((peer) => [peer.backend_id, { backendId: peer.backend_id, label: peer.label, platform: peer.platform,
        online: online.get(peer.backend_id) ?? null, lastSeen: peer.last_seen_ms === null ? null : new Date(peer.last_seen_ms).toISOString() }]));
      const owners = sqlite.prepare("SELECT DISTINCT owner_backend_id AS id FROM runs UNION SELECT DISTINCT owner_backend_id FROM workspaces").all() as { id: string }[];
      for (const { id } of owners) if (!backends.has(id)) backends.set(id, { backendId: id, label: `Device ${id.slice(0, 8)}`, platform: null, online: null, lastSeen: null });
      backends.set(backendId, { backendId, label: config.label, platform: process.platform, online: state === "connected", lastSeen: lastSyncedAt });
      return { enabled: true, state, backendId, label: config.label, lastSyncedAt, error, pendingRecords: pending(), backends: [...backends.values()], runs: [...runStates.values()] };
    },
    async stop() {
      stopped = true; if (timer) clearTimeout(timer); timer = undefined;
      transport.close(); await blobs?.stop(); await inFlight?.catch(() => {}); await engine.stop();
      watchers.clear(); online.clear();
    },
  };
  schedule(0);
  return api;
}
export type BridgeReplicator = ReturnType<typeof createBridgeReplicator>;
