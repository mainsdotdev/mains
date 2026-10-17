import type { BridgeLogRecord, BridgeStream } from "@mains/contracts/bridge-protocol";
import { CHANNELS } from "@mains/contracts/channels";
import type { SQLiteInstance } from "../../db/types";
import { emit } from "../../ipc-kit/event-bus";
import { installBridgeCapture, portablePkSql } from "./bridge.capture";
import { bridgePassThroughCodec, type BridgeCodec } from "./bridge.crypto";
import { applyBridgeBatch, applyDeletedAck, verifyEnvelope, type AppliedChange } from "./bridge.applier";
import { definition, getClock, isAtlas, quote, syncedTables } from "./bridge.sql";
import { captureExisting, outboxInScope, prepareRecord, type BridgeRecoveryContext, type BridgeStore, type OutboxEntry, type PreparedRecord } from "./bridge.store";
import type { BridgeTransport } from "./bridge.transport";
import type { BridgeBlobRecords } from "./bridge.blob-records";
import { recoverAtlasPage } from "./bridge.atlas";
import { valueBlobBytes } from "./bridge.value-blobs";
import { BRIDGE_TABLES } from "./bridge.records";

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
}
const backfillTables = dependencyOrder();
function dependencyOrder(): string[] {
  const result: string[] = [], visiting = new Set<string>();
  function visit(table: string) {
    if (result.includes(table) || visiting.has(table)) return;
    visiting.add(table);
    for (const reference of Object.values(definition(table).references)) if (reference.class === "required") visit(reference.table);
    visiting.delete(table); result.push(table);
  }
  for (const [table] of syncedTables) visit(table);
  return result;
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
    schemaVersion: options.schemaVersion ?? 4, wireSchemaVersion: options.schemaVersion ?? 3, atlasEnabled: options.experimentalAtlas ?? true,
    recover(context) { recoverAtlasPage(context); options.recover?.(context); }, filesEnabled: !!options.blobs };
  sqlite.transaction(() => {
    sqlite.prepare(`INSERT INTO bridge_config(id,backend_id,enabled,tracking_enabled,atlas_enabled) VALUES(1,?,1,1,?)
      ON CONFLICT(id) DO UPDATE SET enabled=1,tracking_enabled=1,atlas_enabled=excluded.atlas_enabled`).run(backendId, Number(store.atlasEnabled));
    if (store.atlasEnabled && existing?.atlas_enabled === 0) sqlite.prepare("UPDATE bridge_config SET backfill_done=0,backfill_table=NULL,backfill_pk=NULL WHERE id=1").run();
    installBridgeCapture(sqlite);
  })();
  let stopped = false;
  let queue: Promise<unknown> = Promise.resolve();
  let parkedCheckedAt: string | undefined;
  const parkedState = () => JSON.stringify([
    (sqlite.prepare("SELECT total_changes() n").get() as { n: number }).n,
    sqlite.pragma("data_version", { simple: true }), sqlite.pragma("schema_version", { simple: true }),
    store.schemaVersion, store.atlasEnabled, store.filesEnabled,
  ]);
  function serial<T>(work: () => Promise<T>): Promise<T> {
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
  function backfill(limit: number): { done: boolean; visited: number } {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid Bridge backfill limit");
    return sqlite.transaction(() => {
      const progress = sqlite.prepare("SELECT backfill_table,backfill_pk,backfill_done,blob_roots_version FROM bridge_config WHERE id=1").get() as { backfill_table: string | null; backfill_pk: string | null; backfill_done: number; blob_roots_version: number };
      if (progress.backfill_done) return { done: true, visited: 0 };
      let visited = 0;
      const start = progress.backfill_table ? backfillTables.indexOf(progress.backfill_table) : 0;
      for (let i = Math.max(start, 0); i < backfillTables.length; i++) {
        const table = backfillTables[i];
        if (isAtlas(table) && !store.atlasEnabled) continue;
        const pkSql = portablePkSql(table, "r");
        const after = table === progress.backfill_table ? progress.backfill_pk ?? "" : "";
        const rows = sqlite.prepare(`SELECT ${pkSql} AS pk FROM ${quote(table)} r WHERE ${pkSql}>? ORDER BY ${pkSql} LIMIT ?`).all(after, limit - visited) as { pk: string }[];
        for (const row of rows) {
          if (row.pk) captureExisting(store, table, row.pk, progress.blob_roots_version < 1);
          visited++;
          sqlite.prepare("UPDATE bridge_config SET backfill_table=?,backfill_pk=? WHERE id=1").run(table, row.pk);
        }
        if (visited >= limit) return { done: false, visited };
        sqlite.prepare("UPDATE bridge_config SET backfill_table=?,backfill_pk=NULL WHERE id=1").run(backfillTables[i + 1] ?? null);
      }
      const deletes = sqlite.prepare(`SELECT t.table_name,t.pk,t.stream,t.owner,t.run_id,c.physical_ms FROM bridge_tombstones t JOIN bridge_row_clock c
        ON c.table_name=t.table_name AND c.pk=t.pk AND c.register='__delete__' WHERE c.dirty=1 AND c.origin=?
        AND NOT EXISTS(SELECT 1 FROM bridge_outbox o WHERE o.table_name=t.table_name AND o.pk=t.pk AND o.register='__delete__')`).all(backendId) as (OutboxEntry & { physical_ms: number })[];
      for (const entry of deletes) if (outboxInScope(store, { ...entry, op: "delete" })) {
        sqlite.exec("UPDATE bridge_clock SET generation=generation+1 WHERE id=1");
        sqlite.prepare(`INSERT INTO bridge_outbox(table_name,pk,register,op,generation,stream,owner,run_id,changed_at)
          VALUES(?,?,'__delete__','delete',(SELECT generation FROM bridge_clock WHERE id=1),?,?,?,?)`).run(entry.table_name, entry.pk, entry.stream, entry.owner, entry.run_id, entry.physical_ms);
      }
      sqlite.prepare("UPDATE bridge_config SET backfill_done=1,blob_roots_version=1 WHERE id=1").run();
      return { done: true, visited };
    })();
  }
  async function applyRecords(stream: BridgeStream, records: BridgeLogRecord[], cursor?: number) {
    if (!records.length) {
      // An empty page can advance past compacted log entries without changing
      // any dependency. Do not count our own cursor bookkeeping as a reason to
      // decrypt the durable parked queue again on the next idle pull.
      const unchanged = parkedCheckedAt === parkedState();
      if (cursor !== undefined) sqlite.prepare(`INSERT INTO bridge_cursors(stream,seq) VALUES(?,?)
        ON CONFLICT(stream) DO UPDATE SET seq=excluded.seq WHERE bridge_cursors.seq<excluded.seq`).run(stream, cursor);
      if (unchanged) parkedCheckedAt = parkedState();
      return;
    }
    const values = new Map<string, string>();
    for (const record of records) {
      const { body, header } = verifyEnvelope(store, record.envelope);
      if (header.stream !== stream) throw new Error("Bridge pull contains a different stream");
      if (options.blobs && "schemaVersion" in body && body.schemaVersion <= store.schemaVersion && BRIDGE_TABLES[body.table] && BRIDGE_TABLES[body.table].class !== "local") {
        for (const [key, value] of await options.blobs.values.restore(body, values)) values.set(key, value);
      }
    }
    store.materializedValues = values;
    try { announce(applyBridgeBatch(store, stream, records, cursor)); }
    finally { store.materializedValues = undefined; }
  }
  async function retryParked(force = false) {
    if (!force && parkedCheckedAt === parkedState()) return;
    // Keep failures retryable even if no further SQL data changes. No opened
    // plaintext is retained between calls; restart/capability changes recheck.
    parkedCheckedAt = undefined;
    announce(applyBridgeBatch(store, "account", []));
    if (!options.blobs) { parkedCheckedAt = parkedState(); return; }
    let previous = -1;
    for (;;) {
      const pending = sqlite.prepare("SELECT stream,seq,envelope FROM bridge_parked ORDER BY seq").all() as { stream: BridgeStream; seq: number; envelope: string }[];
      if (!pending.length || pending.length === previous) break;
      previous = pending.length;
      for (const entry of pending) {
        const record = { seq: entry.seq, envelope: JSON.parse(entry.envelope) }, { body } = verifyEnvelope(store, record.envelope);
        if ("schemaVersion" in body && body.schemaVersion <= store.schemaVersion && valueBlobBytes(body)) await applyRecords(entry.stream, [record]);
      }
    }
    parkedCheckedAt = parkedState();
  }
  async function pull(stream: BridgeStream, full: boolean, limit: number): Promise<number> {
    validateLimit(limit);
    let after = full ? 0 : (sqlite.prepare("SELECT seq FROM bridge_cursors WHERE stream=?").get(stream) as { seq: number } | undefined)?.seq ?? 0;
    let count = 0, requestLimit = limit;
    for (;;) {
      const page = await transport.pull(stream, after, requestLimit);
      if (!Number.isSafeInteger(page.next) || page.next < after || page.records.length > requestLimit || page.records.some((record, index) =>
          !Number.isSafeInteger(record.seq) || record.seq <= (index ? page.records[index - 1].seq : after) || record.seq > page.next) || page.hasMore && page.next === after)
        throw new Error("Invalid Bridge pull page");
      // Authenticate the entire page before downloading bytes or mutating SQL.
      let restoredBytes = 0;
      for (const record of page.records) {
        const { body, header } = verifyEnvelope(store, record.envelope);
        if (header.stream !== stream) throw new Error("Bridge pull contains a different stream");
        if ("schemaVersion" in body && body.schemaVersion <= store.schemaVersion) restoredBytes += valueBlobBytes(body);
      }
      // A register is bounded to 50 MiB; avoid multiplying that by a large page.
      if (options.blobs && restoredBytes > 16 * 1024 * 1024 && page.records.length > 1) { requestLimit = 1; continue; }
      await applyRecords(stream, page.records, page.next);
      count += page.records.length; after = page.next;
      if (!page.hasMore) { await retryParked(); return count; }
    }
  }
  async function push(stream: BridgeStream, limit: number, deletesOnly = false): Promise<number> {
    validateLimit(limit);
    const outgoing = () => sqlite.prepare(`SELECT * FROM bridge_outbox WHERE stream=? AND (?=1 OR substr(table_name,1,6)<>'atlas_') AND (?=0 OR op='delete')
      ORDER BY CASE WHEN op='delete' THEN 0 ELSE 1 END,generation,table_name,pk,register LIMIT ?`).all(stream, Number(store.atlasEnabled), Number(deletesOnly), limit) as OutboxEntry[];
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
        if (!/quota|rate limit|subscription required/i.test(String(cause))) throw cause;
        preparationError ??= cause;
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
    if (results.length !== prepared.length) throw new Error("Bridge ACK count does not match the push");
    // A batch can accept new revisions whose encrypted Page identity is unknown
    // to the hub, then reject their Page pointer as deleted. Recover before any
    // accepted child is marked synced; otherwise its offline content disappears.
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if ("deleted" in result) announce(applyDeletedAck(store, prepared[i], result.deleted));
    }
    let rejection: string | undefined;
    for (let i = 0; i < results.length; i++) {
      const result = results[i], sent = prepared[i], entry = sent.entry;
      if ("deleted" in result) continue;
      if ("error" in result) {
        if (result.error === "blobMissing" && options.blobs) await options.blobs.republish(store, sent.clock);
        rejection ??= result.error === "quotaExceeded" ? "Bridge storage quota exceeded; local changes remain queued" :
          result.error === "rateLimited" ? "Bridge write rate limit reached; local changes remain queued" :
          result.error === "subscriptionRequired" ? "Bridge subscription required; local changes remain queued" :
          result.error === "blobMissing" ? "Bridge files need republishing; local changes remain queued" : "Bridge hub rejected a non-owner write";
        continue;
      }
      if (!Number.isSafeInteger(result.seq) || result.seq < 1) throw new Error("Invalid Bridge ACK sequence");
      if (i < attachmentCount) continue;
      sqlite.transaction(() => {
        const clock = getClock(sqlite, entry.table_name, entry.pk, entry.register);
        if (clock && clock.physical_ms === sent.clock.physical_ms && clock.counter === sent.clock.counter && clock.origin === sent.clock.origin)
          sqlite.prepare("UPDATE bridge_row_clock SET synced_seq=max(coalesce(synced_seq,0),?),dirty=0,last_ack_ms=? WHERE table_name=? AND pk=? AND register=?").run(result.seq, Date.now(), entry.table_name, entry.pk, entry.register);
        sqlite.prepare("DELETE FROM bridge_outbox WHERE table_name=? AND pk=? AND register=? AND generation=?").run(entry.table_name, entry.pk, entry.register, entry.generation);
      })();
      if (options.blobs) await options.blobs.acknowledged(sent.clock);
    }
    if (rejection) throw new Error(rejection);
    if (preparationError) throw preparationError;
    return prepared.length - attachmentCount;
  }
  return {
    /** Full account pull precedes first backfill, so untouched fixed-id seeds do not win by installation time. */
    bootstrap(pageSize = 100) {
      return serial(async () => {
        if (options.stageLocalBeforePull) {
          for (const table of backfillTables) {
            const pkSql = portablePkSql(table, "r"); let after = "";
            for (;;) {
              const batch = sqlite.prepare(`SELECT ${pkSql} pk FROM ${quote(table)} r WHERE ${pkSql}>? ORDER BY ${pkSql} LIMIT 100`).all(after) as { pk: string }[];
              sqlite.transaction(() => { for (const row of batch) if (table !== "accounts" && !(table === "spaces" && ["claude","codex","copilot","cursor"].includes(row.pk))) captureExisting(store, table, row.pk); })();
              if (!batch.length) break;
              after = batch.at(-1)!.pk; await new Promise<void>((resolve) => setImmediate(resolve));
            }
          }
          sqlite.exec("UPDATE bridge_config SET enrollment_staging=0 WHERE id=1");
        }
        await pull("account", true, pageSize);
        while (!backfill(100).done) await new Promise<void>((resolve) => setImmediate(resolve));
      });
    },
    backfill(limit = 100) { return serial(async () => backfill(limit)); },
    push(stream: BridgeStream = "account", limit = 100, deletesOnly = false) { return serial(() => push(stream, limit, deletesOnly)); },
    pull(stream: BridgeStream = "account", limit = 100) { return serial(() => pull(stream, false, limit)); },
    /** The shared queue drains in-flight pushes before pulling; local SQL writers stay unblocked. */
    fullPull(stream: BridgeStream = "account", limit = 100) { return serial(() => pull(stream, true, limit)); },
    retryParked() { return serial(() => retryParked(true)); },
    pending() { return sqlite.prepare("SELECT * FROM bridge_outbox ORDER BY generation").all() as OutboxEntry[]; },
    async stop() { await queue; stopped = true; },
  };
}
export type BridgeEngine = ReturnType<typeof createBridgeEngine>;

function validateLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Bridge batch size must be between 1 and 1000");
}
