import { BRIDGE_IDLE_RETENTION_MS } from "@mains/contracts/bridge-protocol";
import { createHubCompactionLifecycle } from "./hub-maintenance-lifecycle";
export { COMPACTION_ROWS } from "./hub-maintenance-lifecycle";

/** Select only obsolete ciphertext. Permanent tombstones, writer bindings and
 * stream sequence counters never enter a removal set. */
export function createHubCompaction(storage: DurableObjectStorage) {
  const sql = storage.sql, lifecycle = createHubCompactionLifecycle(storage);
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
    nextExpiry: lifecycle.nextExpiry,
    compact() {
      return lifecycle.pass((job, remaining, now) => {
        let removed = 0;
        if (job.kind === "record") {
          const rows = sql.exec<{ id: number }>(`SELECT l.rowid id FROM log l WHERE l.stream=? AND l.register_key IS ? AND l.op='upsert'
            AND NOT EXISTS(SELECT 1 FROM latest t WHERE t.stream=l.stream AND t.register_key=l.register_key AND t.seq=l.seq)
            ORDER BY l.seq LIMIT ?`, job.stream, job.register_key || null, remaining).toArray();
          removed = remove("log", rows);
        } else if (job.kind === "retention") {
          const rows = sql.exec<{ id: number }>(`SELECT rowid id FROM latest WHERE stream=? AND json_extract(envelope,'$.header.retention')='30d-idle'
            AND EXISTS(SELECT 1 FROM stream_activity WHERE stream=? AND last_activity<=?) LIMIT ?`,
            job.stream, job.stream, now - BRIDGE_IDLE_RETENTION_MS, remaining).toArray();
          removed = remove("latest", rows);
        } else if (job.kind === "run") {
          if (sql.exec("SELECT 1 FROM runs WHERE run_id=? AND tombstone IS NOT NULL", job.stream.slice(4)).toArray().length) {
            removed = remove("latest", sql.exec<{ id: number }>("SELECT rowid id FROM latest WHERE stream=? LIMIT ?", job.stream, remaining).toArray());
            if (removed < remaining) removed += remove("log", sql.exec<{ id: number }>("SELECT rowid id FROM log WHERE stream=? LIMIT ?", job.stream, remaining - removed).toArray());
          }
        } else { throw new Error("Unknown compaction job"); }
        return removed;
      });
    },
  };
}
