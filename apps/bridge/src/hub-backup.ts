/** Private operator export, never part of the client sync protocol. No snapshot
 * tables/triggers/writes are added to the live database. A page rejects any SQL
 * write or object restart; the operator may resume a new session only behind an
 * unchanged durable commit bookmark, checked again after the complete capture. */
const tables = new Set(["streams", "log", "latest", "deleted", "row_owners", "runs", "presence", "backend_metadata",
  "write_rate", "stream_activity", "record_usage", "quota_chunks", "quota_state", "quota_usage",
  "blob_gc_state", "blob_objects", "blob_deletions", "blob_links", "compaction_jobs", "blob_uploads", "write_budget", "publications", "membership", "membership_fences"]);
export interface HubSchema { type: string; name: string; tbl_name: string; sql: string }
export interface HubSnapshot { version: 1; token: string; capturedAt: string; schema: HubSchema[]; tables: string[]; sourceBookmark?: string }
export interface HubPage { changed: boolean; rows: { rowid: number; values: (string | number | null)[] }[]; next: number; done: boolean }

export function createHubBackup(storage: any) {
  const instance = crypto.randomUUID(), sql = storage.sql;
  // total_changes includes trigger effects and deletions, unlike max(seq). The
  // instance nonce fences hibernation/restart where SQLite's counter resets.
  const token = () => `${instance}:${sql.exec("SELECT total_changes() AS n").one().n}`;
  return {
    begin(): HubSnapshot {
      // This hub uses SQL only (plus a maintenance alarm). Refuse to silently
      // omit application KV if a future migration introduces it.
      if (storage.kv.list({ limit: 1 }).size) throw new Error("Unsupported backup KV state");
      // Production adds a platform-owned metadata table absent from local
      // workerd. The destination runtime creates its own; never export/restore
      // Cloudflare's internal replication metadata as application SQL.
      const schema = sql.exec("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__cf_%' AND tbl_name<>'_cf_METADATA' ORDER BY type,name").toArray() as HubSchema[];
      const names = schema.filter((row) => row.type === "table").map((row) => row.name);
      if (names.length !== tables.size || names.some((name) => !tables.has(name)) || schema.some((row) => !tables.has(row.tbl_name))) {
        const extra = [...new Set(schema.filter((row) => !tables.has(row.tbl_name)).map((row) => /^[a-z_][a-z0-9_]{0,63}$/i.test(row.tbl_name) ? row.tbl_name : "unrecognized"))];
        throw new Error(`Unsupported backup schema (tables=${names.length}; extra=${extra.join(",")})`);
      }
      return { version: 1, token: token(), capturedAt: new Date().toISOString(), schema, tables: names };
    },
    page(expected: string, table: string, after: number): HubPage {
      if (!tables.has(table) || !Number.isSafeInteger(after) || after < 0 || typeof expected !== "string" || expected.length > 128) throw new Error("Invalid snapshot cursor");
      if (expected !== token()) return { changed: true, rows: [], next: after, done: false };
      const rows: HubPage["rows"] = [];
      let bytes = 0;
      // All cursors are consumed synchronously. Never hold a SQL cursor over
      // await: the runtime does not provide snapshot isolation across awaits.
      const cursor = sql.exec(`SELECT rowid AS backup_rowid,* FROM "${table}" WHERE rowid>? ORDER BY rowid LIMIT 64`, after);
      let done = true;
      for (const row of cursor) {
        const values = Object.entries(row).filter(([key]) => key !== "backup_rowid").map(([, value]) => value) as (string | number | null)[];
        if (values.some((value) => value !== null && typeof value !== "string" && (typeof value !== "number" || !Number.isSafeInteger(value)))) throw new Error("Unsupported backup column type");
        const size = new TextEncoder().encode(JSON.stringify(values)).length;
        if (size > 20 * 1024 * 1024) throw new Error("Snapshot row exceeds export limit");
        if (bytes + size > 20 * 1024 * 1024 || rows.length >= 63) { done = false; break; }
        rows.push({ rowid: row.backup_rowid, values }); bytes += size;
      }
      return { changed: false, rows, next: rows.at(-1)?.rowid ?? after, done };
    },
    valid(expected: string) { return expected === token(); },
  };
}
