import { BRIDGE_BLOB_GC_GRACE_MS } from "@mains/contracts/bridge-blobs";
import { archiveBlobChunks } from "./blob-archive";

const nowSql = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const deadlineSql = `${nowSql}+${BRIDGE_BLOB_GC_GRACE_MS}`;

/** Log roots, including not-yet-compacted versions, protect ciphertext without
 * opening records. Triggers keep the inventory incremental and transactional. */
export function installBlobReferences(storage: DurableObjectStorage) {
  const sql = storage.sql;
  storage.transactionSync(() => {
    sql.exec(`CREATE TABLE IF NOT EXISTS blob_gc_state(id INTEGER PRIMARY KEY CHECK(id=1),legacy_records INTEGER NOT NULL CHECK(legacy_records>=0),chunks_initialized INTEGER NOT NULL DEFAULT 0,account_prefix TEXT);
      CREATE TABLE IF NOT EXISTS blob_objects(blob_id TEXT PRIMARY KEY,refs INTEGER NOT NULL CHECK(refs>=0),delete_after INTEGER);
      CREATE TABLE IF NOT EXISTS blob_deletions(blob_id TEXT PRIMARY KEY);
      CREATE INDEX IF NOT EXISTS blob_objects_due ON blob_objects(delete_after) WHERE refs=0;
      CREATE TABLE IF NOT EXISTS blob_links(stream TEXT NOT NULL,seq INTEGER NOT NULL,blob_id TEXT NOT NULL,PRIMARY KEY(stream,seq,blob_id));
      CREATE TRIGGER IF NOT EXISTS blob_links_insert AFTER INSERT ON blob_links BEGIN
        INSERT INTO blob_objects VALUES(NEW.blob_id,1,NULL) ON CONFLICT(blob_id) DO UPDATE SET refs=refs+1,delete_after=NULL;
      END;
      CREATE TRIGGER IF NOT EXISTS blob_links_delete AFTER DELETE ON blob_links BEGIN
        UPDATE blob_objects SET refs=refs-1,delete_after=CASE WHEN refs=1 THEN ${deadlineSql} ELSE NULL END WHERE blob_id=OLD.blob_id;
      END;`);
    if (!sql.exec("SELECT 1 FROM blob_gc_state WHERE id=1").toArray().length) {
      // A one-time upgrade. Unknown legacy manifests block collection rather
      // than guessing which existing ciphertext they still need.
      sql.exec(`INSERT INTO blob_gc_state(id,legacy_records) SELECT 1,count(*) FROM log WHERE op='upsert' AND json_type(envelope,'$.header.blobs') IS NULL;
        INSERT INTO blob_links SELECT l.stream,l.seq,json_extract(b.value,'$.blobId') FROM log l,json_each(l.envelope,'$.header.blobs') b WHERE l.op='upsert';`);
    }
    sql.exec(`CREATE TRIGGER IF NOT EXISTS log_blob_roots_insert AFTER INSERT ON log WHEN NEW.op='upsert' BEGIN
        UPDATE blob_gc_state SET legacy_records=legacy_records+1 WHERE id=1 AND json_type(NEW.envelope,'$.header.blobs') IS NULL;
        INSERT INTO blob_links SELECT NEW.stream,NEW.seq,json_extract(value,'$.blobId') FROM json_each(NEW.envelope,'$.header.blobs');
      END;
      CREATE TRIGGER IF NOT EXISTS log_blob_roots_delete AFTER DELETE ON log WHEN OLD.op='upsert' BEGIN
        DELETE FROM blob_links WHERE stream=OLD.stream AND seq=OLD.seq;
        UPDATE blob_gc_state SET legacy_records=legacy_records-1 WHERE id=1 AND json_type(OLD.envelope,'$.header.blobs') IS NULL;
      END;`);
  });
}

/** Call after quota_chunks exists. Uploads that never publish metadata must also
 * become collectible; no R2 listing or whole-inventory scan runs on later wakes. */
export function installBlobInventory(storage: DurableObjectStorage) {
  const sql = storage.sql;
  storage.transactionSync(() => {
    sql.exec(`CREATE TRIGGER IF NOT EXISTS quota_chunks_gc_insert AFTER INSERT ON quota_chunks
      WHEN length(NEW.key)>=110 AND substr(NEW.key,65,1)='/' AND substr(NEW.key,109,1)='/' BEGIN
        INSERT INTO blob_objects VALUES(substr(NEW.key,66,43),0,${deadlineSql}) ON CONFLICT(blob_id) DO NOTHING;
      END;`);
    if (!sql.exec("SELECT 1 FROM blob_gc_state WHERE id=1 AND chunks_initialized=1").toArray().length) {
      sql.exec(`INSERT INTO blob_objects SELECT DISTINCT substr(key,66,43),0,${deadlineSql} FROM quota_chunks
        WHERE length(key)>=110 AND substr(key,65,1)='/' AND substr(key,109,1)='/' ON CONFLICT(blob_id) DO NOTHING;
        UPDATE blob_gc_state SET chunks_initialized=1,account_prefix=(SELECT substr(key,1,65) FROM quota_chunks WHERE length(key)>=110 LIMIT 1) WHERE id=1;`);
    }
  });
}

export function createBlobCollector(storage: DurableObjectStorage, bucket: R2Bucket, archive?: R2Bucket) {
  const sql = storage.sql;
  function enabled() { return sql.exec<{ legacy_records: number }>("SELECT legacy_records FROM blob_gc_state WHERE id=1").toArray()[0].legacy_records === 0; }
  async function finish(id: string) {
    const prefix = sql.exec<{ account_prefix: string | null }>("SELECT account_prefix FROM blob_gc_state WHERE id=1").toArray()[0].account_prefix;
    if (!prefix) throw new Error("Bridge blob namespace is not initialized");
    const start = `${prefix}${id}/`, end = `${prefix}${id}0`;
    const keys = sql.exec<{ key: string }>("SELECT key FROM quota_chunks WHERE key>=? AND key<?", start, end).toArray().map((row) => row.key);
    if (keys.length) {
      await archiveBlobChunks(bucket, archive, keys);
      await bucket.delete(keys);
    }
    storage.transactionSync(() => {
      sql.exec("DELETE FROM quota_chunks WHERE key>=? AND key<?", start, end);
      sql.exec("DELETE FROM blob_objects WHERE blob_id=? AND refs=0", id);
      sql.exec("DELETE FROM blob_deletions WHERE blob_id=?", id);
    });
  }
  const api = {
    setAccountPrefix(prefix: string) {
      // A fresh in-memory quota helper reuses the durable prefix. Avoid even a
      // zero-row UPDATE on ordinary reads: it can open a write transaction.
      if (sql.exec("SELECT 1 FROM blob_gc_state WHERE id=1 AND account_prefix IS NULL").toArray().length) {
        sql.exec("UPDATE blob_gc_state SET account_prefix=? WHERE id=1 AND account_prefix IS NULL", prefix);
      }
    },
    isDeleting(id: string) { return !!sql.exec("SELECT 1 FROM blob_deletions WHERE blob_id=?", id).toArray().length; },
    async resume(id: string) { if (api.isDeleting(id)) await finish(id); },
    /** An upload renews the grace period even if it reuses previously stored bytes. */
    protect(blobId: string) { sql.exec("UPDATE blob_objects SET delete_after=max(coalesce(delete_after,0),?) WHERE blob_id=? AND refs=0", Date.now() + BRIDGE_BLOB_GC_GRACE_MS, blobId); },
    protectRead(blobId: string, expiresAt: number) { sql.exec("UPDATE blob_objects SET delete_after=max(coalesce(delete_after,0),?) WHERE blob_id=? AND refs=0", expiresAt + 1000, blobId); },
    nextExpiry(): number | null {
      if (sql.exec("SELECT 1 FROM blob_deletions LIMIT 1").toArray().length) return Date.now();
      if (!enabled()) return null;
      return sql.exec<{ expires: number | null }>("SELECT min(delete_after) expires FROM blob_objects WHERE refs=0").toArray()[0].expires;
    },
    /** Only under the same account concurrency gate as publication/reservation/PUT.
     * R2 first, receipts second: a crash/failure stays charged and retries safely. */
    async collect() {
      // Finish durable deletion intents even when a legacy writer has since
      // paused new collection. Never publish a root against stale receipts.
      const pending = sql.exec<{ blob_id: string }>("SELECT blob_id FROM blob_deletions LIMIT 32").toArray();
      for (const { blob_id: id } of pending) await finish(id);
      if (!enabled()) return;
      const prefix = sql.exec<{ account_prefix: string | null }>("SELECT account_prefix FROM blob_gc_state WHERE id=1").toArray()[0].account_prefix;
      if (!prefix) return;
      const candidates = sql.exec<{ blob_id: string }>("SELECT blob_id FROM blob_objects WHERE refs=0 AND delete_after<=? ORDER BY delete_after LIMIT ?", Date.now(), 32 - pending.length).toArray();
      for (const { blob_id: id } of candidates) {
        sql.exec("INSERT OR IGNORE INTO blob_deletions VALUES(?)", id);
        await finish(id);
      }
    },
  };
  return api;
}
