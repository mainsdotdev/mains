import type { BridgeEnvelope, BridgeLogRecord, BridgePushResult, BridgeStream } from "@mains/contracts/bridge-protocol";
import { BRIDGE_MAX_FRAME_BYTES } from "@mains/contracts/bridge-wire";
import { BRIDGE_IDLE_RETENTION_MS } from "@mains/contracts/bridge-protocol";
import type { BridgeBlobIdentity } from "@mains/contracts/bridge-blobs";
import { installBlobReferences } from "./blob-gc";

type LogRow = { seq: number; envelope: string };
const order = (a: BridgeEnvelope, b: BridgeEnvelope) => a.header.hlc.physicalMs - b.header.hlc.physicalMs || a.header.hlc.counter - b.header.hlc.counter ||
  (a.header.origin < b.header.origin ? -1 : a.header.origin > b.header.origin ? 1 : 0);

/** Only opaque keys, authenticated routing fields and whole ciphertext envelopes enter storage. */
export function createHubStore(storage: DurableObjectStorage) {
  const sql = storage.sql;
  sql.exec(`CREATE TABLE IF NOT EXISTS streams(stream TEXT PRIMARY KEY, seq INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS log(stream TEXT NOT NULL, seq INTEGER NOT NULL, row_key TEXT NOT NULL, register_key TEXT, op TEXT NOT NULL, envelope TEXT NOT NULL, PRIMARY KEY(stream,seq));
    CREATE INDEX IF NOT EXISTS log_row ON log(row_key);
    CREATE TABLE IF NOT EXISTS latest(stream TEXT NOT NULL, register_key TEXT NOT NULL, seq INTEGER NOT NULL, envelope TEXT NOT NULL, PRIMARY KEY(stream,register_key));
    CREATE TABLE IF NOT EXISTS deleted(row_key TEXT PRIMARY KEY, stream TEXT NOT NULL, seq INTEGER NOT NULL, envelope TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS row_owners(row_key TEXT PRIMARY KEY, owner TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs(run_id TEXT PRIMARY KEY, owner TEXT NOT NULL, root_key TEXT NOT NULL UNIQUE, tombstone TEXT);
    CREATE TABLE IF NOT EXISTS presence(backend_id TEXT PRIMARY KEY, last_seen INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS backend_metadata(backend_id TEXT PRIMARY KEY, label TEXT NOT NULL, platform TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS write_rate(backend_id TEXT PRIMARY KEY,window INTEGER NOT NULL,count INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS stream_activity(stream TEXT PRIMARY KEY,last_activity INTEGER NOT NULL);`);
  const first = <T>(query: string, ...args: (string | number | null)[]): T | undefined => sql.exec(query, ...args).toArray()[0] as T | undefined;
  storage.transactionSync(() => {
    sql.exec(`CREATE INDEX IF NOT EXISTS latest_row_key ON latest(json_extract(envelope,'$.header.rowKey'));
      CREATE TABLE IF NOT EXISTS record_usage(id INTEGER PRIMARY KEY CHECK(id=1),bytes INTEGER NOT NULL CHECK(bytes>=0));`);
    if (!first("SELECT 1 FROM record_usage WHERE id=1")) {
      // Upgrade existing stores once. Old versions retained these superseded
      // ciphertexts until compaction, but already excluded them from quota.
      sql.exec(`DELETE FROM latest WHERE json_extract(envelope,'$.header.rowKey') IN (SELECT row_key FROM deleted)
        OR stream IN (SELECT 'run:'||run_id FROM runs WHERE tombstone IS NOT NULL);
        INSERT INTO record_usage SELECT 1,
          coalesce((SELECT sum(length(CAST(envelope AS BLOB))) FROM latest),0)
          +coalesce((SELECT sum(length(CAST(envelope AS BLOB))) FROM deleted),0);`);
    }
    for (const table of ["latest", "deleted"]) sql.exec(`
      CREATE TRIGGER IF NOT EXISTS ${table}_usage_insert AFTER INSERT ON ${table} BEGIN
        UPDATE record_usage SET bytes=bytes+length(CAST(NEW.envelope AS BLOB)) WHERE id=1;
      END;
      CREATE TRIGGER IF NOT EXISTS ${table}_usage_delete AFTER DELETE ON ${table} BEGIN
        UPDATE record_usage SET bytes=bytes-length(CAST(OLD.envelope AS BLOB)) WHERE id=1;
      END;
      CREATE TRIGGER IF NOT EXISTS ${table}_usage_update AFTER UPDATE OF envelope ON ${table}
      WHEN length(CAST(NEW.envelope AS BLOB))<>length(CAST(OLD.envelope AS BLOB)) BEGIN
        UPDATE record_usage SET bytes=bytes+length(CAST(NEW.envelope AS BLOB))-length(CAST(OLD.envelope AS BLOB)) WHERE id=1;
      END;`);
  });
  installBlobReferences(storage);
  const api = {
    recordBytes(): number {
      return first<{ bytes: number }>("SELECT bytes FROM record_usage WHERE id=1")!.bytes;
    },
    takeWrite(backendId: string, limit: number): boolean {
      const window = Math.floor(Date.now() / 60_000);
      const rate = first<{ window: number; count: number }>("SELECT window,count FROM write_rate WHERE backend_id=?", backendId);
      if (rate?.window === window && rate.count >= limit) return false;
      sql.exec("INSERT INTO write_rate VALUES(?,?,1) ON CONFLICT(backend_id) DO UPDATE SET window=excluded.window,count=CASE WHEN write_rate.window=excluded.window THEN count+1 ELSE 1 END", backendId, window);
      return true;
    },
    push(backendId: string, stream: BridgeStream, envelopes: BridgeEnvelope[], budget?: { limitBytes: number; blobBytes: number; writesPerMinute: number; canUpload?: boolean; hasBlobs?: (blobs: BridgeBlobIdentity[]) => boolean }) {
      return storage.transactionSync(() => {
        const changed: BridgeLogRecord[] = [];
        const results = envelopes.map((envelope): BridgePushResult => {
          const h = envelope.header;
          if (h.stream !== stream || h.origin !== backendId || h.owner && h.owner !== backendId) return { error: "notOwner" };
          const owner = first<{ owner: string }>("SELECT owner FROM row_owners WHERE row_key=?", h.rowKey);
          if (owner && owner.owner !== backendId) return { error: "notOwner" };
          if (stream !== "account") {
            const run = first<{ owner: string; tombstone: string | null }>("SELECT owner,tombstone FROM runs WHERE run_id=?", stream.slice(4));
            if (h.runId !== stream.slice(4) || !run || run.owner !== backendId || h.owner !== backendId) return { error: "notOwner" };
            if (run.tombstone) return { deleted: JSON.parse(run.tombstone) };
          } else if (h.runId) {
            const run = first<{ owner: string; root_key: string }>("SELECT owner,root_key FROM runs WHERE run_id=?", h.runId);
            if (!h.owner || run && (run.owner !== backendId || run.root_key !== h.rowKey) ||
                first("SELECT 1 FROM runs WHERE root_key=? AND run_id<>?", h.rowKey, h.runId)) return { error: "notOwner" };
          }
          const deleted = first<LogRow>("SELECT seq,envelope FROM deleted WHERE row_key=?", h.rowKey);
          if (deleted) return { deleted: JSON.parse(deleted.envelope) };
          const previous = h.op === "upsert" ? first<LogRow>("SELECT seq,envelope FROM latest WHERE stream=? AND register_key=?", stream, h.registerKey) : undefined;
          const previousEnvelope: BridgeEnvelope | undefined = previous && JSON.parse(previous.envelope);
          const comparison = previousEnvelope && order(envelope, previousEnvelope);
          // Upgrade only the original writer's exact legacy clock. This changes
          // neither LWW order nor application data; a stale image still loses.
          const rootsUpgrade = comparison === 0 && h.blobs !== undefined && previousEnvelope?.header.blobs === undefined;
          if (previous && comparison !== undefined && comparison <= 0 && !rootsUpgrade) return { seq: previous.seq };
          if (h.op === "upsert" && budget?.canUpload === false) return { error: "subscriptionRequired" };
          if (h.op === "upsert" && h.blobs && budget?.hasBlobs && !budget.hasBlobs(h.blobs)) return { error: "blobMissing" };
          const encoded = JSON.stringify(envelope);
          if (h.op === "upsert" && budget) {
            const delta = new TextEncoder().encode(encoded).length - (previous ? new TextEncoder().encode(previous.envelope).length : 0);
            if (delta > 0 && api.recordBytes() + budget.blobBytes + delta > budget.limitBytes) return { error: "quotaExceeded" };
            if (!api.takeWrite(backendId, budget.writesPerMinute)) return { error: "rateLimited" };
          }
          if (stream === "account" && h.runId) sql.exec("INSERT OR IGNORE INTO runs(run_id,owner,root_key) VALUES(?,?,?)", h.runId, backendId, h.rowKey);
          if (h.owner) sql.exec("INSERT OR IGNORE INTO row_owners(row_key,owner) VALUES(?,?)", h.rowKey, h.owner);
          sql.exec("INSERT INTO streams(stream,seq) VALUES(?,1) ON CONFLICT(stream) DO UPDATE SET seq=seq+1", stream);
          const seq = first<{ seq: number }>("SELECT seq FROM streams WHERE stream=?", stream)!.seq;
          if (h.runId) sql.exec("INSERT INTO stream_activity VALUES(?,?) ON CONFLICT(stream) DO UPDATE SET last_activity=excluded.last_activity", `run:${h.runId}`, Date.now());
          sql.exec("INSERT INTO log(stream,seq,row_key,register_key,op,envelope) VALUES(?,?,?,?,?,?)", stream, seq, h.rowKey, h.registerKey ?? null, h.op, encoded);
          if (h.op === "delete") {
            sql.exec("INSERT INTO deleted(row_key,stream,seq,envelope) VALUES(?,?,?,?)", h.rowKey, stream, seq, encoded);
            sql.exec("UPDATE runs SET tombstone=? WHERE root_key=?", encoded, h.rowKey);
            // Reclaim logical register bytes in the same transaction, across
            // registers/reused attachments and all children of a deleted run.
            sql.exec("DELETE FROM latest WHERE json_extract(envelope,'$.header.rowKey')=?", h.rowKey);
            sql.exec("DELETE FROM latest WHERE stream IN(SELECT 'run:'||run_id FROM runs WHERE root_key=?)", h.rowKey);
          } else sql.exec("INSERT INTO latest(stream,register_key,seq,envelope) VALUES(?,?,?,?) ON CONFLICT(stream,register_key) DO UPDATE SET seq=excluded.seq,envelope=excluded.envelope", stream, h.registerKey, seq, encoded);
          changed.push({ seq, envelope });
          return { seq };
        });
        return { results, changed };
      });
    },
    pull(stream: BridgeStream, after: number, limit: number) {
      // Paginate by bytes as well as record count so a valid push always remains pullable.
      const entries = sql.exec<LogRow>("SELECT seq,envelope FROM log WHERE stream=? AND seq>? ORDER BY seq LIMIT ?", stream, after, limit + 1);
      const records: BridgeLogRecord[] = []; let bytes = 512, hasMore = false;
      // Do not materialize limit+1 large rows before enforcing the frame byte cap.
      for (const entry of entries) {
        if (records.length === limit) { hasMore = true; break; }
        const size = new TextEncoder().encode(entry.envelope).length + 64;
        if (records.length && bytes + size > BRIDGE_MAX_FRAME_BYTES - 1024) { hasMore = true; break; }
        bytes += size; records.push({ seq: entry.seq, envelope: JSON.parse(entry.envelope) });
      }
      return { records, next: records.at(-1)?.seq ?? Math.max(after, first<{ seq: number }>("SELECT seq FROM streams WHERE stream=?", stream)?.seq ?? 0), hasMore };
    },
    compact() {
      storage.transactionSync(() => {
        sql.exec(`DELETE FROM latest WHERE json_extract(envelope,'$.header.retention')='30d-idle'
          AND stream IN(SELECT stream FROM stream_activity WHERE last_activity<=?)`, Date.now() - BRIDGE_IDLE_RETENTION_MS);
        sql.exec(`DELETE FROM log WHERE op='upsert' AND (EXISTS(SELECT 1 FROM deleted d WHERE d.row_key=log.row_key) OR NOT EXISTS(SELECT 1 FROM latest l WHERE l.stream=log.stream AND l.register_key=log.register_key AND l.seq=log.seq));
          DELETE FROM log WHERE stream IN (SELECT 'run:'||run_id FROM runs WHERE tombstone IS NOT NULL);
          DELETE FROM latest WHERE json_extract(envelope,'$.header.rowKey') IN (SELECT row_key FROM deleted) OR stream IN (SELECT 'run:'||run_id FROM runs WHERE tombstone IS NOT NULL);`);
      });
    },
    nextExpiry(): number | null {
      return first<{ expires: number | null }>(`SELECT min(a.last_activity)+? expires FROM stream_activity a
        WHERE EXISTS(SELECT 1 FROM latest l WHERE l.stream=a.stream AND json_extract(l.envelope,'$.header.retention')='30d-idle')`, BRIDGE_IDLE_RETENTION_MS)!.expires;
    },
    // Persist connection transitions only. Pulls and pings must not turn an
    // otherwise idle account into a writer or invalidate its backup bookmark.
    seen(backendId: string) {
      sql.exec(`INSERT INTO presence(backend_id,last_seen) VALUES(?,?) ON CONFLICT(backend_id) DO UPDATE SET last_seen=excluded.last_seen`, backendId, Date.now());
    },
    identify(backendId: string, label: string, platform: string) {
      sql.exec("INSERT INTO backend_metadata(backend_id,label,platform) VALUES(?,?,?) ON CONFLICT(backend_id) DO UPDATE SET label=excluded.label,platform=excluded.platform", backendId, label.trim(), platform);
    },
    presence() { return sql.exec<{ backend_id: string; last_seen: number; label: string | null; platform: string | null }>("SELECT p.backend_id,p.last_seen,m.label,m.platform FROM presence p LEFT JOIN backend_metadata m ON m.backend_id=p.backend_id").toArray(); },
  };
  return api;
}
