import { BRIDGE_BLOB_CHUNK_BYTES, BRIDGE_BLOB_CIPHER_OVERHEAD, type BridgeBlobIdentity } from "@mains/contracts/bridge-blobs";
import type { DurableObjectStorage } from "@cloudflare/workers-types";

const blobId = "json_extract(value,'$.blobId')";
const size = "json_extract(value,'$.size')";
const bytes = `${size}+max(1,(${size}+${BRIDGE_BLOB_CHUNK_BYTES - 1})/${BRIDGE_BLOB_CHUNK_BYTES})*${BRIDGE_BLOB_CIPHER_OVERHEAD}`;
const roots = (row: string) => `json_each(${row}.envelope,'$.header.blobs')`;
const rootsOf = (row: string) => `SELECT ${blobId} FROM ${roots(row)}`;
const addRefs = (where: string) => `INSERT INTO blob_quota_refs(blob_id,bytes,refs)
  SELECT ${blobId},${bytes},1 FROM ${roots("NEW")} WHERE ${where}
  ON CONFLICT(blob_id) DO UPDATE SET refs=refs+1;`;
const removeRefs = (select: string) => `UPDATE blob_quota_refs SET refs=refs-1 WHERE blob_id IN (${select});`;

/** Latest registers own the quota charge. The separate log references still
 * own physical retention and protect in-flight readers. */
export function createBlobQuotaLedger(storage: DurableObjectStorage) {
  const sql = storage.sql;
  storage.transactionSync(() => {
    sql.exec(`CREATE TABLE IF NOT EXISTS blob_quota_refs(blob_id TEXT PRIMARY KEY,bytes INTEGER NOT NULL CHECK(bytes>0),refs INTEGER NOT NULL CHECK(refs>=0));
      CREATE TABLE IF NOT EXISTS blob_quota_state(id INTEGER PRIMARY KEY CHECK(id=1),retained_bytes INTEGER NOT NULL CHECK(retained_bytes>=0));`);
    if (!sql.exec("SELECT 1 FROM blob_quota_state WHERE id=1").toArray().length) {
      // Seed known live references. Existing unreferenced chunks may be
      // unpublished uploads, so keep their current charge until collection.
      sql.exec(`INSERT INTO blob_quota_refs
        SELECT ${blobId},min(${bytes}),count(*) FROM latest,${roots("latest")} GROUP BY ${blobId};
        INSERT INTO blob_quota_state VALUES(1,0);`);
    }
    sql.exec(`CREATE TRIGGER IF NOT EXISTS latest_blob_quota_insert AFTER INSERT ON latest
        WHEN json_array_length(NEW.envelope,'$.header.blobs')>0 BEGIN
          ${addRefs("1")}
      END;
      CREATE TRIGGER IF NOT EXISTS latest_blob_quota_update AFTER UPDATE OF envelope ON latest
        WHEN json_extract(OLD.envelope,'$.header.blobs') IS NOT json_extract(NEW.envelope,'$.header.blobs')
          AND (coalesce(json_array_length(OLD.envelope,'$.header.blobs'),0)>0 OR coalesce(json_array_length(NEW.envelope,'$.header.blobs'),0)>0) BEGIN
          ${addRefs(`${blobId} NOT IN (${rootsOf("OLD")})`)}
          ${removeRefs(`${rootsOf("OLD")} EXCEPT ${rootsOf("NEW")}`)}
      END;
      CREATE TRIGGER IF NOT EXISTS latest_blob_quota_delete AFTER DELETE ON latest
        WHEN json_array_length(OLD.envelope,'$.header.blobs')>0 BEGIN
          ${removeRefs(rootsOf("OLD"))}
      END;
      CREATE TRIGGER IF NOT EXISTS blob_quota_ref_count AFTER UPDATE OF refs ON blob_quota_refs
        WHEN (OLD.refs=0)<>(NEW.refs=0) BEGIN
          UPDATE blob_quota_state SET retained_bytes=retained_bytes+CASE WHEN NEW.refs=0 THEN NEW.bytes ELSE -OLD.bytes END WHERE id=1;
      END;
      CREATE TRIGGER IF NOT EXISTS blob_quota_collect AFTER DELETE ON blob_objects BEGIN
          UPDATE blob_quota_state SET retained_bytes=retained_bytes-coalesce(
            (SELECT bytes FROM blob_quota_refs WHERE blob_id=OLD.blob_id AND refs=0),0)
          WHERE id=1 AND EXISTS(SELECT 1 FROM blob_quota_refs WHERE blob_id=OLD.blob_id AND refs=0);
          DELETE FROM blob_quota_refs WHERE blob_id=OLD.blob_id;
      END;`);
  });

  function state() {
    return sql.exec<{ retained_bytes: number; legacy_records: number }>(
      "SELECT q.retained_bytes,g.legacy_records FROM blob_quota_state q JOIN blob_gc_state g USING(id) WHERE q.id=1").one();
  }
  return {
    retainedBytes() {
      const { retained_bytes, legacy_records } = state();
      return legacy_records ? 0 : retained_bytes;
    },
    projectedRetainedBytes(before: number, previous: BridgeBlobIdentity[] | undefined, next: BridgeBlobIdentity[] | undefined) {
      // An untracked manifest can reference any of the stored blobs.
      if (!next) return 0;
      if (!previous?.length && !next.length) return before;
      if (state().legacy_records) return 0;
      let after = before;
      const oldIds = new Set(previous?.map(blob => blob.blobId));
      const newIds = new Set(next.map(blob => blob.blobId));
      for (const id of newIds) if (!oldIds.has(id)) {
        after -= sql.exec<{ bytes: number }>("SELECT bytes FROM blob_quota_refs WHERE blob_id=? AND refs=0", id).toArray()[0]?.bytes ?? 0;
      }
      for (const id of oldIds) if (!newIds.has(id)) {
        after += sql.exec<{ bytes: number }>("SELECT bytes FROM blob_quota_refs WHERE blob_id=? AND refs=1", id).toArray()[0]?.bytes ?? 0;
      }
      return after;
    },
  };
}
