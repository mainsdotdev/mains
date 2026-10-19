import type { BridgeEnvelope, BridgeLogRecord, BridgePushResult, BridgeStream } from "@mains/contracts/bridge-protocol";
import { compareClock, headerClock } from "./bridge.clock";
import { BRIDGE_IDLE_RETENTION_MS, BRIDGE_MAX_CLOCK_SKEW_MS } from "@mains/contracts/bridge-protocol";

export interface BridgePullPage { records: BridgeLogRecord[]; next: number; hasMore: boolean }
/** B3's network adapter implements this same seam; no SQLite or codec on the hub. */
export interface BridgeTransport {
  push(stream: BridgeStream, records: BridgeEnvelope[]): Promise<BridgePushResult[]>;
  pull(stream: BridgeStream, after: number, limit: number): Promise<BridgePullPage>;
}

/** Development hub. It reasons exclusively about authenticated routing headers. */
export function createMemoryBridgeHub() {
  const streams = new Map<BridgeStream, { seq: number; log: BridgeLogRecord[] }>();
  const owners = new Map<string, string>();
  const runRoots = new Map<string, string>();
  const rowOwners = new Map<string, string>();
  const tombstones = new Map<string, BridgeLogRecord>();
  const latest = new Map<string, BridgeLogRecord>();
  const closedRuns = new Map<string, BridgeEnvelope>();
  const activity = new Map<BridgeStream, number>();
  function state(stream: BridgeStream) {
    let value = streams.get(stream);
    if (!value) { value = { seq: 0, log: [] }; streams.set(stream, value); }
    return value;
  }
  return {
    connect(backendId: string): BridgeTransport {
      return {
        async push(stream, records) {
          return records.map((input): BridgePushResult => {
            const envelope = structuredClone(input), h = envelope.header;
            const publicationId = envelope.auth?.publicationId ?? "";
            if (h.stream !== stream || h.origin !== backendId || (h.owner && h.owner !== backendId)) return { error: "notOwner" };
            const claimed = rowOwners.get(h.rowKey);
            if (claimed && claimed !== backendId) return { error: "notOwner" };
            const bound = h.op === "upsert" ? latest.get(`${stream}:${h.registerKey}`) : undefined;
            if (bound && bound.envelope.header.rowKey !== h.rowKey) return { error: "notOwner" };
            const hubMs = Date.now();
            if (h.hlc.physicalMs > hubMs + BRIDGE_MAX_CLOCK_SKEW_MS) return { error: "clockSkew", hubMs };
            if (stream !== "account") {
              const runId = stream.slice(4);
              if (h.runId !== runId || owners.get(runId) !== backendId || h.owner !== backendId) return { error: "notOwner" };
              const closed = closedRuns.get(runId);
              if (closed) return { deleted: structuredClone(closed), publicationId };
            } else if (h.runId) {
              if (!h.owner || owners.has(h.runId) && owners.get(h.runId) !== backendId ||
                  runRoots.has(h.runId) && runRoots.get(h.runId) !== h.rowKey) return { error: "notOwner" };
              owners.set(h.runId, backendId); runRoots.set(h.runId, h.rowKey);
            }
            if (h.owner) rowOwners.set(h.rowKey, h.owner);
            const dead = tombstones.get(h.rowKey);
            if (dead) return { deleted: structuredClone(dead.envelope), publicationId };
            const key = h.op === "delete" ? h.rowKey : `${stream}:${h.registerKey}`;
            const previous = latest.get(key);
            if (previous && compareClock(headerClock(h), headerClock(previous.envelope.header)) <= 0) return { seq: previous.seq, publicationId };
            const target = state(stream);
            const record = { seq: ++target.seq, envelope };
            target.log.push(record); latest.set(key, record);
            if (h.runId) activity.set(`run:${h.runId}`, Date.now());
            if (h.op === "delete") {
              tombstones.set(h.rowKey, record);
              if (h.runId && runRoots.get(h.runId) === h.rowKey) closedRuns.set(h.runId, envelope);
            }
            return { seq: record.seq, publicationId };
          });
        },
        async pull(stream, after, limit) {
          if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid Bridge pull cursor");
          const target = state(stream);
          const available = target.log.filter((entry) => entry.seq > after);
          const page = available.slice(0, limit);
          return { records: structuredClone(page), next: page.at(-1)?.seq ?? Math.max(after, target.seq), hasMore: available.length > page.length };
        },
      };
    },
    compact() {
      for (const [key, record] of latest) if (record.envelope.header.retention && (activity.get(record.envelope.header.stream) ?? 0) <= Date.now() - BRIDGE_IDLE_RETENTION_MS) latest.delete(key);
      for (const [stream, target] of streams) {
        target.log = stream !== "account" && closedRuns.has(stream.slice(4)) ? [] : target.log.filter((record) => {
          const h = record.envelope.header;
          return h.op === "delete" ? tombstones.get(h.rowKey) === record : !tombstones.has(h.rowKey) && latest.get(`${stream}:${h.registerKey}`) === record;
        });
      }
    },
    inspect(stream: BridgeStream) { return structuredClone(state(stream).log); },
  };
}
