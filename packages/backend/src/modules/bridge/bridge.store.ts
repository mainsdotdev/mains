import type { BridgeEnvelope, BridgeHeader, BridgeStream, BridgeUpsertBody, BridgeValue } from "@mains/contracts/bridge-protocol";
import type { SQLiteInstance } from "../../db/types";
import { bridgeRecordKeys, type BridgeCodec } from "./bridge.crypto";
import { BRIDGE_TABLES } from "./bridge.records";
import { ownerSql, runIdSql, tickSql } from "./bridge.capture";
import { aliasSet, canonicalPk, clockOf, compareClock, definition, getClock, isAtlas, quote, rowWhere, type RowClock, type SqlRow } from "./bridge.sql";

export interface BridgeRecoveryContext {
  sqlite: SQLiteInstance; table: string; pk: string; row: SqlRow;
  /** Rows must be created synchronously in this transaction. Capture them after the delete. */
  captureAfterDelete(table: string, pk: string, blobRefsJson?: string): void;
}
export interface BridgeStore {
  sqlite: SQLiteInstance; backendId: string; recordKey: Uint8Array; codec: BridgeCodec;
  schemaVersion: number; atlasEnabled: boolean;
  filesEnabled?: boolean;
  recover?: (context: BridgeRecoveryContext) => void;
}
export interface OutboxEntry {
  table_name: string; pk: string; register: string; op: "upsert" | "delete";
  generation: number; stream: BridgeStream; owner: string | null; run_id: string | null; changed_at: number;
}
export interface PreparedRecord { entry: OutboxEntry; envelope: BridgeEnvelope; clock: RowClock }
export function physicalPk(store: BridgeStore, table: string, pk: string, owner: string): string | number | undefined {
  const def = definition(table);
  if (def.idKind === "composite") {
    const values: (string | number)[] = JSON.parse(canonicalPk(store.sqlite, table, pk));
    return JSON.stringify(values.map((value, index) => {
      const reference = def.references[def.primaryKey[index]];
      return reference && reference.class !== "local" && reference.class !== "seeded" ? canonicalPk(store.sqlite, reference.table, String(value)) : value;
    }));
  }
  if (def.idKind !== "run-integer") return canonicalPk(store.sqlite, table, pk);
  const mapped = (store.sqlite.prepare("SELECT local_id FROM bridge_id_map WHERE owner_backend_id=? AND table_name=? AND remote_id=?").get(owner, table, pk) as { local_id: number } | undefined)?.local_id;
  if (mapped !== undefined) return mapped;
  if (owner === store.backendId) return Number(pk.slice(pk.lastIndexOf(":") + 1));
  return undefined;
}
export function readRow(store: BridgeStore, table: string, pk: string, owner = store.backendId): SqlRow | undefined {
  const key = physicalPk(store, table, pk, owner);
  if (key === undefined) return undefined;
  const where = rowWhere(definition(table), String(key));
  const row = store.sqlite.prepare(`SELECT * FROM ${quote(table)} WHERE ${where.sql}`).get(...where.args) as SqlRow | undefined;
  if (row && definition(table).idKind === "run-integer" && row.run_id !== pk.slice(0, pk.lastIndexOf(":"))) return undefined;
  return row;
}
export function bestClock(store: BridgeStore, table: string, pk: string, register: string): RowClock | undefined {
  return aliasSet(store.sqlite, table, pk).map((id) => getClock(store.sqlite, table, id, register)).filter((clock): clock is RowClock => !!clock)
    .sort((a, b) => compareClock(clockOf(b), clockOf(a)))[0];
}
export function inScope(store: BridgeStore, table: string, pk: string, seen = new Set<string>()): boolean {
  const identity = JSON.stringify([table, pk]);
  if (seen.has(identity)) return true;
  seen.add(identity);
  if (store.sqlite.prepare("SELECT 1 FROM bridge_exclusions WHERE table_name=? AND pk=?").get(table, pk)) return false;
  const def = definition(table);
  const row = readRow(store, table, pk);
  if (!row) return true; // Deleted rows still need to publish their tombstone.
  for (const [column, reference] of Object.entries(def.references)) {
    if (reference.class !== "required" || row[column] == null || BRIDGE_TABLES[reference.table].idKind === "run-integer") continue;
    if (!inScope(store, reference.table, String(row[column]), seen)) return false;
  }
  return true;
}
function describe(row: SqlRow | undefined, table: string): Record<string, unknown> {
  if (!row) return { table };
  return table === "runs" ? { runTitle: row.title, backendId: row.owner_backend_id } :
    { title: row.title ?? row.name, externalId: row.external_id ?? row.id, connectionKind: row.source ?? row.kind };
}
export function portableValues(store: BridgeStore, table: string, clock: RowClock): Pick<BridgeUpsertBody, "values" | "refs"> {
  const def = definition(table), values: Record<string, BridgeValue> = JSON.parse(clock.values_json);
  const refs: Record<string, unknown> = JSON.parse(clock.refs_json);
  // Retry local images made by older JSON1 capture triggers without reading a
  // newer row or changing its capture clock. Wire records still require scalars.
  if (!clock.portable) for (const [column, value] of Object.entries(values)) {
    if (value !== null && typeof value === "object") values[column] = JSON.stringify(value);
  }
  if (def.idKind === "run-integer") values.id = clock.pk;
  for (const [column, reference] of Object.entries(def.references)) {
    const value = values[column];
    if (value === null || value === undefined) continue;
    if (reference.class === "local") {
      const row = store.sqlite.prepare(`SELECT * FROM ${quote(reference.table)} WHERE id=?`).get(value) as SqlRow | undefined;
      refs[column] = describe(row, reference.table); values[column] = null;
    } else if (reference.class === "optional") {
      if (!inScope(store, reference.table, String(value))) { refs[column] = describe(readRow(store, reference.table, String(value)), reference.table); values[column] = null; }
    } else if (BRIDGE_TABLES[reference.table].idKind === "run-integer" && !clock.portable) {
      const row = store.sqlite.prepare(`SELECT run_id FROM ${quote(reference.table)} WHERE id=?`).get(value) as { run_id: string } | undefined;
      const mapped = (store.sqlite.prepare("SELECT remote_id FROM bridge_id_map WHERE owner_backend_id=? AND table_name=? AND local_id=?").get(store.backendId, reference.table, value) as { remote_id: string } | undefined)?.remote_id;
      const runId = row?.run_id ?? values.run_id;
      if (!mapped && !runId) throw new Error(`Missing local Bridge parent: ${reference.table}`);
      values[column] = mapped ?? `${runId}:${value}`;
    } else if (reference.class !== "seeded" && BRIDGE_TABLES[reference.table].idKind === "text") {
      values[column] = canonicalPk(store.sqlite, reference.table, String(value));
    }
  }
  // Paths describe the source filesystem. Replicas open authenticated blob manifests.
  if (table === "run_artifacts") {
    if (values.path) refs.path = { path: values.path };
    values.path = null; values.blob_data = null;
  }
  return { values, refs };
}

/** A parent alias can also change the physical key of a join row. Keep those aliases
 * even after its outbox was ACKed, so a later local delete covers the old wire identity. */
export function normalizeCompositeIdentity(store: BridgeStore, table: string, oldPk: string): void {
  const pk = String(physicalPk(store, table, oldPk, store.backendId));
  if (pk === oldPk) return;
  const members = aliasSet(store.sqlite, table, oldPk);
  for (const member of members) {
    if (member === pk) continue;
    store.sqlite.prepare("INSERT OR REPLACE INTO bridge_aliases(table_name,alias_pk,canonical_pk) VALUES(?,?,?)").run(table, member, pk);
    store.sqlite.prepare("UPDATE bridge_aliases SET canonical_pk=? WHERE table_name=? AND canonical_pk=?").run(pk, table, member);
  }
  for (const register of Object.keys(definition(table).registers)) {
    const winner = bestClock(store, table, pk, register);
    if (!winner) continue;
    const image = portableValues(store, table, winner);
    store.sqlite.prepare(`INSERT INTO bridge_row_clock(table_name,pk,register,physical_ms,counter,origin,synced_seq,values_json,refs_json,blob_refs_json,portable)
      VALUES(?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(table_name,pk,register) DO UPDATE SET physical_ms=excluded.physical_ms,counter=excluded.counter,
      origin=excluded.origin,values_json=excluded.values_json,refs_json=excluded.refs_json,blob_refs_json=excluded.blob_refs_json,portable=1`)
      .run(table, pk, register, winner.physical_ms, winner.counter, winner.origin, winner.pk === pk ? winner.synced_seq : null, JSON.stringify(image.values), JSON.stringify(image.refs), winner.blob_refs_json);
    const pending = store.sqlite.prepare("SELECT * FROM bridge_outbox WHERE table_name=? AND pk=? AND register=?").get(table, winner.pk, register) as OutboxEntry | undefined;
    for (const member of new Set([...members, pk])) store.sqlite.prepare("DELETE FROM bridge_outbox WHERE table_name=? AND pk=? AND register=?").run(table, member, register);
    if (pending) store.sqlite.prepare(`INSERT INTO bridge_outbox(table_name,pk,register,op,generation,stream,owner,run_id,changed_at) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(table_name,pk,register) DO UPDATE SET generation=excluded.generation,op=excluded.op,changed_at=excluded.changed_at`)
      .run(table, pk, register, pending.op, pending.generation, pending.stream, pending.owner, pending.run_id, pending.changed_at);
  }
}
export function prepareRecord(store: BridgeStore, entry: OutboxEntry): PreparedRecord {
  const clock = getClock(store.sqlite, entry.table_name, entry.pk, entry.register);
  if (!clock) throw new Error("Bridge outbox has no capture clock");
  const keys = bridgeRecordKeys(store.recordKey, entry.table_name, entry.pk, entry.op === "upsert" ? entry.register : undefined);
  const base = { v: 1 as const, stream: entry.stream, rowKey: keys.rowKey,
    hlc: { physicalMs: clock.physical_ms, counter: clock.counter }, origin: clock.origin,
    ...(entry.owner ? { owner: entry.owner } : {}), ...(entry.run_id ? { runId: entry.run_id } : {}) };
  const header: BridgeHeader = entry.op === "delete" ? { ...base, op: "delete" } : { ...base, op: "upsert", registerKey: keys.registerKey! };
  const body = entry.op === "delete" ? { table: entry.table_name, pk: entry.pk } : {
    table: entry.table_name, pk: entry.pk, register: entry.register, schemaVersion: store.schemaVersion,
    ...portableValues(store, entry.table_name, clock), blobRefs: JSON.parse(clock.blob_refs_json ?? "[]"),
  };
  if (entry.op === "upsert" && !clock.portable && "values" in body) {
    // Keep the original wire references after ACK as well, so a projection repair can
    // remap integers again even when the former physical parent no longer exists.
    store.sqlite.prepare("UPDATE bridge_row_clock SET values_json=?,refs_json=?,portable=1 WHERE table_name=? AND pk=? AND register=?")
      .run(JSON.stringify(body.values), JSON.stringify(body.refs), entry.table_name, entry.pk, entry.register);
  }
  // The exact sealed delete survives retries and compaction, including its nonce and tag.
  let envelope: BridgeEnvelope;
  const previous = entry.op === "delete" ? store.sqlite.prepare("SELECT envelope FROM bridge_tombstones WHERE table_name=? AND pk=?").get(entry.table_name, entry.pk) as { envelope: string | null } | undefined : undefined;
  if (previous?.envelope) envelope = JSON.parse(previous.envelope);
  else {
    envelope = store.codec.seal(header, body);
    if (entry.op === "delete") store.sqlite.prepare("UPDATE bridge_tombstones SET envelope=? WHERE table_name=? AND pk=?").run(JSON.stringify(envelope), entry.table_name, entry.pk);
  }
  return { entry, envelope, clock };
}

/** Backfill/recovery use the same clock, images and coalescing as SQL capture. */
export function captureExisting(store: BridgeStore, table: string, pk: string): void {
  if (isAtlas(table) && !store.atlasEnabled) return;
  const def = definition(table), row = readRow(store, table, pk);
  if (!row) return;
  let owner: string | null = null, runId: string | null = null;
  if (def.ownerRoot) {
    // Use the same SQL ownership traversal as the triggers, including routed attachments.
    const where = rowWhere(def, String(physicalPk(store, table, pk, store.backendId)));
    const route = store.sqlite.prepare(`SELECT ${ownerSql(table, "r")} AS owner, ${runIdSql(table, "r")} AS run_id FROM ${quote(table)} r WHERE ${where.sql}`).get(...where.args) as { owner: string | null; run_id: string | null };
    owner = route.owner; runId = route.run_id;
    if (owner !== store.backendId) return;
  }
  if (!inScope(store, table, pk)) return;
  if (store.sqlite.prepare("SELECT 1 FROM bridge_tombstones WHERE table_name=? AND pk=?").get(table, pk)) return;
  for (const [register, columns] of Object.entries(def.registers)) {
    const existing = getClock(store.sqlite, table, pk, register);
    // Upgrade B4's already acknowledged file metadata with a fresh capture HLC.
    // Receivers must see a new generation, rather than ignore a same-clock manifest.
    const upgrade = store.filesEnabled && existing && existing.origin === store.backendId && existing.synced_seq !== null && existing.blob_refs_json === null &&
      def.blobColumns.some((column) => columns.includes(column));
    if (existing && !upgrade) continue;
    store.sqlite.exec(tickSql);
    const clock = store.sqlite.prepare("SELECT * FROM bridge_clock WHERE id=1").get() as { physical_ms: number; counter: number; generation: number };
    const values = Object.fromEntries(columns.map((col) => [col, col === "blob_data" ? null : row[col]]));
    store.sqlite.prepare(`INSERT INTO bridge_row_clock(table_name,pk,register,physical_ms,counter,origin,values_json,synced_seq) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(table_name,pk,register) DO UPDATE SET physical_ms=excluded.physical_ms,counter=excluded.counter,origin=excluded.origin,
        values_json=excluded.values_json,refs_json='{}',blob_refs_json=NULL,portable=0`).run(table, pk, register, clock.physical_ms, clock.counter, store.backendId, JSON.stringify(values), existing?.synced_seq ?? null);
    store.sqlite.prepare(`INSERT INTO bridge_outbox(table_name,pk,register,op,generation,stream,owner,run_id,changed_at) VALUES(?,?,?,'upsert',?,?,?,?,?)
      ON CONFLICT(table_name,pk,register) DO UPDATE SET op='upsert',generation=excluded.generation,changed_at=excluded.changed_at`)
      .run(table, pk, register, clock.generation, def.stream === "account" ? "account" : `run:${runId}`, owner, runId, clock.physical_ms);
  }
}
