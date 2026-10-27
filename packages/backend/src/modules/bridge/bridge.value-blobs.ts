import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { BRIDGE_BLOB_MAX_BYTES, type BridgeBlobRef } from "@mains/contracts/bridge-blobs";
import type { BridgeUpsertBody } from "@mains/contracts/bridge-protocol";
import { clockOf, compareClock, definition, getClock, type RowClock } from "./bridge.sql";
import { portableValues, type BridgeStore, type OutboxEntry } from "./bridge.store";
import type { BridgeBlobs } from "./bridge.blobs";

const fieldLimit = 128 * 1024, registerLimit = 256 * 1024;
const encode = (value: string) => Buffer.from(JSON.stringify(value));
export const valueBlobKey = (ref: BridgeBlobRef) => `${ref.blobId}:${ref.size}`;
export const valueBlobBytes = (body: BridgeUpsertBody) => body.blobRefs.reduce((sum, ref) => sum + (ref.kind === "value" ? ref.size : 0), 0);

function selection(store: BridgeStore, entry: OutboxEntry, clock: RowClock) {
  const { values } = portableValues(store, entry.table_name, clock), def = definition(entry.table_name);
  let remaining = Buffer.byteLength(JSON.stringify(values));
  const candidates = Object.entries(values).filter((item): item is [string, string] => typeof item[1] === "string" &&
    !def.primaryKey.includes(item[0]) && !def.references[item[0]] && item[0] !== "owner_backend_id")
    .map(([column, value]) => ({ column, bytes: encode(value) })).sort((a, b) => b.bytes.length - a.bytes.length);
  return candidates.filter((candidate) => {
    if (candidate.bytes.length <= fieldLimit && remaining <= registerLimit) return false;
    remaining -= candidate.bytes.length - 4; return true;
  });
}

/** Captured register images, never a newer live row, supply the immutable bytes. */
export function createBridgeValueBlobs(blobs: BridgeBlobs) {
  return {
    ready(store: BridgeStore, entry: OutboxEntry) {
      if (entry.op !== "upsert") return true;
      const clock = getClock(store.sqlite, entry.table_name, entry.pk, entry.register); if (!clock) return false;
      const fields = selection(store, entry, clock);
      const refs = (JSON.parse(clock.blob_refs_json ?? "[]") as BridgeBlobRef[]).filter((ref) => ref.kind === "value");
      return fields.length === refs.length && fields.every((field) => refs.some((ref) => ref.column === field.column && blobs.matches(ref, field.bytes)));
    },
    async prepare(store: BridgeStore, entry: OutboxEntry) {
      if (entry.op !== "upsert") return;
      const clock = getClock(store.sqlite, entry.table_name, entry.pk, entry.register); if (!clock) return;
      const fields = selection(store, entry, clock), previous = JSON.parse(clock.blob_refs_json ?? "[]") as BridgeBlobRef[];
      if (!fields.length && !previous.some((ref) => ref.kind === "value")) return;
      if (store.schemaVersion < 4) throw new Error("Upgrade Bridge to sync large database fields; local changes remain queued");
      if (fields.reduce((sum, field) => sum + field.bytes.length, 0) > BRIDGE_BLOB_MAX_BYTES)
        throw new Error("Bridge large fields exceed 50 MiB per record; local changes remain queued");
      const refs = previous.filter((ref) => ref.kind !== "value");
      for (const field of fields) {
        const retained = previous.find((ref) => ref.kind === "value" && ref.column === field.column && blobs.matches(ref, field.bytes));
        refs.push(retained ?? { ...await blobs.publish(field.bytes, { column: field.column, name: "value.json", mime: "application/json" }), kind: "value" });
      }
      const current = getClock(store.sqlite, entry.table_name, entry.pk, entry.register);
      if (current && compareClock(clockOf(clock), clockOf(current)) === 0)
        store.sqlite.prepare("UPDATE bridge_row_clock SET blob_refs_json=? WHERE table_name=? AND pk=? AND register=?").run(JSON.stringify(refs), entry.table_name, entry.pk, entry.register);
    },
    async restore(body: BridgeUpsertBody, known: ReadonlyMap<string, string> = new Map()): Promise<Map<string, string>> {
      if (valueBlobBytes(body) > BRIDGE_BLOB_MAX_BYTES) throw new Error("Bridge large fields exceed 50 MiB per record");
      const values = new Map<string, string>();
      for (const ref of body.blobRefs) if (ref.kind === "value" && !values.has(valueBlobKey(ref)) && !known.has(valueBlobKey(ref))) {
        const handle = await open(await blobs.resolve(ref), constants.O_RDONLY | constants.O_NOFOLLOW);
        let bytes: Buffer;
        try {
          const stat = await handle.stat();
          if (!stat.isFile() || stat.size !== ref.size || stat.size > BRIDGE_BLOB_MAX_BYTES) throw new Error("Invalid Bridge value blob length");
          bytes = await handle.readFile();
        } finally { await handle.close(); }
        if (!blobs.matches(ref, bytes)) throw new Error("Bridge value blob integrity check failed");
        const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        if (typeof value !== "string") throw new Error("Bridge value blob must contain a string");
        values.set(valueBlobKey(ref), value);
      }
      return values;
    },
  };
}
