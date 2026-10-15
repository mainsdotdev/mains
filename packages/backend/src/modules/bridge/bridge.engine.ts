import type { BridgeStream } from "@mains/contracts/bridge-protocol";
import { CHANNELS } from "@mains/contracts/channels";
import type { SQLiteInstance } from "../../db/types";
import { emit } from "../../ipc-kit/event-bus";
import { installBridgeCapture, portablePkSql } from "./bridge.capture";
import { bridgePassThroughCodec, type BridgeCodec } from "./bridge.crypto";
import { applyBridgeBatch, applyDeletedAck, type AppliedChange } from "./bridge.applier";
import { definition, getClock, isAtlas, quote, syncedTables } from "./bridge.sql";
import { captureExisting, inScope, prepareRecord, type BridgeRecoveryContext, type BridgeStore, type OutboxEntry, type PreparedRecord } from "./bridge.store";
import type { BridgeTransport } from "./bridge.transport";
import type { BridgeBlobRecords } from "./bridge.blob-records";
import { recoverAtlasPage } from "./bridge.atlas";

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
    schemaVersion: options.schemaVersion ?? 2, atlasEnabled: options.experimentalAtlas ?? true,
    recover(context) { recoverAtlasPage(context); options.recover?.(context); }, filesEnabled: !!options.blobs };
  sqlite.transaction(() => {
    sqlite.prepare(`INSERT INTO bridge_config(id,backend_id,enabled,atlas_enabled) VALUES(1,?,1,?)
      ON CONFLICT(id) DO UPDATE SET enabled=1,atlas_enabled=excluded.atlas_enabled`).run(backendId, Number(store.atlasEnabled));
    if (store.atlasEnabled && existing?.atlas_enabled === 0) sqlite.prepare("UPDATE bridge_config SET backfill_done=0,backfill_table=NULL,backfill_pk=NULL WHERE id=1").run();
    installBridgeCapture(sqlite);
  })();
  let stopped = false;
  let queue: Promise<unknown> = Promise.resolve();
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
      const progress = sqlite.prepare("SELECT backfill_table,backfill_pk,backfill_done FROM bridge_config WHERE id=1").get() as { backfill_table: string | null; backfill_pk: string | null; backfill_done: number };
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
          if (row.pk) captureExisting(store, table, row.pk);
          visited++;
          sqlite.prepare("UPDATE bridge_config SET backfill_table=?,backfill_pk=? WHERE id=1").run(table, row.pk);
        }
        if (visited >= limit) return { done: false, visited };
        sqlite.prepare("UPDATE bridge_config SET backfill_table=?,backfill_pk=NULL WHERE id=1").run(backfillTables[i + 1] ?? null);
      }
      sqlite.prepare("UPDATE bridge_config SET backfill_done=1 WHERE id=1").run();
      return { done: true, visited };
    })();
  }
  async function pull(stream: BridgeStream, full: boolean, limit: number): Promise<number> {
    validateLimit(limit);
    let after = full ? 0 : (sqlite.prepare("SELECT seq FROM bridge_cursors WHERE stream=?").get(stream) as { seq: number } | undefined)?.seq ?? 0;
    let count = 0;
    for (;;) {
      const page = await transport.pull(stream, after, limit);
      if (!Number.isSafeInteger(page.next) || page.next < after || page.records.some((record, index) =>
          !Number.isSafeInteger(record.seq) || record.seq <= (index ? page.records[index - 1].seq : after) || record.seq > page.next) || page.hasMore && page.next === after)
        throw new Error("Invalid Bridge pull page");
      announce(applyBridgeBatch(store, stream, page.records, page.next));
      count += page.records.length; after = page.next;
      if (!page.hasMore) return count;
    }
  }
  async function push(stream: BridgeStream, limit: number): Promise<number> {
    validateLimit(limit);
    const outgoing = () => sqlite.prepare(`SELECT * FROM bridge_outbox WHERE stream=? AND (?=1 OR substr(table_name,1,6)<>'atlas_')
      ORDER BY generation,table_name,pk,register LIMIT ?`).all(stream, Number(store.atlasEnabled), limit) as OutboxEntry[];
    // Disk/network work stays outside SQLite transactions. A changed generation
    // is left pending rather than receiving an older generation's manifest.
    if (options.blobs) for (const entry of outgoing()) {
      if (!inScope(store, entry.table_name, entry.pk) || entry.run_id && !inScope(store, "runs", entry.run_id)) continue;
      await options.blobs.prepare(store, entry);
      if (entry.table_name === "run_attachment_refs" && entry.op === "upsert") {
        const attachmentId = (JSON.parse(entry.pk) as string[])[1];
        await options.blobs.prepare(store, { ...entry, table_name: "run_attachments", pk: attachmentId, register: "row" });
      }
    }
    const { prepared, attachmentCount } = sqlite.transaction(() => {
      const candidates = outgoing();
      const entries = candidates.filter((entry) => {
        if (options.blobs && !options.blobs.ready(store, entry)) return false;
        if (options.blobs && entry.table_name === "run_attachment_refs" && entry.op === "upsert" &&
            !options.blobs.ready(store, { ...entry, table_name: "run_attachments", pk: (JSON.parse(entry.pk) as string[])[1], register: "row" })) return false;
        if (inScope(store, entry.table_name, entry.pk) && (!entry.run_id || inScope(store, "runs", entry.run_id))) return true;
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
    if (!prepared.length) return 0;
    const results = await transport.push(stream, prepared.map((record) => record.envelope));
    if (results.length !== prepared.length) throw new Error("Bridge ACK count does not match the push");
    // A batch can accept new revisions whose encrypted Page identity is unknown
    // to the hub, then reject their Page pointer as deleted. Recover before any
    // accepted child is marked synced; otherwise its offline content disappears.
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if ("deleted" in result) announce(applyDeletedAck(store, prepared[i], result.deleted));
    }
    for (let i = 0; i < results.length; i++) {
      const result = results[i], sent = prepared[i], entry = sent.entry;
      if ("deleted" in result) continue;
      if ("error" in result) throw new Error("Bridge hub rejected a non-owner write");
      if (!Number.isSafeInteger(result.seq) || result.seq < 1) throw new Error("Invalid Bridge ACK sequence");
      if (i < attachmentCount) continue;
      sqlite.transaction(() => {
        const clock = getClock(sqlite, entry.table_name, entry.pk, entry.register);
        if (clock && clock.physical_ms === sent.clock.physical_ms && clock.counter === sent.clock.counter && clock.origin === sent.clock.origin)
          sqlite.prepare("UPDATE bridge_row_clock SET synced_seq=max(coalesce(synced_seq,0),?) WHERE table_name=? AND pk=? AND register=?").run(result.seq, entry.table_name, entry.pk, entry.register);
        sqlite.prepare("DELETE FROM bridge_outbox WHERE table_name=? AND pk=? AND register=? AND generation=?").run(entry.table_name, entry.pk, entry.register, entry.generation);
      })();
      if (options.blobs) await options.blobs.acknowledged(sent.clock);
    }
    return prepared.length - attachmentCount;
  }
  return {
    /** Full account pull precedes first backfill, so untouched fixed-id seeds do not win by installation time. */
    bootstrap(pageSize = 100) {
      return serial(async () => {
        await pull("account", true, pageSize);
        while (!backfill(100).done) await new Promise<void>((resolve) => setImmediate(resolve));
      });
    },
    backfill(limit = 100) { return serial(async () => backfill(limit)); },
    push(stream: BridgeStream = "account", limit = 100) { return serial(() => push(stream, limit)); },
    pull(stream: BridgeStream = "account", limit = 100) { return serial(() => pull(stream, false, limit)); },
    /** The shared queue drains in-flight pushes before pulling; local SQL writers stay unblocked. */
    fullPull(stream: BridgeStream = "account", limit = 100) { return serial(() => pull(stream, true, limit)); },
    retryParked() { return serial(async () => { announce(applyBridgeBatch(store, "account", [])); }); },
    pending() { return sqlite.prepare("SELECT * FROM bridge_outbox ORDER BY generation").all() as OutboxEntry[]; },
    async stop() { await queue; stopped = true; },
  };
}
export type BridgeEngine = ReturnType<typeof createBridgeEngine>;

function validateLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Bridge batch size must be between 1 and 1000");
}
