import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { CHANNELS } from "@mains/contracts/channels";
import type { BridgeStatus } from "@mains/contracts/bridge";
import { getSqlite } from "../../db/client";
import { getLocalBackendId } from "../../db/backend-identity";
import { getBackendRuntime } from "../../runtime/backend-runtime";
import { emit, registerEventSink } from "../../ipc-kit/event-bus";
import { bridgeDevConfigPath, readBridgeDevConfig } from "./bridge.config";
import { createBridgeReplicator, type BridgeReplicator } from "./bridge.replicator";

let replicator: BridgeReplicator | null = null;
let startupError: string | null = null;
let removeSink: (() => void) | null = null;
let starting: Promise<void> | null = null;
const changed = () => emit(CHANNELS.bridge.statusChanged, {});
const localWrites: ReadonlySet<string> = new Set([CHANNELS.runs.updated, CHANNELS.runs.eventPersisted, CHANNELS.space.changed]);

export const bridgeService = {
  /** Missing/disabled config preserves today's local backend and remote-control behavior. */
  async start(): Promise<void> {
    if (replicator) return;
    if (starting) return starting;
    starting = (async () => {
      startupError = null;
      try {
        const file = bridgeDevConfigPath(getBackendRuntime().getPath("userData"));
        const config = await readBridgeDevConfig(file);
        if (!config) { getSqlite().prepare("UPDATE bridge_config SET enabled=0 WHERE id=1").run(); return; }
        const fingerprint = createHash("sha256").update(config.accountKey).digest("hex");
        const backendId = getLocalBackendId();
        try {
          replicator = createBridgeReplicator({ sqlite: getSqlite(), backendId, config,
            async token() {
              const next = await readBridgeDevConfig(file);
              if (!next) throw new Error("Bridge configuration was disabled; restart this backend");
              try {
                if (next.backendId !== backendId || next.url !== config.url || createHash("sha256").update(next.accountKey).digest("hex") !== fingerprint)
                  throw new Error("Bridge account or backend configuration changed; restart this backend");
                return next.token;
              } finally { next.accountKey.fill(0); }
            },
            onStatus: changed,
            onApplied(changes) { emit(CHANNELS.bridge.recordsApplied, { tables: [...new Set(changes.map((entry) => entry.table))] }); },
          });
        } finally { config.accountKey.fill(0); }
        removeSink = registerEventSink({ kind: "bridge-local-writes", send(channel) {
          if (localWrites.has(channel)) replicator?.wake();
        } });
      } catch (error) {
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
    return { enabled: !!startupError, state: startupError ? "error" : "disabled", backendId, label, lastSyncedAt: null, error: startupError, pendingRecords: 0, runs: [],
      backends: peers.map((peer) => ({ backendId: peer.backend_id, label: peer.label, platform: peer.platform, online: null, lastSeen: peer.last_seen_ms === null ? null : new Date(peer.last_seen_ms).toISOString() })) };
  },
  async syncNow(): Promise<void> { if (!replicator) throw new Error(startupError ?? "Bridge is not configured"); await replicator.syncNow(); },
  watchRun(runId: string, watcherId: string): void { replicator?.watchRun(runId, watcherId); },
  unwatchRun(watcherId: string): void { replicator?.unwatchRun(watcherId); },
  async stop(): Promise<void> {
    await starting; removeSink?.(); removeSink = null;
    const current = replicator; replicator = null; await current?.stop(); startupError = null;
  },
};
