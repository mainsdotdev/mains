import type { BridgeEnvelope, BridgeLogRecord, BridgeStream } from "@mains/contracts/bridge-protocol";
import { applyBridgeBatch, openPulledRecord, RECHECK_REASON, UNVERIFIED_REASON, verifyEnvelope, type AppliedChange } from "./bridge.applier";
import type { BridgeBlobRecords } from "./bridge.blob-records";
import { portablePkSql } from "./bridge.capture";
import { BRIDGE_TABLES } from "./bridge.records";
import { definition, isAtlas, quote, syncedTables } from "./bridge.sql";
import { captureExisting, outboxInScope, type BridgeStore, type OutboxEntry } from "./bridge.store";
import type { BridgePullPage, BridgeTransport } from "./bridge.transport";
import { valueBlobBytes } from "./bridge.value-blobs";

interface BridgeReceiveOptions {
  store: BridgeStore;
  transport: BridgeTransport;
  blobs?: BridgeBlobRecords;
  stageLocalBeforePull?: boolean;
  prepareIncoming?: (envelopes: BridgeEnvelope[]) => Promise<void>;
  onApplied: (changes: AppliedChange[]) => void;
  assertActive: () => void;
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

/** Owns page admission/commit, durable parking retries and pull-before-backfill recovery.
 * The applier commits rows, dependency parking, recovery and the cursor in one transaction.
 * An admitted page may finish during stop; the next request/checkpoint cannot start. */
export function createBridgeReceiveLifecycle(options: BridgeReceiveOptions) {
  const { store, transport, onApplied: announce, assertActive } = options;
  const { sqlite, backendId } = store;
  let parkedCheckedAt: string | undefined, unverifiedChecked = false;
  const parkedState = () => JSON.stringify([
    (sqlite.prepare("SELECT total_changes() n").get() as { n: number }).n,
    sqlite.pragma("data_version", { simple: true }), sqlite.pragma("schema_version", { simple: true }),
    store.schemaVersion, store.atlasEnabled, store.filesEnabled,
  ]);
  function backfill(limit: number): { done: boolean; visited: number } {
    assertActive();
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
      const { opened } = openPulledRecord(store, stream, record.envelope);
      if (!opened) continue; // applyBridgeBatch sets it aside.
      const { body } = opened;
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
      const pending = sqlite.prepare("SELECT stream,seq,envelope FROM bridge_parked WHERE reason<>? ORDER BY seq").all(UNVERIFIED_REASON) as { stream: BridgeStream; seq: number; envelope: string }[];
      if (!pending.length || pending.length === previous) break;
      previous = pending.length;
      for (const entry of pending) {
        const record = { seq: entry.seq, envelope: JSON.parse(entry.envelope) }, { body } = verifyEnvelope(store, record.envelope);
        if ("schemaVersion" in body && body.schemaVersion <= store.schemaVersion && valueBlobBytes(body)) await applyRecords(entry.stream, [record]);
      }
    }
    parkedCheckedAt = parkedState();
  }
  /** Once per engine, a set-aside record rejoins the parked queue when an update now accepts it,
   * or when the hub serves a copy that verifies (the earlier one may have been damaged on the way,
   * or kept as its header only). A record the hub no longer serves was superseded and is dropped. */
  async function recheckUnverified() {
    if (unverifiedChecked) return;
    // The applier caps this durable quarantine. Recheck its whole snapshot before
    // marking this engine checked, or later rows would wait for another restart.
    const rows = sqlite.prepare("SELECT stream,seq,envelope FROM bridge_parked WHERE reason=? ORDER BY seq").all(UNVERIFIED_REASON) as { stream: BridgeStream; seq: number; envelope: string }[];
    for (const row of rows) {
      assertActive();
      let envelope = JSON.parse(row.envelope);
      if (!openPulledRecord(store, row.stream, envelope).opened) {
        // A refused deleted ACK has no log position (seq 0) to fetch again.
        if (row.seq < 1) continue;
        // Offline: a later pull of this engine checks again.
        const page = await transport.pull(row.stream, row.seq - 1, 1).catch(() => null);
        if (!page) return;
        validatePage(page, row.seq - 1, 1);
        const fresh = page.records[0];
        // Compaction keeps every register's latest record and every tombstone.
        if (fresh?.seq !== row.seq) { sqlite.prepare("DELETE FROM bridge_parked WHERE stream=? AND seq=? AND reason=?").run(row.stream, row.seq, UNVERIFIED_REASON); continue; }
        if (!openPulledRecord(store, row.stream, fresh.envelope).opened) continue;
        envelope = fresh.envelope;
      }
      sqlite.prepare("UPDATE bridge_parked SET reason=?,envelope=? WHERE stream=? AND seq=?").run(RECHECK_REASON, JSON.stringify(envelope), row.stream, row.seq);
    }
    unverifiedChecked = true;
  }
  async function pull(stream: BridgeStream, full: boolean, limit: number): Promise<number> {
    validateLimit(limit);
    await recheckUnverified();
    let after = full ? 0 : (sqlite.prepare("SELECT seq FROM bridge_cursors WHERE stream=?").get(stream) as { seq: number } | undefined)?.seq ?? 0;
    let count = 0, requestLimit = limit;
    for (;;) {
      assertActive();
      const page = await transport.pull(stream, after, requestLimit);
      validatePage(page, after, requestLimit);
      await options.prepareIncoming?.(page.records.map((record) => record.envelope));
      // Authenticate the entire page before downloading bytes or mutating SQL.
      // A record that fails is set aside by the apply below, not retried forever.
      let restoredBytes = 0;
      for (const record of page.records) {
        const { opened } = openPulledRecord(store, stream, record.envelope);
        if (!opened) continue;
        const { body } = opened;
        if ("schemaVersion" in body && body.schemaVersion <= store.schemaVersion) restoredBytes += valueBlobBytes(body);
      }
      // A register is bounded to 50 MiB; avoid multiplying that by a large page.
      if (options.blobs && restoredBytes > 16 * 1024 * 1024 && page.records.length > 1) { requestLimit = 1; continue; }
      await applyRecords(stream, page.records, page.next);
      count += page.records.length; after = page.next;
      assertActive();
      if (!page.hasMore) { await retryParked(); return count; }
    }
  }
  return {
    /** Pull through the durable account prefix before capturing untouched installation seeds. */
    async bootstrap(pageSize = 100) {
      validateLimit(pageSize);
      assertActive();
      if (options.stageLocalBeforePull) {
        for (const table of backfillTables) {
          const pkSql = portablePkSql(table, "r"); let after = "";
          for (;;) {
            assertActive();
            const batch = sqlite.prepare(`SELECT ${pkSql} pk FROM ${quote(table)} r WHERE ${pkSql}>? ORDER BY ${pkSql} LIMIT 100`).all(after) as { pk: string }[];
            sqlite.transaction(() => { for (const row of batch) if (table !== "accounts" && !(table === "spaces" && ["claude","codex","copilot","cursor"].includes(row.pk))) captureExisting(store, table, row.pk); })();
            if (!batch.length) break;
            after = batch.at(-1)!.pk; await new Promise<void>((resolve) => setImmediate(resolve));
          }
        }
        sqlite.exec("UPDATE bridge_config SET enrollment_staging=0 WHERE id=1");
      }
      await pull("account", false, pageSize);
      while (!backfill(100).done) await new Promise<void>((resolve) => setImmediate(resolve));
    },
    backfill,
    pull,
    retryParked,
  };
}

function validateLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Bridge batch size must be between 1 and 1000");
}

/** Recovery reads obey the same progress and ordering contract as ordinary pulls. */
function validatePage(page: BridgePullPage, after: number, limit: number) {
  if (!Number.isSafeInteger(page.next) || page.next < after || page.records.length > limit || page.records.some((record, index) =>
      !Number.isSafeInteger(record.seq) || record.seq <= (index ? page.records[index - 1].seq : after) || record.seq > page.next) || page.hasMore && page.next === after)
    throw new Error("Invalid Bridge pull page");
}
