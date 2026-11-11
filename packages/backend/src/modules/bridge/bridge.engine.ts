import { createBridgeReceiveLifecycle } from "./bridge.receive-lifecycle";
import { acknowledgePublication, clearAcknowledgedGeneration, validateAcknowledgements } from "./bridge.sync-lifecycle";
import { BRIDGE_MAX_CLOCK_SKEW_MS, type BridgeEnvelope, type BridgeStream } from "@mains/contracts/bridge-protocol";
import { CHANNELS } from "@mains/contracts/channels";
import type { SQLiteInstance } from "../../db/types";
import { emit } from "../../ipc-kit/event-bus";
import { installBridgeCapture } from "./bridge.capture";
import { bridgePassThroughCodec, type BridgeCodec } from "./bridge.crypto";
import { applyDeletedAck, isRejectedRecord, UNVERIFIED_REASON, type AppliedChange } from "./bridge.applier";
import { definition, getClock } from "./bridge.sql";
import { bestClock, outboxInScope, prepareRecord, readRow, type BridgeRecoveryContext, type BridgeStore, type OutboxEntry, type PreparedRecord } from "./bridge.store";
import type { BridgeTransport } from "./bridge.transport";
import type { BridgeBlobRecords } from "./bridge.blob-records";
import { recoverAtlasPage } from "./bridge.atlas";
import type { BridgeBlockedRecord } from "@mains/contracts/bridge";
import { BridgeMembershipNotReadyError } from "./bridge.membership";

export interface BridgeEngineOptions {
  sqlite: SQLiteInstance;
  backendId: string;
  recordKey: Uint8Array;
  transport: BridgeTransport;
  codec?: BridgeCodec;
  /** Atlas is enabled by default. Tests can explicitly disable its stream. */
  experimentalAtlas?: boolean;
  schemaVersion?: number;
  recover?: (context: BridgeRecoveryContext) => void;
  onApplied?: (changes: AppliedChange[]) => void;
  blobs?: BridgeBlobRecords;
  /** Enrollment stages existing UUID data before the first pull; untouched seeds still pull first. */
  stageLocalBeforePull?: boolean;
  prepareIncoming?: (envelopes: BridgeEnvelope[]) => Promise<void>;
  /** Refreshes membership after the hub refused records bound below its replay horizon, so the next
   * signature binds a newer head. */
  membershipStale?: () => Promise<void>;
}
/** One explicitly activated engine per SQLite database. Host startup remains unchanged in B2. */
export function createBridgeEngine(options: BridgeEngineOptions) {
  const { sqlite, backendId, transport } = options;
  if (options.recordKey.length !== 32 || !backendId) throw new Error("Bridge needs a backend identity and a 32-byte record key");
  if (sqlite.inTransaction) throw new Error("Start Bridge outside a database transaction");
  const identity = sqlite.prepare("SELECT backend_id FROM app_settings WHERE id='default'").get() as { backend_id: string | null } | undefined;
  if (!identity?.backend_id || identity.backend_id !== backendId) throw new Error("Bridge backend identity must match persisted app_settings");
  const existing = sqlite.prepare("SELECT backend_id,atlas_enabled FROM bridge_config WHERE id=1").get() as { backend_id: string; atlas_enabled: number } | undefined;
  if (existing && existing.backend_id !== backendId) throw new Error("Bridge database belongs to another backend");
  const store: BridgeStore = { sqlite, backendId, recordKey: Uint8Array.from(options.recordKey), codec: options.codec ?? bridgePassThroughCodec,
    schemaVersion: options.schemaVersion ?? 5, wireSchemaVersion: options.schemaVersion ?? 3, atlasEnabled: options.experimentalAtlas ?? true,
    recover(context) { recoverAtlasPage(context); options.recover?.(context); }, filesEnabled: !!options.blobs };
  sqlite.transaction(() => {
    sqlite.prepare(`INSERT INTO bridge_config(id,backend_id,enabled,tracking_enabled,atlas_enabled) VALUES(1,?,1,1,?)
      ON CONFLICT(id) DO UPDATE SET enabled=1,tracking_enabled=1,atlas_enabled=excluded.atlas_enabled`).run(backendId, Number(store.atlasEnabled));
    if (store.atlasEnabled && existing?.atlas_enabled === 0) sqlite.prepare("UPDATE bridge_config SET backfill_done=0,backfill_table=NULL,backfill_pk=NULL WHERE id=1").run();
    installBridgeCapture(sqlite);
  })();
  let stopped = false;
  let stopping: Promise<void> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  function deferPreparation(entry: OutboxEntry, cause: unknown) {
    if (cause instanceof BridgeMembershipNotReadyError) throw cause;
    const previous = sqlite.prepare("SELECT retry_generation,retry_attempts FROM bridge_outbox WHERE table_name=? AND pk=? AND register=? AND generation=?")
      .get(entry.table_name, entry.pk, entry.register, entry.generation) as { retry_generation: number | null; retry_attempts: number } | undefined;
    if (!previous) return; // A local write superseded the snapshot while I/O was pending.
    const attempts = previous.retry_generation === entry.generation ? previous.retry_attempts + 1 : 1;
    const retryAt = Date.now() + Math.min(60_000, 2000 * 2 ** Math.min(attempts - 1, 5));
    sqlite.prepare(`UPDATE bridge_outbox SET retry_generation=generation,retry_attempts=?,retry_after_ms=?,retry_error=?
      WHERE table_name=? AND pk=? AND register=? AND generation=?`)
      .run(attempts, retryAt, cause instanceof Error ? cause.message : "Bridge file preparation failed", entry.table_name, entry.pk, entry.register, entry.generation);
  }
  /** A run's acknowledged root and required account parents unlock its stream independently of
   * unrelated account writes. Cyclic references are already handled by the receiver's parked queue. */
  function accountPublished(table: string, pk: string, seen = new Set<string>()): boolean {
    const id = JSON.stringify([table, pk]); if (seen.has(id)) return true;
    seen.add(id);
    const def = definition(table), clock = bestClock(store, table, pk, def.primaryRegister!);
    if (clock?.synced_seq == null) return false;
    const row = readRow(store, table, pk); if (!row) return false;
    return Object.entries(def.references).every(([column, ref]) => ref.class !== "required" || row[column] == null ||
      definition(ref.table).stream !== "account" || accountPublished(ref.table, String(row[column]), seen));
  }
  const receiving = createBridgeReceiveLifecycle({ store, transport, blobs: options.blobs, stageLocalBeforePull: options.stageLocalBeforePull,
    prepareIncoming: options.prepareIncoming, onApplied: announce, assertActive() { if (stopped) throw new Error("Bridge engine is stopped"); } });
  function serial<T>(work: () => Promise<T>): Promise<T> {
    if (stopped) return Promise.reject(new Error("Bridge engine is stopped"));
    const next = queue.then(() => { if (stopped) throw new Error("Bridge engine is stopped"); return work(); });
    queue = next.catch(() => undefined);
    return next;
  }
  function announce(changes: AppliedChange[]) {
    if (!changes.length) return;
    // Events describe committed state; a failed UI sink cannot roll back replication.
    try { options.onApplied?.(changes); } catch (error) { console.error("Bridge change listener failed", error); }
    for (const change of changes) {
      try {
        if (change.table.startsWith("atlas_")) emit(CHANNELS.atlas.changed, {});
        else if (change.table === "spaces") emit(CHANNELS.space.changed, {});
        else if (change.table === "runs") {
          emit(CHANNELS.runs.updated, { runId: change.pk, ts: Date.now() });
          const run = sqlite.prepare("SELECT status FROM runs WHERE id=?").get(change.pk) as { status: string } | undefined;
          if (run) emit(CHANNELS.runs.statusChanged, { runId: change.pk, status: run.status, ts: Date.now() });
        } else if (change.runId) emit(CHANNELS.runs.eventPersisted, { runId: change.runId, ts: Date.now() });
      } catch (error) { console.error("Bridge event sink failed", error); }
    }
  }
  /** The hub refused edits stamped while this device's clock ran ahead, so no replica holds a clock of
   * ours beyond its bound. Re-stamp them there in their original order: above every clock the hub has
   * accepted, which they already outranked here, and accepted however wrong this clock still is. */
  function rebaseClocks(hubMs: number): number {
    const bound = hubMs + BRIDGE_MAX_CLOCK_SKEW_MS;
    return sqlite.transaction(() => {
      const ahead = sqlite.prepare("SELECT table_name,pk,register FROM bridge_row_clock WHERE origin=? AND physical_ms>? ORDER BY physical_ms,counter")
        .all(backendId, bound) as { table_name: string; pk: string; register: string }[];
      ahead.forEach((row, counter) => {
        sqlite.prepare("UPDATE bridge_row_clock SET physical_ms=?,counter=? WHERE table_name=? AND pk=? AND register=?").run(bound, counter, row.table_name, row.pk, row.register);
        // A sealed deletion carries its clock, so it is sealed again.
        if (row.register === "__delete__") sqlite.prepare("UPDATE bridge_tombstones SET envelope=NULL WHERE table_name=? AND pk=? AND json_extract(envelope,'$.header.origin')=?")
          .run(row.table_name, row.pk, backendId);
      });
      const top = sqlite.prepare("SELECT physical_ms,counter FROM bridge_row_clock ORDER BY physical_ms DESC,counter DESC LIMIT 1").get() as { physical_ms: number; counter: number } | undefined;
      const next = top && top.physical_ms >= bound ? top : { physical_ms: bound, counter: 0 };
      sqlite.prepare("UPDATE bridge_clock SET physical_ms=?,counter=? WHERE id=1 AND physical_ms>?").run(next.physical_ms, next.counter, bound);
      return ahead.length;
    })();
  }
  async function push(stream: BridgeStream, limit: number, deletesOnly = false, rebased = false, resigned = false): Promise<number> {
    validateLimit(limit);
    // Filter deferred generations BEFORE LIMIT so a full batch of bad files cannot starve later rows.
    const outgoing = () => sqlite.prepare(`SELECT * FROM bridge_outbox WHERE stream=? AND (?=1 OR substr(table_name,1,6)<>'atlas_') AND (?=0 OR op='delete')
      AND (retry_generation IS NULL OR retry_generation<>generation OR retry_after_ms<=?)
      ORDER BY CASE WHEN op='delete' THEN 0 ELSE 1 END,generation,table_name,pk,register LIMIT ?`).all(stream, Number(store.atlasEnabled), Number(deletesOnly), Date.now(), limit) as OutboxEntry[];
    let preparationError: unknown;
    // Disk/network work stays outside SQLite transactions. A changed generation
    // is left pending rather than receiving an older generation's manifest.
    const prepareFiles = async (entry: OutboxEntry) => {
      await options.blobs!.prepare(store, entry);
      if (options.blobs!.ready(store, entry)) await options.blobs!.values.prepare(store, entry);
    };
    const ready = (entry: OutboxEntry) => !options.blobs || options.blobs.ready(store, entry) && options.blobs.values.ready(store, entry);
    if (options.blobs) for (const entry of outgoing()) {
      if (!outboxInScope(store, entry)) continue;
      try {
        await prepareFiles(entry);
        if (entry.table_name === "run_attachment_refs" && entry.op === "upsert") {
          const attachmentId = (JSON.parse(entry.pk) as string[])[1];
          await prepareFiles({ ...entry, table_name: "run_attachments", pk: attachmentId, register: "row" });
        }
      } catch (cause) {
        if (/quota|rate limit|subscription required/i.test(String(cause))) preparationError ??= cause;
        else deferPreparation(entry, cause);
      }
    }
    const { prepared, attachmentCount } = sqlite.transaction(() => {
      const candidates = outgoing();
      const entries = candidates.filter((entry) => {
        if (!ready(entry)) return false;
        if (options.blobs && entry.table_name === "run_attachment_refs" && entry.op === "upsert" &&
            !ready({ ...entry, table_name: "run_attachments", pk: (JSON.parse(entry.pk) as string[])[1], register: "row" })) return false;
        if (outboxInScope(store, entry)) return true;
        sqlite.prepare("DELETE FROM bridge_outbox WHERE table_name=? AND pk=? AND register=? AND generation=?").run(entry.table_name, entry.pk, entry.register, entry.generation);
        return false;
      });
      const attachments = new Map<string, PreparedRecord>();
      for (const entry of entries) {
        if (entry.table_name !== "run_attachment_refs" || entry.op !== "upsert") continue;
        const attachmentId = (JSON.parse(entry.pk) as string[])[1];
        const clock = getClock(sqlite, "run_attachments", attachmentId, "row");
        if (!clock) throw new Error("A run attachment has no capture clock");
        // Forks can reference an existing attachment in a different lazy stream. Each stream
        // needs its own immutable metadata record, even when its original outbox was ACKed.
        attachments.set(attachmentId, prepareRecord(store, { ...entry, table_name: "run_attachments", pk: attachmentId, register: "row" }));
      }
      return { prepared: [...attachments.values(), ...entries.map((entry) => prepareRecord(store, entry))], attachmentCount: attachments.size };
    })();
    if (!prepared.length) { if (preparationError) throw preparationError; return 0; }
    const results = await transport.push(stream, prepared.map((record) => record.envelope));
    validateAcknowledgements(prepared, results);
    await options.prepareIncoming?.(results.flatMap((result) => "deleted" in result ? [result.deleted] : []));
    // A batch can accept new revisions whose encrypted Page identity is unknown
    // to the hub, then reject their Page pointer as deleted. Recover before any
    // accepted child is marked synced; otherwise its offline content disappears.
    let deletionRefused = false;
    for (let i = 0; i < results.length; i++) {
      const result = results[i], { entry } = prepared[i];
      if (!("deleted" in result)) continue;
      try { announce(applyDeletedAck(store, prepared[i], result.deleted)); }
      catch (error) {
        if (!isRejectedRecord(error)) throw error;
        console.warn(`[bridge] Refused the deletion returned for ${entry.table_name} ${entry.pk}: ${error.message}`);
        deletionRefused = true;
        continue;
      }
      // Attachment metadata has no outbox entry of its own; its reference is ACKed separately.
      if (i >= attachmentCount) clearAcknowledgedGeneration(store, entry);
    }
    let rejection: string | undefined, hubMs: number | undefined, stale = false;
    const failedAttachments = new Set(prepared.slice(0, attachmentCount).flatMap((sent, index) => "error" in results[index] ? [sent.entry.pk] : []));
    for (let i = 0; i < results.length; i++) {
      const result = results[i], sent = prepared[i], entry = sent.entry;
      if ("deleted" in result) continue;
      if ("error" in result) {
        if (result.error === "clockSkew") { hubMs ??= result.hubMs; continue; }
        if (result.error === "membershipStale") {
          // Forget the exact journaled envelope (and a kept tombstone) so the write is signed again.
          sqlite.transaction(() => {
            sqlite.prepare("DELETE FROM bridge_publications WHERE table_name=? AND pk=? AND register=? AND stream=?").run(entry.table_name, entry.pk, entry.register, entry.stream);
            if (entry.op === "delete") sqlite.prepare("UPDATE bridge_tombstones SET envelope=NULL WHERE table_name=? AND pk=?").run(entry.table_name, entry.pk);
          })();
          stale = true; continue;
        }
        if (result.error === "blobMissing" && options.blobs) {
          try { await options.blobs.republish(store, sent.clock); }
          catch (cause) {
            if (/quota|rate limit|subscription required/i.test(String(cause))) preparationError ??= cause;
            else if (i < attachmentCount) {
              // Synthetic file metadata has no outbox row. Its actual references must retain
              // their ACKs/retry state until this stream has acknowledged the file as well.
              for (const dependent of prepared.slice(attachmentCount)) if (dependent.entry.table_name === "run_attachment_refs" &&
                (JSON.parse(dependent.entry.pk) as string[])[1] === entry.pk) deferPreparation(dependent.entry, cause);
            } else deferPreparation(entry, cause);
            continue;
          }
        }
        rejection ??= result.error === "quotaExceeded" ? "Bridge storage quota exceeded; local changes remain queued" :
          result.error === "rateLimited" ? "Bridge write rate limit reached; local changes remain queued" :
          result.error === "subscriptionRequired" ? "Bridge subscription required; local changes remain queued" :
          result.error === "blobMissing" ? "Bridge files need republishing; local changes remain queued" : "Bridge hub rejected a non-owner write";
        continue;
      }
      if (entry.table_name === "run_attachment_refs" && failedAttachments.has((JSON.parse(entry.pk) as string[])[1])) continue;
      acknowledgePublication(store, sent, result.seq, i < attachmentCount);
      if (i < attachmentCount) continue;
      if (options.blobs) await options.blobs.acknowledged(sent.clock);
    }
    if (stale && !resigned && options.membershipStale && !rejection && !preparationError) {
      await options.membershipStale();
      return push(stream, limit, deletesOnly, rebased, true);
    }
    if (stale) rejection ??= "Bridge account membership changed; local changes remain queued";
    if (hubMs !== undefined && rebaseClocks(hubMs) && !rebased && !rejection && !preparationError) return push(stream, limit, deletesOnly, true, resigned);
    if (hubMs !== undefined) rejection ??= "This device's clock is ahead of Bridge; local changes remain queued";
    if (rejection) throw new Error(rejection);
    if (deletionRefused) throw new Error("Bridge returned an invalid deletion; local changes remain queued");
    if (preparationError) throw preparationError;
    return prepared.length - attachmentCount;
  }
  return {
    bootstrap(pageSize = 100) { return serial(() => receiving.bootstrap(pageSize)); },
    backfill(limit = 100) { return serial(async () => receiving.backfill(limit)); },
    push(stream: BridgeStream = "account", limit = 100, deletesOnly = false) { return serial(() => push(stream, limit, deletesOnly)); },
    pull(stream: BridgeStream = "account", limit = 100) { return serial(() => receiving.pull(stream, false, limit)); },
    /** The shared queue drains in-flight pushes before pulling; local SQL writers stay unblocked. */
    fullPull(stream: BridgeStream = "account", limit = 100) { return serial(() => receiving.pull(stream, true, limit)); },
    retryParked() { return serial(() => receiving.retryParked(true)); },
    pending() { return sqlite.prepare("SELECT * FROM bridge_outbox ORDER BY generation").all() as OutboxEntry[]; },
    canPushRun(runId: string) { return accountPublished("runs", runId); },
    blocked() {
      const where = "retry_generation=generation AND retry_error IS NOT NULL";
      const { total } = sqlite.prepare(`SELECT count(*) total FROM bridge_outbox WHERE ${where}`).get() as { total: number };
      const rows = sqlite.prepare(`SELECT table_name,pk,register,stream,retry_error,retry_attempts,retry_after_ms FROM bridge_outbox
        WHERE ${where} ORDER BY generation LIMIT 20`).all() as { table_name: string; pk: string; register: string; stream: string; retry_error: string; retry_attempts: number; retry_after_ms: number }[];
      const records: BridgeBlockedRecord[] = rows.map((row) => {
        const source = readRow(store, row.table_name, row.pk);
        return { table: row.table_name, pk: row.pk, register: row.register, stream: row.stream,
          label: String(source?.title ?? source?.name ?? source?.file_name ?? row.pk),
          error: row.retry_error, attempts: row.retry_attempts, retryAt: new Date(row.retry_after_ms).toISOString() };
      });
      return { total, records };
    },
    retryBlocked() { sqlite.prepare("UPDATE bridge_outbox SET retry_after_ms=0 WHERE retry_generation=generation AND retry_error IS NOT NULL").run(); },
    /** Pulled records set aside because this device could not verify or apply them. */
    unverified() { return (sqlite.prepare("SELECT count(*) AS n FROM bridge_parked WHERE reason=?").get(UNVERIFIED_REASON) as { n: number }).n; },
    stop() {
      if (stopping) return stopping;
      stopped = true;
      stopping = queue.then(() => { store.codec.destroy?.(); });
      return stopping;
    },
  };
}
export type BridgeEngine = ReturnType<typeof createBridgeEngine>;

function validateLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Bridge batch size must be between 1 and 1000");
}
