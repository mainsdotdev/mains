import { BRIDGE_IDLE_RETENTION_MS } from "@mains/contracts/bridge-protocol";

export const COMPACTION_ROWS = 128;
const jobsPerPass = 16;
type Job = { kind: string; stream: string; register_key: string; after_rowid: number; until_rowid: number };

/** Durable, indexed work survives hibernation. Only routing headers enter SQL;
 * permanent tombstones and stream sequence counters are never removed. */
export function createHubCompaction(storage: DurableObjectStorage) {
  const sql = storage.sql;
  storage.transactionSync(() => {
    sql.exec(`CREATE TABLE IF NOT EXISTS compaction_jobs(kind TEXT NOT NULL,stream TEXT NOT NULL,register_key TEXT NOT NULL,
        due_at INTEGER,after_rowid INTEGER NOT NULL DEFAULT 0,until_rowid INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(kind,stream,register_key));
      CREATE INDEX IF NOT EXISTS compaction_due ON compaction_jobs(due_at,kind,stream,register_key) WHERE due_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS log_register_seq ON log(stream,register_key,seq);
      CREATE INDEX IF NOT EXISTS latest_retention ON latest(stream) WHERE json_extract(envelope,'$.header.retention')='30d-idle';
      CREATE TRIGGER IF NOT EXISTS latest_compaction_update AFTER UPDATE OF seq ON latest WHEN NEW.seq<>OLD.seq BEGIN
        INSERT INTO compaction_jobs(kind,stream,register_key,due_at) VALUES('record',OLD.stream,OLD.register_key,0)
          ON CONFLICT(kind,stream,register_key) DO NOTHING;
      END;
      CREATE TRIGGER IF NOT EXISTS latest_compaction_delete AFTER DELETE ON latest BEGIN
        INSERT INTO compaction_jobs(kind,stream,register_key,due_at)
          SELECT 'record',OLD.stream,OLD.register_key,0 WHERE NOT EXISTS(
            SELECT 1 FROM runs WHERE run_id=substr(OLD.stream,5) AND tombstone IS NOT NULL)
          ON CONFLICT(kind,stream,register_key) DO NOTHING;
      END;
      CREATE TRIGGER IF NOT EXISTS run_compaction_update AFTER UPDATE OF tombstone ON runs WHEN NEW.tombstone IS NOT NULL BEGIN
        INSERT INTO compaction_jobs(kind,stream,register_key,due_at) VALUES('run','run:'||NEW.run_id,'',0)
          ON CONFLICT(kind,stream,register_key) DO NOTHING;
      END;
      CREATE TRIGGER IF NOT EXISTS latest_retention_insert AFTER INSERT ON latest
        WHEN json_extract(NEW.envelope,'$.header.retention')='30d-idle' BEGIN
        INSERT INTO compaction_jobs(kind,stream,register_key,due_at)
          SELECT 'retention',NEW.stream,'',last_activity+${BRIDGE_IDLE_RETENTION_MS} FROM stream_activity WHERE stream=NEW.stream
          ON CONFLICT(kind,stream,register_key) DO UPDATE SET due_at=excluded.due_at;
      END;
      CREATE TRIGGER IF NOT EXISTS latest_retention_update AFTER UPDATE OF envelope ON latest BEGIN
        DELETE FROM compaction_jobs WHERE kind='retention' AND stream=OLD.stream AND NOT EXISTS(
          SELECT 1 FROM latest WHERE stream=OLD.stream AND json_extract(envelope,'$.header.retention')='30d-idle');
        INSERT INTO compaction_jobs(kind,stream,register_key,due_at)
          SELECT 'retention',NEW.stream,'',last_activity+${BRIDGE_IDLE_RETENTION_MS} FROM stream_activity
          WHERE stream=NEW.stream AND json_extract(NEW.envelope,'$.header.retention')='30d-idle'
          ON CONFLICT(kind,stream,register_key) DO UPDATE SET due_at=excluded.due_at;
      END;
      CREATE TRIGGER IF NOT EXISTS latest_retention_delete AFTER DELETE ON latest
        WHEN json_extract(OLD.envelope,'$.header.retention')='30d-idle' BEGIN
        DELETE FROM compaction_jobs WHERE kind='retention' AND stream=OLD.stream AND NOT EXISTS(
          SELECT 1 FROM latest WHERE stream=OLD.stream AND json_extract(envelope,'$.header.retention')='30d-idle');
      END;
      CREATE TRIGGER IF NOT EXISTS activity_retention_update AFTER UPDATE OF last_activity ON stream_activity BEGIN
        UPDATE compaction_jobs SET due_at=NEW.last_activity+${BRIDGE_IDLE_RETENTION_MS} WHERE kind='retention' AND stream=NEW.stream;
      END;`);
    if (!sql.exec("SELECT 1 FROM compaction_jobs WHERE kind='legacy' AND stream='' AND register_key=''").toArray().length) {
      const end = Number(sql.exec("SELECT coalesce(max(rowid),0) n FROM log").one().n);
      sql.exec("INSERT INTO compaction_jobs VALUES('legacy','','',?,0,?)", end ? 0 : null, end);
      // The new partial index limits this one-time seed to retained registers.
      // Legacy log discovery itself is cursor-based and bounded on later alarms.
      sql.exec(`INSERT OR IGNORE INTO compaction_jobs(kind,stream,register_key,due_at)
        SELECT 'retention',l.stream,'',a.last_activity+${BRIDGE_IDLE_RETENTION_MS}
        FROM latest l JOIN stream_activity a ON a.stream=l.stream
        WHERE json_extract(l.envelope,'$.header.retention')='30d-idle' GROUP BY l.stream`);
    }
  });
  const forget = (job: Job) => sql.exec("DELETE FROM compaction_jobs WHERE kind=? AND stream=? AND register_key=?", job.kind, job.stream, job.register_key);
  function remove(table: "latest" | "log", rows: { id: number }[]) {
    // workerd limits bound parameters per statement. Keep the pass budget
    // independent of that limit, including a full 128-row legacy cleanup.
    for (let start = 0; start < rows.length; start += 64) {
      const batch = rows.slice(start, start + 64);
      sql.exec(`DELETE FROM ${table} WHERE rowid IN (${batch.map(() => "?").join(",")})`, ...batch.map((row) => row.id));
    }
    return rows.length;
  }
  return {
    nextExpiry(): number | null {
      const row = sql.exec<{ due_at: number }>(`SELECT due_at FROM compaction_jobs WHERE due_at IS NOT NULL
        ORDER BY due_at,kind,stream,register_key LIMIT 1`).toArray()[0];
      // Coalesce fresh dirty work with the existing one-minute push alarm.
      return row ? row.due_at === 0 ? Date.now() + 60_000 : row.due_at : null;
    },
    compact() {
      return storage.transactionSync(() => {
        let remaining = COMPACTION_ROWS, rowsRemoved = 0, legacyRows = 0;
        for (let n = 0; n < jobsPerPass && remaining > 0; n++) {
          const job = sql.exec<Job>(`SELECT kind,stream,register_key,after_rowid,until_rowid FROM compaction_jobs
            WHERE due_at IS NOT NULL AND due_at<=? ORDER BY due_at,kind,stream,register_key LIMIT 1`, Date.now()).toArray()[0];
          if (!job) break;
          if (job.kind === "legacy") {
            const rows = sql.exec<{ id: number; stream: string; register_key: string | null; op: string }>(
              "SELECT rowid id,stream,register_key,op FROM log WHERE rowid>? AND rowid<=? ORDER BY rowid LIMIT ?",
              job.after_rowid, job.until_rowid, remaining).toArray();
            for (const row of rows) {
              const closed = row.stream !== "account" && sql.exec("SELECT 1 FROM runs WHERE run_id=? AND tombstone IS NOT NULL", row.stream.slice(4)).toArray().length;
              if (closed || row.op === "upsert") sql.exec(`INSERT OR IGNORE INTO compaction_jobs(kind,stream,register_key,due_at) VALUES(?,?,?,0)`,
                closed ? "run" : "record", row.stream, closed ? "" : row.register_key ?? "");
            }
            const after = rows.at(-1)?.id ?? job.until_rowid, done = rows.length < remaining || after >= job.until_rowid;
            sql.exec("UPDATE compaction_jobs SET after_rowid=?,due_at=? WHERE kind='legacy' AND stream='' AND register_key=''", after, done ? null : 0);
            remaining -= rows.length; legacyRows += rows.length;
            continue;
          }
          let removed = 0;
          if (job.kind === "record") {
            const rows = sql.exec<{ id: number }>(`SELECT l.rowid id FROM log l WHERE l.stream=? AND l.register_key IS ? AND l.op='upsert'
              AND NOT EXISTS(SELECT 1 FROM latest t WHERE t.stream=l.stream AND t.register_key=l.register_key AND t.seq=l.seq)
              ORDER BY l.seq LIMIT ?`, job.stream, job.register_key || null, remaining).toArray();
            removed = remove("log", rows);
          } else if (job.kind === "retention") {
            const rows = sql.exec<{ id: number }>(`SELECT rowid id FROM latest WHERE stream=? AND json_extract(envelope,'$.header.retention')='30d-idle'
              AND EXISTS(SELECT 1 FROM stream_activity WHERE stream=? AND last_activity<=?) LIMIT ?`,
              job.stream, job.stream, Date.now() - BRIDGE_IDLE_RETENTION_MS, remaining).toArray();
            removed = remove("latest", rows);
          } else if (job.kind === "run") {
            if (sql.exec("SELECT 1 FROM runs WHERE run_id=? AND tombstone IS NOT NULL", job.stream.slice(4)).toArray().length) {
              removed = remove("latest", sql.exec<{ id: number }>("SELECT rowid id FROM latest WHERE stream=? LIMIT ?", job.stream, remaining).toArray());
              if (removed < remaining) removed += remove("log", sql.exec<{ id: number }>("SELECT rowid id FROM log WHERE stream=? LIMIT ?", job.stream, remaining - removed).toArray());
            }
          } else { throw new Error("Unknown compaction job"); }
          if (removed < remaining) forget(job);
          remaining -= removed; rowsRemoved += removed;
        }
        const hasMore = sql.exec("SELECT 1 FROM compaction_jobs WHERE due_at IS NOT NULL AND due_at<=? LIMIT 1", Date.now()).toArray().length > 0;
        return { hasMore, rowsRemoved, legacyRows };
      });
    },
  };
}
