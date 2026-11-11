import { BRIDGE_BLOB_GC_GRACE_MS } from "@mains/contracts/bridge-blobs";
export { createBlobCollector } from "./blob-lifecycle";

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
      CREATE TABLE IF NOT EXISTS blob_uploads(key TEXT PRIMARY KEY,blob_id TEXT NOT NULL,upload_id TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS blob_uploads_object ON blob_uploads(blob_id);
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
