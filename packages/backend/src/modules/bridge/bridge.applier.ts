import type { BridgeEnvelope, BridgeLogRecord, BridgeStream, BridgeUpsertBody, BridgeValue } from "@mains/contracts/bridge-protocol";
import { isSeededSpaceId } from "@mains/contracts/spaces";
import { bridgeRecordKeys } from "./bridge.crypto";
import { BRIDGE_TABLES } from "./bridge.records";
import { aliasSet, canonicalPk, clockOf, compareClock, definition, deleted, getClock, headerClock, isAtlas, quote, rowWhere, syncedTables, type RowClock, type SqlRow } from "./bridge.sql";
import { bestClock, captureExisting, inScope, normalizeCompositeIdentity, physicalPk, portableValues, readRow, type BridgeStore, type PreparedRecord } from "./bridge.store";
import { ownerSql } from "./bridge.capture";
import { valueBlobKey } from "./bridge.value-blobs";

export interface AppliedChange { table: string; pk: string; runId?: string; op: "upsert" | "delete" }
type Outcome = "applied" | "ignored" | string;

export function verifyEnvelope(store: BridgeStore, envelope: BridgeEnvelope) {
  const opened = store.codec.open(envelope), { header, body } = opened;
  const keys = bridgeRecordKeys(store.recordKey, body.table, body.pk, "register" in body ? body.register : undefined);
  if (keys.rowKey !== header.rowKey || header.op === "upsert" && header.registerKey !== keys.registerKey) throw new Error("Bridge envelope identity does not match its routing keys");
  if (header.op === "delete" && (body.table === "accounts" && body.pk === "default" || body.table === "spaces" && isSeededSpaceId(body.pk)))
    throw new Error("Fixed Bridge identities cannot be deleted");
  const def = BRIDGE_TABLES[body.table];
  if (def?.class === "local") throw new Error("Local tables cannot be replicated");
  if (def?.idKind === "run-integer" && !/^.+:\d+$/.test(body.pk)) throw new Error("Invalid Bridge integer identity");
  if (def?.idKind === "run-integer" && header.runId !== body.pk.slice(0, body.pk.lastIndexOf(":"))) throw new Error("Bridge integer identity is routed to a different run");
  if (body.table === "run_attachment_refs" && header.runId !== JSON.parse(body.pk)[0]) throw new Error("Bridge attachment reference is routed to a different run");
  if (def?.ownerRoot && (!header.owner || header.owner !== header.origin)) throw new Error("Invalid Bridge owner");
  if (def && !def.ownerRoot && (header.owner || header.runId) || def?.stream === "account" && body.table !== "runs" && header.runId)
    throw new Error("Unexpected Bridge ownership routing");
  if (def && (def.stream === "account" ? header.stream !== "account" : !header.runId || header.stream !== `run:${header.runId}`)) throw new Error("Invalid Bridge stream");
  if (header.op === "upsert" && "values" in body && def && body.schemaVersion <= store.schemaVersion) {
    if (header.retention !== def.retention) throw new Error("Invalid Bridge retention policy");
    const columns = def.registers[body.register];
    if (!columns || Object.keys(body.values).length !== columns.length || columns.some((column) => !(column in body.values))) throw new Error("Invalid Bridge register columns");
    if (body.blobRefs.some((ref) => !columns.includes(ref.column) || (ref.kind === "value"
      ? body.schemaVersion < 4 || body.values[ref.column] !== null || def.primaryKey.includes(ref.column) || !!def.references[ref.column] || ref.column === "owner_backend_id" || ref.sourcePath !== undefined
      : !def.blobColumns.includes(ref.column)))) throw new Error("Invalid Bridge blob column");
    if (def.idKind === "text" && def.primaryKey[0] in body.values && body.values[def.primaryKey[0]] !== body.pk ||
        def.idKind === "run-integer" && (body.values.id !== body.pk || body.pk !== `${body.values.run_id}:${body.pk.slice(body.pk.lastIndexOf(":") + 1)}`) ||
        def.idKind === "composite" && JSON.stringify(def.primaryKey.map((column) => body.values[column])) !== body.pk)
      throw new Error("Bridge body primary key does not match its identity");
    if (def.ownerRoot === body.table && body.values.owner_backend_id !== header.owner) throw new Error("Bridge owner does not match the root");
    if (body.table === "runs" && header.runId !== body.pk || def.stream === "run" && header.runId !== body.values.run_id) throw new Error("Bridge run binding does not match the row");
    if (body.blobRefs.some((ref) => ref.kind === "value")) {
      opened.body = { ...body, values: { ...body.values } };
      for (const ref of body.blobRefs) if (ref.kind === "value" && store.materializedValues?.has(valueBlobKey(ref)))
        opened.body.values[ref.column] = store.materializedValues.get(valueBlobKey(ref))!;
    }
  }
  return opened;
}

/** Parked records this device could not authenticate, validate or apply. They are never applied
 * or retried with dependencies; each engine re-checks them once (a newer version may accept). */
export const UNVERIFIED_REASON = "unverified";
/** An unverified record that opens again; the next batch applies it or sets it aside again. */
export const RECHECK_REASON = "recheck";
/** A verified record this replica refuses. Unlike a local failure, retrying the same bytes cannot help. */
export class BridgeRecordRejected extends Error {}
/** Constraint and type errors are as deterministic for a record as the checks above. */
export function isRejectedRecord(error: unknown): error is Error {
  return error instanceof BridgeRecordRejected || error instanceof Error && /^SQLITE_(CONSTRAINT|MISMATCH)/.test(String((error as { code?: unknown }).code ?? ""));
}
/** One record that cannot be opened must not stop every later record of its stream. */
export function openPulledRecord(store: BridgeStore, stream: BridgeStream, envelope: BridgeEnvelope):
  { opened: ReturnType<typeof verifyEnvelope>; error?: undefined } | { opened?: undefined; error: string } {
  try {
    const opened = verifyEnvelope(store, envelope);
    if (opened.header.stream !== stream) throw new Error("Bridge pull contains a different stream");
    return { opened };
  } catch (error) { return { error: error instanceof Error ? error.message : "Invalid Bridge record" }; }
}

function advanceClock(store: BridgeStore, envelope: BridgeEnvelope) {
  const h = envelope.header.hlc;
  store.sqlite.prepare(`UPDATE bridge_clock SET counter=CASE WHEN physical_ms=? THEN max(counter,?) WHEN physical_ms<? THEN ? ELSE counter END,
    physical_ms=max(physical_ms,?) WHERE id=1`).run(h.physicalMs, h.counter, h.physicalMs, h.counter, h.physicalMs);
}
function saveClock(store: BridgeStore, record: BridgeLogRecord, body: BridgeUpsertBody) {
  const h = record.envelope.header;
  store.sqlite.prepare(`INSERT INTO bridge_row_clock(table_name,pk,register,physical_ms,counter,origin,synced_seq,values_json,refs_json,blob_refs_json,portable)
    VALUES(?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(table_name,pk,register) DO UPDATE SET physical_ms=excluded.physical_ms,counter=excluded.counter,
    origin=excluded.origin,synced_seq=excluded.synced_seq,values_json=excluded.values_json,refs_json=excluded.refs_json,blob_refs_json=excluded.blob_refs_json,portable=1,dirty=0`)
    .run(body.table, body.pk, body.register, h.hlc.physicalMs, h.hlc.counter, h.origin, record.seq, JSON.stringify(body.values), JSON.stringify(body.refs), JSON.stringify(body.blobRefs));
}
function resolveReferences(store: BridgeStore, table: string, pk: string, clock: RowClock, owner: string, saveLinks: boolean): Record<string, BridgeValue> | string {
  const def = definition(table), { values } = portableValues(store, table, clock);
  if (saveLinks) store.sqlite.prepare("DELETE FROM bridge_pending_links WHERE table_name=? AND pk=? AND register=?").run(table, pk, clock.register);
  for (const [column, ref] of Object.entries(def.references)) {
    const value = values[column];
    if (value === undefined || value === null) continue;
    if (ref.class === "local") { values[column] = null; continue; }
    const parentPk = String(value);
    if (ref.class !== "seeded" && deleted(store.sqlite, ref.table, parentPk)) {
      if (ref.class === "optional") { values[column] = null; continue; }
      return "deleted-parent";
    }
    const parent = ref.class === "seeded" ? store.sqlite.prepare(`SELECT id FROM ${quote(ref.table)} WHERE id=?`).get(value) : readRow(store, ref.table, parentPk, owner);
    if (parent) {
      values[column] = ref.class === "seeded" ? value : physicalPk(store, ref.table, parentPk, owner)!;
    } else if (ref.class !== "optional") return `parent:${ref.table}`;
    else {
      values[column] = null;
      if (saveLinks) store.sqlite.prepare(`INSERT OR REPLACE INTO bridge_pending_links(table_name,pk,register,column_name,parent_table,parent_pk,owner,physical_ms,counter,origin)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(table, pk, clock.register, column, ref.table, parentPk, owner, clock.physical_ms, clock.counter, clock.origin);
    }
  }
  return values;
}

/** Rewrite real foreign keys before removing an alias; the alias map itself never loses members. */
function mergeIds(store: BridgeStore, table: string, ids: string[]) {
  const members = [...new Set(ids.flatMap((id) => aliasSet(store.sqlite, table, id)))].sort();
  const canonical = members[0];
  const compositeChildren = new Set<string>();
  const existingCanonical = readRow(store, table, canonical);
  let hasCanonical = !!existingCanonical && String(existingCanonical.id) === canonical;
  for (const id of members) {
    if (id === canonical) continue;
    const raw = store.sqlite.prepare(`SELECT * FROM ${quote(table)} WHERE id=?`).get(id) as SqlRow | undefined;
    if (raw && !hasCanonical) {
      store.sqlite.prepare(`UPDATE ${quote(table)} SET id=? WHERE id=?`).run(canonical, id);
      hasCanonical = true;
    }
    store.sqlite.prepare("INSERT OR REPLACE INTO bridge_aliases(table_name,alias_pk,canonical_pk) VALUES(?,?,?)").run(table, id, canonical);
    for (const [child, def] of syncedTables) {
      for (const [column, ref] of Object.entries(def.references)) if (ref.table === table) {
        if (def.idKind === "composite" && def.primaryKey.includes(column)) {
          compositeChildren.add(child);
          const sameOtherKeys = def.primaryKey.filter((key) => key !== column).map((key) => `kept.${quote(key)}=victim.${quote(key)}`).join(" AND ");
          store.sqlite.prepare(`DELETE FROM ${quote(child)} AS victim WHERE ${quote(column)}=? AND EXISTS(SELECT 1 FROM ${quote(child)} kept WHERE kept.${quote(column)}=? AND ${sameOtherKeys})`).run(id, canonical);
        }
        store.sqlite.prepare(`UPDATE ${quote(child)} SET ${quote(column)}=? WHERE ${quote(column)}=?`).run(canonical, id);
      }
    }
    store.sqlite.prepare(`DELETE FROM ${quote(table)} WHERE id=?`).run(id);
  }
  // All transitive aliases point directly to the same survivor, including former survivors.
  for (const id of members) store.sqlite.prepare("UPDATE bridge_aliases SET canonical_pk=? WHERE table_name=? AND canonical_pk=?").run(canonical, table, id);
  for (const child of compositeChildren) {
    const identities = store.sqlite.prepare("SELECT DISTINCT pk FROM bridge_row_clock WHERE table_name=?").all(child) as { pk: string }[];
    for (const identity of identities) normalizeCompositeIdentity(store, child, identity.pk);
  }
  for (const register of Object.keys(definition(table).registers)) {
    const pending = members.flatMap((id) => store.sqlite.prepare("SELECT * FROM bridge_outbox WHERE table_name=? AND pk=? AND register=?").all(table, id, register) as import("./bridge.store").OutboxEntry[]);
    const best = bestClock(store, table, canonical, register);
    if (!best || !pending.length && !best.dirty) continue;
    const winningPending = pending.find((entry) => entry.pk === best.pk);
    for (const id of members) store.sqlite.prepare("DELETE FROM bridge_outbox WHERE table_name=? AND pk=? AND register=?").run(table, id, register);
    if (winningPending || best.dirty) {
      // Retarget the edit with its capture clock, never a new HLC.
      const image = portableValues(store, table, best);
      if ("id" in image.values) image.values.id = canonical;
      store.sqlite.prepare(`INSERT INTO bridge_row_clock(table_name,pk,register,physical_ms,counter,origin,synced_seq,values_json,refs_json,blob_refs_json,portable,dirty,project_id)
        VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT(table_name,pk,register) DO UPDATE SET physical_ms=excluded.physical_ms,counter=excluded.counter,origin=excluded.origin,
        values_json=excluded.values_json,refs_json=excluded.refs_json,blob_refs_json=excluded.blob_refs_json,portable=1,dirty=excluded.dirty,project_id=excluded.project_id`).run(table, canonical, register, best.physical_ms, best.counter, best.origin, best.synced_seq, JSON.stringify(image.values), JSON.stringify(image.refs), best.blob_refs_json, best.dirty ?? 0, best.project_id ?? null);
      if (winningPending) store.sqlite.prepare(`INSERT INTO bridge_outbox(table_name,pk,register,op,generation,stream,owner,run_id,changed_at) VALUES(?,?,?,'upsert',?,?,?,?,?)`)
        .run(table, canonical, register, winningPending.generation, winningPending.stream, winningPending.owner, winningPending.run_id, winningPending.changed_at);
    }
  }
  return canonical;
}

function naturalProjection(store: BridgeStore, table: string, pk: string, body: BridgeUpsertBody): string {
  if (table !== "collection_sources" && table !== "atlas_items") return canonicalPk(store.sqlite, table, pk);
  const v = body.values;
  if (table === "atlas_items" && !v.source_key) return canonicalPk(store.sqlite, table, pk);
  const register = definition(table).primaryRegister!;
  // Register images retain original natural keys even when a changed output is projected without one.
  const candidates = (store.sqlite.prepare("SELECT * FROM bridge_row_clock WHERE table_name=? AND register=?").all(table, register) as RowClock[])
    .map((clock) => ({ id: clock.pk, v: portableValues(store, table, clock).values }))
    .filter((entry) => inScope(store, table, entry.id) && !deleted(store.sqlite, table, entry.id) && (table === "collection_sources" ? entry.v.collection_id === v.collection_id && entry.v.content_hash === v.content_hash : entry.v.account_id === v.account_id && entry.v.source_key === v.source_key));
  const same = candidates.filter((entry) => table === "collection_sources" || !!v.content_hash && entry.v.content_hash === v.content_hash).map((entry) => entry.id);
  const canonical = same.length > 1 ? mergeIds(store, table, same) : canonicalPk(store.sqlite, table, pk);
  if (table === "atlas_items") {
    const sourceOwner = candidates.map((entry) => canonicalPk(store.sqlite, table, entry.id)).sort()[0] ?? canonical;
    store.sqlite.prepare("UPDATE atlas_items SET source_key=NULL WHERE account_id=? AND source_key=? AND id<>?").run(v.account_id, v.source_key, sourceOwner);
  }
  return canonical;
}

function materialize(store: BridgeStore, table: string, pk: string, owner: string): Outcome {
  const def = definition(table), primary = bestClock(store, table, pk, def.primaryRegister!);
  if (!primary) return "primary";
  const values: Record<string, BridgeValue> = {};
  for (const register of Object.keys(def.registers)) {
    const clock = bestClock(store, table, pk, register);
    if (!clock) continue;
    const resolved = resolveReferences(store, table, pk, clock, owner, true);
    if (typeof resolved === "string") return resolved;
    Object.assign(values, resolved);
  }
  if (def.idKind === "text") values[def.primaryKey[0]] = pk;
  if (table === "atlas_items" && values.source_key) {
    const contenders = (store.sqlite.prepare("SELECT pk,values_json FROM bridge_row_clock WHERE table_name='atlas_items' AND register='content'").all() as { pk: string; values_json: string }[])
      .filter((entry) => { const v = JSON.parse(entry.values_json); return v.account_id === values.account_id && v.source_key === values.source_key && !deleted(store.sqlite, table, entry.pk); })
      .map((entry) => canonicalPk(store.sqlite, table, entry.pk)).sort();
    if (contenders[0] !== pk) values.source_key = null;
  }
  const existing = readRow(store, table, pk, owner);
  if (def.ownerRoot) {
    if (def.ownerRoot === table) {
      if (values.owner_backend_id !== owner || existing?.owner_backend_id && existing.owner_backend_id !== owner) throw new BridgeRecordRejected("Bridge root ownership collision");
    } else if (existing) {
      const key = physicalPk(store, table, pk, owner)!;
      const where = rowWhere(def, String(key));
      const actual = store.sqlite.prepare(`SELECT ${ownerSql(table, "r")} AS owner FROM ${quote(table)} r WHERE ${where.sql}`).get(...where.args) as { owner: string | null };
      if (actual.owner && actual.owner !== owner) throw new BridgeRecordRejected("Bridge child ownership collision");
    }
    // Before inserting a child, verify the authenticated owner against its actual parent.
    for (const [column, ref] of Object.entries(def.references)) {
      if (!values[column] || !BRIDGE_TABLES[ref.table]?.ownerRoot || ref.class === "optional") continue;
      const parent = store.sqlite.prepare(`SELECT ${ownerSql(ref.table, "p")} AS owner FROM ${quote(ref.table)} p WHERE id=?`).get(values[column]) as { owner: string | null } | undefined;
      // Immutable attachment metadata can precede its first run reference in this batch.
      if (parent && parent.owner !== owner && !(ref.table === "run_attachments" && parent.owner === null)) throw new BridgeRecordRejected("Bridge parent ownership collision");
    }
  }
  if (table === "atlas_page_revisions" && !existing) {
    for (const column of ["parent_revision_id", "merged_revision_id"]) if (values[column]) {
      const parent = store.sqlite.prepare("SELECT item_id FROM atlas_page_revisions WHERE id=?").get(values[column]) as { item_id: string } | undefined;
      if (parent?.item_id !== values.item_id) throw new BridgeRecordRejected("Atlas revision parent belongs to a different Page");
    }
    values.version = (store.sqlite.prepare("SELECT coalesce(max(version),0)+1 AS version FROM atlas_page_revisions WHERE item_id=?").get(values.item_id) as { version: number }).version;
  }
  if (table === "atlas_items") {
    const current = values.current_revision_id
      ? store.sqlite.prepare("SELECT version,item_id FROM atlas_page_revisions WHERE id=?").get(values.current_revision_id) as { version: number; item_id: string } | undefined
      : undefined;
    if (current && current.item_id !== pk) throw new BridgeRecordRejected("Atlas revision belongs to a different Page");
    values.version = current?.version ?? 0;
    values.updated_at = Math.floor(Date.now() / 1000);
  }
  if (def.idKind === "run-integer") delete values.id;
  const columns = Object.keys(values);
  if (existing) {
    const where = rowWhere(def, String(physicalPk(store, table, pk, owner)));
    const changes = columns.filter((col) => !def.primaryKey.includes(col));
    if (changes.length) store.sqlite.prepare(`UPDATE ${quote(table)} SET ${changes.map((col) => `${quote(col)}=?`).join(",")} WHERE ${where.sql}`).run(...changes.map((col) => sqlValue(values[col])), ...where.args);
  } else {
    const insert = store.sqlite.prepare(`INSERT INTO ${quote(table)}(${columns.map(quote).join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...columns.map((col) => sqlValue(values[col])));
    if (def.idKind === "run-integer") store.sqlite.prepare(`INSERT INTO bridge_id_map(owner_backend_id,table_name,remote_id,local_id) VALUES(?,?,?,?)
      ON CONFLICT(owner_backend_id,table_name,remote_id) DO UPDATE SET local_id=excluded.local_id`).run(owner, table, pk, Number(insert.lastInsertRowid));
  }
  return "applied";
}
const sqlValue = (value: BridgeValue) => typeof value === "boolean" ? Number(value) : value;

function applyUpsert(store: BridgeStore, record: BridgeLogRecord, body: BridgeUpsertBody): Outcome {
  const { header } = record.envelope, def = BRIDGE_TABLES[body.table];
  if (!def || body.schemaVersion > store.schemaVersion) return "schema";
  if (isAtlas(body.table) && !store.atlasEnabled) return "disabled";
  if (deleted(store.sqlite, body.table, body.pk)) return "ignored";
  if (body.blobRefs.some((ref) => ref.kind === "value" && typeof body.values[ref.column] !== "string")) return "value-blobs";
  if (def.stream !== "account") {
    if (deleted(store.sqlite, "runs", header.runId!)) return "ignored";
    const run = readRow(store, "runs", header.runId!);
    if (!run) return "parent:runs";
    if (run.owner_backend_id !== header.owner) throw new BridgeRecordRejected("Bridge stream owner does not match its run");
  }
  const existing = getClock(store.sqlite, body.table, body.pk, body.register);
  if (body.table === "atlas_page_revisions" && existing) {
    const previous = portableValues(store, body.table, existing).values;
    for (const column of definition(body.table).registers.row) {
      if (column !== "source_run_id" && previous[column] !== body.values[column])
        throw new BridgeRecordRejected("Atlas revision identity is immutable");
    }
  }
  if (existing && compareClock(headerClock(header), clockOf(existing)) <= 0) {
    let restoredManifest = false;
    if ((body.table === "atlas_items" || body.table === "collection_sources") && existing.blob_refs_json === null && body.blobRefs.length) {
      // A retained file can outlive an account binding without ever having been
      // downloaded here. Recover this account's authenticated manifest without
      // moving the newer local metadata clock or reading the old source path.
      const local = portableValues(store, body.table, existing).values;
      if (typeof local.content_hash === "string" && local.content_hash === body.values.content_hash &&
          local.byte_size === body.values.byte_size && local.storage_key === body.values.storage_key) {
        store.sqlite.prepare("UPDATE bridge_row_clock SET blob_refs_json=? WHERE table_name=? AND pk=? AND register=?")
          .run(JSON.stringify(body.blobRefs), body.table, body.pk, body.register);
        restoredManifest = true;
      }
    }
    if (compareClock(headerClock(header), clockOf(existing)) === 0) store.sqlite.prepare("UPDATE bridge_row_clock SET synced_seq=max(coalesce(synced_seq,0),?),dirty=0,last_ack_ms=? WHERE table_name=? AND pk=? AND register=?").run(record.seq, Date.now(), body.table, body.pk, body.register);
    // A full pull can repair a missing physical projection without overwriting a newer clock.
    if (!readRow(store, body.table, body.pk, header.owner ?? header.origin))
      return materialize(store, body.table, canonicalPk(store.sqlite, body.table, body.pk), header.owner ?? header.origin);
    return restoredManifest ? "applied" : "ignored";
  }
  const candidate: RowClock = { table_name: body.table, pk: body.pk, register: body.register, physical_ms: header.hlc.physicalMs, counter: header.hlc.counter, origin: header.origin, synced_seq: record.seq, values_json: JSON.stringify(body.values), refs_json: JSON.stringify(body.refs), blob_refs_json: JSON.stringify(body.blobRefs), portable: 1 };
  const refs = resolveReferences(store, body.table, body.pk, candidate, header.owner ?? header.origin, false);
  if (typeof refs === "string") return refs === "deleted-parent" ? "ignored" : refs;
  if (body.register !== def.primaryRegister && !readRow(store, body.table, body.pk, header.owner ?? header.origin)) return "primary";
  saveClock(store, record, body);
  store.sqlite.prepare("DELETE FROM bridge_outbox WHERE table_name=? AND pk=? AND register=?").run(body.table, body.pk, body.register);
  if (def.idKind === "composite") normalizeCompositeIdentity(store, body.table, body.pk);
  const canonical = body.register === def.primaryRegister ? naturalProjection(store, body.table, body.pk, body) : canonicalPk(store.sqlite, body.table, body.pk);
  const best = bestClock(store, body.table, canonical, body.register);
  if (best && compareClock(clockOf(best), headerClock(header)) === 0) {
    for (const id of aliasSet(store.sqlite, body.table, canonical)) store.sqlite.prepare("DELETE FROM bridge_outbox WHERE table_name=? AND pk=? AND register=?").run(body.table, id, body.register);
  }
  return materialize(store, body.table, canonical, header.owner ?? header.origin);
}

function attemptUpsert(store: BridgeStore, record: BridgeLogRecord, body: BridgeUpsertBody): Outcome {
  store.sqlite.exec("SAVEPOINT bridge_apply_record");
  try {
    const outcome = applyUpsert(store, record, body);
    if (outcome !== "applied" && outcome !== "ignored") store.sqlite.exec("ROLLBACK TO bridge_apply_record");
    store.sqlite.exec("RELEASE bridge_apply_record");
    return outcome;
  } catch (error) {
    store.sqlite.exec("ROLLBACK TO bridge_apply_record; RELEASE bridge_apply_record");
    throw error;
  }
}

/** Recovery and cascade share the transaction for pull, replay and verified deleted ACKs. */
type RecoveredRow = { table: string; pk: string; blobRefsJson?: string };
function applyDelete(store: BridgeStore, envelope: BridgeEnvelope, recovered: RecoveredRow[], changes: AppliedChange[]): Outcome {
  const { header, body } = verifyEnvelope(store, envelope), { table, pk } = body;
  const def = BRIDGE_TABLES[table];
  if (!def) throw new Error("Cannot apply a deletion from an unknown schema");
  if (def.idKind === "composite") normalizeCompositeIdentity(store, table, pk);
  const canonical = canonicalPk(store.sqlite, table, pk), members = aliasSet(store.sqlite, table, canonical);
  const row = readRow(store, table, canonical, header.owner ?? header.origin);
  // Another backend may have deleted a file before learning of an offline
  // embed. Retain its immutable bytes until the restorable references disappear.
  if (table === "atlas_items" && row?.kind !== "page" && store.sqlite.prepare("SELECT 1 FROM atlas_page_file_refs WHERE file_id=? LIMIT 1").get(canonical)) {
    // Finality is immediate even while the physical row is retained for Page
    // recovery. Neither a delayed upsert nor a local file edit can republish it.
    for (const id of members) {
      store.sqlite.prepare("INSERT OR IGNORE INTO bridge_tombstones(table_name,pk) VALUES(?,?)").run(table, id);
      store.sqlite.prepare("DELETE FROM bridge_outbox WHERE table_name=? AND pk=?").run(table, id);
    }
    store.sqlite.prepare("UPDATE bridge_tombstones SET envelope=coalesce(envelope,?) WHERE table_name=? AND pk=?").run(JSON.stringify(envelope), table, pk);
    return "parent";
  }
  const wasDeleted = deleted(store.sqlite, table, pk);
  if (row && def.ownerRoot === table && row.owner_backend_id !== header.owner) throw new BridgeRecordRejected("Bridge delete owner collision");
  if (row && def.ownerRoot && def.ownerRoot !== table) {
    const where = rowWhere(def, String(physicalPk(store, table, canonical, header.owner ?? header.origin)));
    const actual = store.sqlite.prepare(`SELECT ${ownerSql(table, "r")} AS owner FROM ${quote(table)} r WHERE ${where.sql}`).get(...where.args) as { owner: string | null };
    if (actual.owner !== header.owner) throw new BridgeRecordRejected("Bridge delete owner collision");
  }
  if (row && !wasDeleted) store.recover?.({ sqlite: store.sqlite, table, pk: canonical, row,
    captureAfterDelete(recoveredTable, recoveredPk, blobRefsJson) { definition(recoveredTable); recovered.push({ table: recoveredTable, pk: recoveredPk, blobRefsJson }); },
  });
  // Record descendants before CASCADE, so pending local inserts cannot later resurrect them.
  const visit = (childTable: string, childPk: string, childRow: SqlRow) => {
    for (const [nextTable, nextDef] of syncedTables) for (const [column, ref] of Object.entries(nextDef.references)) {
      if (ref.table !== childTable) continue;
      const foreign = store.sqlite.prepare(`PRAGMA foreign_key_list(${quote(nextTable)})`).all() as { from: string; on_delete: string }[];
      if (foreign.find((fk) => fk.from === column)?.on_delete !== "CASCADE") continue;
      const parentValue = childRow[definition(childTable).primaryKey[0]];
      const children = store.sqlite.prepare(`SELECT * FROM ${quote(nextTable)} WHERE ${quote(column)}=?`).all(parentValue) as SqlRow[];
      for (const next of children) visit(nextTable, portableRowPk(nextTable, next, store, header.owner ?? header.origin), next);
    }
    for (const id of aliasSet(store.sqlite, childTable, childPk)) {
      store.sqlite.prepare("INSERT OR IGNORE INTO bridge_tombstones(table_name,pk) VALUES(?,?)").run(childTable, id);
      store.sqlite.prepare("DELETE FROM bridge_outbox WHERE table_name=? AND pk=?").run(childTable, id);
      store.sqlite.prepare("DELETE FROM bridge_pending_links WHERE table_name=? AND pk=?").run(childTable, id);
    }
  };
  if (row) visit(table, canonical, row);
  for (const id of members) {
    store.sqlite.prepare("INSERT OR IGNORE INTO bridge_tombstones(table_name,pk) VALUES(?,?)").run(table, id);
    store.sqlite.prepare("DELETE FROM bridge_outbox WHERE table_name=? AND pk=?").run(table, id);
    store.sqlite.prepare("DELETE FROM bridge_pending_links WHERE table_name=? AND pk=?").run(table, id);
  }
  // Only the named identity gets this authenticated envelope; aliases remain deletion fences.
  store.sqlite.prepare("UPDATE bridge_tombstones SET envelope=coalesce(envelope,?) WHERE table_name=? AND pk=?").run(JSON.stringify(envelope), table, pk);
  if (row) {
    const where = rowWhere(def, String(physicalPk(store, table, canonical, header.owner ?? header.origin)));
    store.sqlite.prepare(`DELETE FROM ${quote(table)} WHERE ${where.sql}`).run(...where.args);
    changes.push({ table, pk: canonical, op: "delete", ...(header.runId ? { runId: header.runId } : {}) });
  }
  return "applied";
}

function portableRowPk(table: string, row: SqlRow, store: BridgeStore, owner: string): string {
  const def = definition(table);
  if (def.idKind === "run-integer") {
    const mapped = store.sqlite.prepare("SELECT remote_id FROM bridge_id_map WHERE owner_backend_id=? AND table_name=? AND local_id=?").get(owner, table, row.id) as { remote_id: string } | undefined;
    return mapped?.remote_id ?? `${row.run_id}:${row.id}`;
  }
  return def.idKind === "composite" ? JSON.stringify(def.primaryKey.map((column) => row[column])) : String(row[def.primaryKey[0]]);
}

function fillLinks(store: BridgeStore) {
  const links = store.sqlite.prepare("SELECT * FROM bridge_pending_links").all() as { table_name: string; pk: string; register: string; column_name: string; parent_table: string; parent_pk: string; owner: string; physical_ms: number; counter: number; origin: string }[];
  for (const link of links) {
    const current = bestClock(store, link.table_name, link.pk, link.register);
    const stale = !current || compareClock(clockOf(current), { physicalMs: link.physical_ms, counter: link.counter, origin: link.origin }) !== 0;
    const parent = readRow(store, link.parent_table, link.parent_pk, link.owner);
    // A pointer to another Page's revision is never filled; the optional reference stays empty.
    const foreign = !!parent && link.table_name === "atlas_items" && link.column_name === "current_revision_id" && parent.item_id !== link.pk;
    if (foreign) console.warn(`[bridge] Ignored Atlas revision ${link.parent_pk}: it belongs to a different Page`);
    if (!stale && parent && !foreign && !deleted(store.sqlite, link.parent_table, link.parent_pk)) {
      const where = rowWhere(definition(link.table_name), String(physicalPk(store, link.table_name, link.pk, link.owner)));
      store.sqlite.prepare(`UPDATE ${quote(link.table_name)} SET ${quote(link.column_name)}=? WHERE ${where.sql}`).run(physicalPk(store, link.parent_table, link.parent_pk, link.owner), ...where.args);
    }
    if (stale || parent || deleted(store.sqlite, link.parent_table, link.parent_pk)) store.sqlite.prepare("DELETE FROM bridge_pending_links WHERE table_name=? AND pk=? AND register=? AND column_name=?").run(link.table_name, link.pk, link.register, link.column_name);
  }
  // The pointer may have arrived before its immutable revision. Ordinals are
  // projections of that pointer, never of metadata writes or arrival order.
  store.sqlite.exec(`UPDATE atlas_items SET version=coalesce((SELECT version FROM atlas_page_revisions
    WHERE id=atlas_items.current_revision_id AND item_id=atlas_items.id),0) WHERE kind='page'`);
}

export function applyBridgeBatch(store: BridgeStore, stream: BridgeStream, records: BridgeLogRecord[], cursor?: number): AppliedChange[] {
  const changes: AppliedChange[] = [], recovered: RecoveredRow[] = [];
  store.sqlite.transaction(() => {
    // Missing ancestors can require many passes. Reuse authenticated immutable
    // records only within this transaction, with a bounded serialized footprint.
    const verified = new Map<string, { envelope: BridgeEnvelope; opened: ReturnType<typeof verifyEnvelope> }>();
    let cachedChars = 0;
    const remember = (encoded: string, envelope: BridgeEnvelope, opened: ReturnType<typeof verifyEnvelope>) => {
      if (!verified.has(encoded) && cachedChars + encoded.length <= 4 * 1024 * 1024) {
        verified.set(encoded, { envelope, opened }); cachedChars += encoded.length;
      }
    };
    const park = (record: BridgeLogRecord, opened: ReturnType<typeof verifyEnvelope>, reason: string) => {
      const encoded = JSON.stringify(record.envelope);
      store.sqlite.prepare("INSERT OR REPLACE INTO bridge_parked(stream,seq,envelope,reason) VALUES(?,?,?,?)").run(stream, record.seq, encoded, reason);
      remember(encoded, record.envelope, opened);
    };
    // Kept for a later re-check, without its dependencies being retried.
    const setAside = (recordStream: BridgeStream, seq: number, envelope: BridgeEnvelope, reason: string) => {
      store.sqlite.prepare("INSERT OR REPLACE INTO bridge_parked(stream,seq,envelope,reason) VALUES(?,?,?,?)")
        .run(recordStream, seq, JSON.stringify(envelope), UNVERIFIED_REASON);
      console.warn(`[bridge] Set aside ${recordStream} record ${seq}: ${reason}`);
    };
    // A verified record can still be one this replica refuses. Only that record is undone and set
    // aside; a local failure (recovery, I/O) still rolls back the whole batch to be retried.
    const guarded = (work: () => Outcome): Outcome | Error => {
      const changeCount = changes.length, recoveredCount = recovered.length;
      store.sqlite.exec("SAVEPOINT bridge_apply_guard");
      try {
        const outcome = work();
        store.sqlite.exec("RELEASE bridge_apply_guard");
        return outcome;
      } catch (error) {
        store.sqlite.exec("ROLLBACK TO bridge_apply_guard; RELEASE bridge_apply_guard");
        if (!isRejectedRecord(error)) throw error;
        changes.length = changeCount; recovered.length = recoveredCount;
        return error;
      }
    };
    store.sqlite.pragma("defer_foreign_keys = ON");
    store.sqlite.prepare("UPDATE bridge_state SET applying=1 WHERE id=1").run();
    for (const record of records) {
      const checked = openPulledRecord(store, stream, record.envelope);
      // Its unauthenticated clock never advances ours.
      if (!checked.opened) { setAside(stream, record.seq, record.envelope, checked.error); continue; }
      const opened = checked.opened;
      advanceClock(store, record.envelope);
      if (opened.header.op === "delete") {
        const reason = !BRIDGE_TABLES[opened.body.table] ? "schema" : isAtlas(opened.body.table) && !store.atlasEnabled ? "disabled" : undefined;
        if (reason) park(record, opened, reason);
        else {
          const outcome = guarded(() => applyDelete(store, record.envelope, recovered, changes));
          if (outcome instanceof Error) setAside(stream, record.seq, record.envelope, outcome.message);
          else if (outcome !== "applied") park(record, opened, outcome);
        }
      }
      else {
        const outcome = guarded(() => attemptUpsert(store, record, opened.body as BridgeUpsertBody));
        if (outcome instanceof Error) setAside(stream, record.seq, record.envelope, outcome.message);
        else if (outcome !== "applied" && outcome !== "ignored") park(record, opened, outcome);
        else if (outcome === "applied") changes.push({ table: opened.body.table, pk: opened.body.pk, op: "upsert", ...(opened.header.runId ? { runId: opened.header.runId } : {}) });
      }
    }
    // Durable parking allows the pull cursor to advance even across separate batches/restarts.
    let progress = true;
    while (progress) {
      progress = false;
      const parked = store.sqlite.prepare("SELECT * FROM bridge_parked WHERE reason<>? ORDER BY seq").all(UNVERIFIED_REASON) as { stream: BridgeStream; seq: number; envelope: string; reason: string }[];
      for (const entry of parked) {
        const cached = verified.get(entry.envelope);
        const envelope: BridgeEnvelope = cached?.envelope ?? JSON.parse(entry.envelope);
        const checked = cached ?? openPulledRecord(store, entry.stream, envelope);
        if (!checked.opened) { setAside(entry.stream, entry.seq, envelope, checked.error); continue; }
        const opened = checked.opened, { body, header } = opened;
        remember(entry.envelope, envelope, opened);
        // A re-checked record was never opened before, so its clock was skipped.
        if (entry.reason === RECHECK_REASON) advanceClock(store, envelope);
        let outcome: Outcome | Error;
        if (header.op === "delete") {
          if (!BRIDGE_TABLES[body.table] || isAtlas(body.table) && !store.atlasEnabled) continue;
          outcome = guarded(() => applyDelete(store, envelope, recovered, changes));
        } else outcome = guarded(() => attemptUpsert(store, { seq: entry.seq, envelope }, body as BridgeUpsertBody));
        if (outcome instanceof Error) {
          setAside(entry.stream, entry.seq, envelope, outcome.message);
          if (verified.delete(entry.envelope)) cachedChars -= entry.envelope.length;
        } else if (outcome !== "applied" && outcome !== "ignored") {
          if (entry.reason === RECHECK_REASON) store.sqlite.prepare("UPDATE bridge_parked SET reason=? WHERE stream=? AND seq=?").run(outcome, entry.stream, entry.seq);
        } else {
          store.sqlite.prepare("DELETE FROM bridge_parked WHERE stream=? AND seq=?").run(entry.stream, entry.seq);
          if (verified.delete(entry.envelope)) cachedChars -= entry.envelope.length;
          progress = true;
          if (outcome === "applied") changes.push({ table: body.table, pk: body.pk, op: "upsert", ...(envelope.header.runId ? { runId: envelope.header.runId } : {}) });
        }
      }
    }
    fillLinks(store);
    if (cursor !== undefined) store.sqlite.prepare("INSERT INTO bridge_cursors(stream,seq) VALUES(?,?) ON CONFLICT(stream) DO UPDATE SET seq=max(seq,excluded.seq)").run(stream, cursor);
    store.sqlite.prepare("UPDATE bridge_state SET applying=0 WHERE id=1").run();
    for (const row of recovered) {
      captureExisting(store, row.table, row.pk);
      if (row.blobRefsJson !== undefined) store.sqlite.prepare("UPDATE bridge_row_clock SET blob_refs_json=? WHERE table_name=? AND pk=? AND register='content'")
        .run(row.blobRefsJson, row.table, row.pk);
    }
  })();
  return changes;
}

/** Throws BridgeRecordRejected for a tombstone this device cannot authenticate or match to the write. */
export function applyDeletedAck(store: BridgeStore, sent: PreparedRecord, tombstone: BridgeEnvelope): AppliedChange[] {
  let opened: ReturnType<typeof verifyEnvelope>;
  try { opened = verifyEnvelope(store, tombstone); }
  catch (error) { throw new BridgeRecordRejected(error instanceof Error ? error.message : "Invalid Bridge deleted ACK"); }
  const { header, body } = opened, expected = sent.envelope.header;
  if (header.op !== "delete" || header.rowKey !== expected.rowKey && !(expected.runId && body.table === "runs" && body.pk === expected.runId && header.runId === expected.runId && header.owner === expected.owner))
    throw new BridgeRecordRejected("Bridge deleted ACK does not identify the sent row or its run");
  const changes = applyBridgeBatch(store, header.stream, [{ seq: 0, envelope: tombstone }]);
  if (body.table === "runs" && header.runId === body.pk) {
    store.sqlite.transaction(() => {
      // The source may already have cascaded the SQL root while it was Local only.
      // A closed run acknowledges all its queued descendants, even without a row to visit.
      store.sqlite.prepare(`UPDATE bridge_row_clock SET dirty=0 WHERE EXISTS(SELECT 1 FROM bridge_outbox o
        WHERE o.run_id=? AND o.table_name=bridge_row_clock.table_name AND o.pk=bridge_row_clock.pk)` ).run(body.pk);
      store.sqlite.prepare(`UPDATE bridge_row_clock SET dirty=0 WHERE EXISTS(SELECT 1 FROM bridge_tombstones t
        WHERE t.run_id=? AND t.table_name=bridge_row_clock.table_name AND t.pk=bridge_row_clock.pk)`).run(body.pk);
      store.sqlite.prepare("DELETE FROM bridge_outbox WHERE run_id=?").run(body.pk);
    })();
  }
  return changes;
}
