import type { SQLiteInstance } from "../../db/types";
import { isSeededSpaceId } from "@mains/contracts/spaces";
import { definition, isAtlas, literal, quote, syncedTables } from "./bridge.sql";

const backend = "(SELECT backend_id FROM bridge_config WHERE id=1)";
const now = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";
export const tickSql = `UPDATE bridge_clock SET
  counter=CASE WHEN physical_ms >= ${now} THEN counter+1 ELSE 0 END,
  physical_ms=max(physical_ms, ${now}), generation=generation+1 WHERE id=1;`;
export const localClock = "(SELECT physical_ms FROM bridge_clock WHERE id=1)";
export const localCounter = "(SELECT counter FROM bridge_clock WHERE id=1)";
export const generation = "(SELECT generation FROM bridge_clock WHERE id=1)";

export function portablePkSql(table: string, prefix: string): string {
  const def = definition(table);
  if (def.idKind === "run-integer") return `coalesce((SELECT remote_id FROM bridge_id_map WHERE owner_backend_id=${backend} AND table_name=${literal(table)} AND local_id=${prefix}.id LIMIT 1), ${prefix}.run_id || ':' || ${prefix}.id)`;
  if (def.idKind === "composite") return `json_array(${def.primaryKey.map((col) => `${prefix}.${quote(col)}`).join(",")})`;
  return `CAST(${prefix}.${quote(def.primaryKey[0])} AS TEXT)`;
}
export function runIdSql(table: string, prefix: string): string {
  if (table === "runs") return `${prefix}.id`;
  if (table === "run_attachments") return `(SELECT run_id FROM run_attachment_refs WHERE attachment_id=${prefix}.id ORDER BY run_id LIMIT 1)`;
  return definition(table).ownerRoot === "runs" ? `${prefix}.run_id` : "NULL";
}
export function ownerSql(table: string, prefix: string): string {
  const def = definition(table);
  if (!def.ownerRoot) return "NULL";
  if (def.ownerRoot === table) return `coalesce(nullif(${prefix}.owner_backend_id,''), ${backend})`;
  if (table === "run_attachments") return `(SELECT owner_backend_id FROM runs WHERE id=${runIdSql(table, prefix)})`;
  if (def.ownerRoot === "runs") return `(SELECT owner_backend_id FROM runs WHERE id=${prefix}.run_id)`;
  if (def.ownerRoot === "automations") return `(SELECT owner_backend_id FROM automations WHERE id=${prefix}.automation_id)`;
  if (table === "reviews") return `coalesce((SELECT owner_backend_id FROM workspaces WHERE id=${prefix}.workspace_id), (SELECT owner_backend_id FROM runs WHERE id=${prefix}.run_id))`;
  if (table === "review_findings") return `(SELECT coalesce(w.owner_backend_id,r.owner_backend_id) FROM reviews v LEFT JOIN workspaces w ON w.id=v.workspace_id LEFT JOIN runs r ON r.id=v.run_id WHERE v.id=${prefix}.review_id)`;
  return `(SELECT owner_backend_id FROM workspaces WHERE id=${prefix}.workspace_id)`;
}
/** Scope walks required parents, and selected target workspaces, without JS UDFs. */
export function scopeSql(table: string, prefix: string, seen = new Set<string>()): string {
  const pk = portablePkSql(table, prefix), def = definition(table);
  const own = `NOT EXISTS(SELECT 1 FROM bridge_exclusions e WHERE e.table_name=${literal(table)} AND e.pk=${pk})`;
  if (seen.has(table)) return own;
  const next = new Set(seen).add(table), clauses = [own];
  for (const [column, ref] of Object.entries(def.references)) {
    if (ref.class !== "required" && !(column === "workspace_id" && ref.table === "workspaces")) continue;
    const parent = `scope_${next.size}_${column}`;
    clauses.push(`(${prefix}.${quote(column)} IS NULL OR EXISTS(SELECT 1 FROM ${quote(ref.table)} ${parent} WHERE ${parent}.id=${prefix}.${quote(column)} AND ${scopeSql(ref.table, parent, next)}))`);
  }
  if (table === "atlas_items") {
    const file = `scope_file_${next.size}`;
    clauses.push(`(${prefix}.kind<>'page' OR NOT EXISTS(SELECT 1 FROM atlas_page_file_refs f JOIN atlas_page_revisions v ON v.id=f.revision_id JOIN atlas_items ${file} ON ${file}.id=f.file_id WHERE v.item_id=${prefix}.id AND NOT (${scopeSql("atlas_items", file, next)})))`);
  }
  return clauses.join(" AND ");
}
export function projectIdSql(table: string, prefix: string): string {
  const def = definition(table);
  let direct = "NULL";
  if (table === "projects") direct = `${prefix}.id`;
  else if (table === "workspaces") direct = `${prefix}.project_id`;
  else if (table === "review_findings") direct = `(SELECT w.project_id FROM reviews v JOIN workspaces w ON w.id=v.workspace_id WHERE v.id=${prefix}.review_id)`;
  else if (def.references.workspace_id) direct = `(SELECT project_id FROM workspaces WHERE id=${prefix}.workspace_id)`;
  else if (def.ownerRoot === "runs") direct = `(SELECT w.project_id FROM runs r JOIN workspaces w ON w.id=r.workspace_id WHERE r.id=${runIdSql(table, prefix)})`;
  return `coalesce(${direct},(SELECT project_id FROM bridge_row_clock WHERE table_name=${literal(table)} AND pk=${portablePkSql(table, prefix)} AND project_id IS NOT NULL LIMIT 1))`;
}
export function eligibleSql(table: string, prefix: string): string {
  const def = definition(table), pk = portablePkSql(table, prefix);
  return [
    "coalesce((SELECT max(enabled,tracking_enabled) FROM bridge_config WHERE id=1),0)=1",
    "(SELECT applying FROM bridge_state WHERE id=1)=0",
    isAtlas(table) ? "(SELECT atlas_enabled FROM bridge_config WHERE id=1)=1" : "1",
    def.ownerRoot ? `${ownerSql(table, prefix)}=${backend}` : "1",
    `NOT EXISTS(SELECT 1 FROM bridge_tombstones WHERE table_name=${literal(table)} AND pk=${pk})`,
  ].join(" AND ");
}
function publishSql(table: string, prefix: string): string {
  const run = definition(table).ownerRoot === "runs" && table !== "runs" ? ` AND EXISTS(SELECT 1 FROM runs scope_run WHERE scope_run.id=${runIdSql(table, prefix)} AND ${scopeSql("runs", "scope_run")})` : "";
  return `(SELECT enabled FROM bridge_config WHERE id=1)=1 AND ${scopeSql(table, prefix)}${run}`;
}
export function captureSql(table: string, register: string, prefix: string, previous?: string): string {
  const def = definition(table), pk = portablePkSql(table, prefix), owner = ownerSql(table, prefix), runId = runIdSql(table, prefix);
  const fileColumns = [...def.blobColumns, "content_hash"].filter((column) => def.registers[register].includes(column));
  const preserveFiles = previous && fileColumns.length ? `CASE WHEN ${fileColumns.map((column) => `${previous}.${quote(column)} IS ${prefix}.${quote(column)}`).join(" AND ")} THEN blob_refs_json ELSE NULL END` : "NULL";
  const stream = def.stream === "account" ? "'account'" : `'run:' || ${runId}`;
  const values = def.registers[register].flatMap((col) => {
    const value = col === "owner_backend_id" ? owner : col === "blob_data" ? "NULL" : `${prefix}.${quote(col)}`;
    // JSON1 results keep their JSON subtype through NEW in a trigger. Concatenation
    // strips that subtype so TEXT stays a string inside the captured row image.
    return [literal(col), `CASE WHEN typeof(${value})='text' THEN ${value} || '' ELSE ${value} END`];
  });
  return `${tickSql}
    INSERT INTO bridge_row_clock(table_name,pk,register,physical_ms,counter,origin,values_json,refs_json,portable,dirty,project_id)
      VALUES(${literal(table)},${pk},${literal(register)},${localClock},${localCounter},${backend},json_object(${values.join(",")}), '{}',0,1,${projectIdSql(table, prefix)})
      ON CONFLICT(table_name,pk,register) DO UPDATE SET physical_ms=excluded.physical_ms,counter=excluded.counter,
        origin=excluded.origin,values_json=excluded.values_json,refs_json='{}',blob_refs_json=${preserveFiles},portable=0,dirty=1,project_id=excluded.project_id;
    DELETE FROM bridge_pending_links WHERE table_name=${literal(table)} AND pk=${pk} AND register=${literal(register)};
    INSERT INTO bridge_outbox(table_name,pk,register,op,generation,stream,owner,run_id,changed_at)
      SELECT ${literal(table)},${pk},${literal(register)},'upsert',${generation},${stream},${owner},${runId},${localClock} WHERE ${publishSql(table, prefix)}
      ON CONFLICT(table_name,pk,register) DO UPDATE SET op='upsert',generation=excluded.generation,stream=excluded.stream,owner=excluded.owner,run_id=excluded.run_id,changed_at=excluded.changed_at;`;
}

/** Persistent SQL triggers deliberately use no JS UDF: every SQLite connection can write. */
export function installBridgeCapture(sqlite: SQLiteInstance): void {
  sqlite.transaction(() => {
    sqlite.exec("INSERT OR IGNORE INTO bridge_clock(id) VALUES(1); INSERT OR IGNORE INTO bridge_state(id) VALUES(1)");
    for (const [table, def] of syncedTables) {
      const pkNew = portablePkSql(table, "NEW"), pkOld = portablePkSql(table, "OLD");
      // Primary keys are immutable. Re-adding a permanently deleted identity is never allowed.
      sqlite.exec(`DROP TRIGGER IF EXISTS ${quote(`bridge_${table}_identity`)};
        DROP TRIGGER IF EXISTS ${quote(`bridge_${table}_fence`)};
        CREATE TRIGGER ${quote(`bridge_${table}_identity`)} BEFORE UPDATE ON ${quote(table)}
        WHEN (SELECT max(enabled,tracking_enabled) FROM bridge_config WHERE id=1)=1 AND (SELECT applying FROM bridge_state WHERE id=1)=0 AND (${pkNew} IS NOT ${pkOld})
        BEGIN SELECT RAISE(ABORT,'Bridge identities are immutable'); END;
        CREATE TRIGGER ${quote(`bridge_${table}_fence`)} BEFORE INSERT ON ${quote(table)}
        WHEN (SELECT max(enabled,tracking_enabled) FROM bridge_config WHERE id=1)=1 AND EXISTS(SELECT 1 FROM bridge_tombstones WHERE table_name=${literal(table)} AND pk=${pkNew})
        BEGIN SELECT RAISE(ABORT,'A deleted Bridge identity cannot be reused'); END;`);
      for (const [register, columns] of Object.entries(def.registers)) {
        for (const event of ["INSERT", "UPDATE"]) {
          const changed = event === "UPDATE" ? ` AND (${columns.map((col) => `OLD.${quote(col)} IS NOT NEW.${quote(col)}`).join(" OR ")}${table === "run_attachments" ? ` OR NOT EXISTS(SELECT 1 FROM bridge_row_clock WHERE table_name='run_attachments' AND pk=NEW.id)` : ""})` : "";
          sqlite.exec(`DROP TRIGGER IF EXISTS ${quote(`bridge_${table}_${register}_${event.toLowerCase()}`)};
            CREATE TRIGGER ${quote(`bridge_${table}_${register}_${event.toLowerCase()}`)} AFTER ${event} ON ${quote(table)}
            WHEN ${eligibleSql(table, "NEW")}${changed}
            BEGIN ${captureSql(table, register, "NEW", event === "UPDATE" ? "OLD" : undefined)} END;`);
        }
      }
      const aliases = `SELECT ${pkOld} AS pk UNION SELECT alias_pk FROM bridge_aliases WHERE table_name=${literal(table)} AND canonical_pk=${pkOld}`;
      const stream = def.stream === "account" ? "'account'" : `'run:' || ${runIdSql(table, "OLD")}`;
      sqlite.exec(`DROP TRIGGER IF EXISTS ${quote(`bridge_${table}_delete`)};
        CREATE TRIGGER ${quote(`bridge_${table}_delete`)} BEFORE DELETE ON ${quote(table)}
        WHEN ${eligibleSql(table, "OLD")}
        BEGIN ${tickSql}
          DELETE FROM bridge_outbox WHERE table_name=${literal(table)} AND pk IN (${aliases});
          INSERT INTO bridge_tombstones(table_name,pk,stream,owner,run_id,project_id) SELECT ${literal(table)},pk,${stream},${ownerSql(table, "OLD")},${runIdSql(table, "OLD")},${projectIdSql(table, "OLD")} FROM (${aliases}) WHERE 1
            ON CONFLICT(table_name,pk) DO NOTHING;
          INSERT INTO bridge_row_clock(table_name,pk,register,physical_ms,counter,origin,values_json,portable,dirty,project_id)
            SELECT ${literal(table)},pk,'__delete__',${localClock},${localCounter},${backend},'{}',0,1,${projectIdSql(table, "OLD")} FROM (${aliases}) WHERE 1
            ON CONFLICT(table_name,pk,register) DO NOTHING;
          INSERT INTO bridge_outbox(table_name,pk,register,op,generation,stream,owner,run_id,changed_at)
            SELECT ${literal(table)},pk,'__delete__','delete',${generation},${stream},${ownerSql(table, "OLD")},${runIdSql(table, "OLD")},${localClock} FROM (${aliases}) WHERE ${publishSql(table, "OLD")}
            ON CONFLICT(table_name,pk,register) DO UPDATE SET op='delete',generation=excluded.generation,changed_at=excluded.changed_at;
        END;`);
    }
    // An attachment is inserted before its first reference. Capture it when it becomes routable.
    sqlite.exec(`DROP TRIGGER IF EXISTS bridge_attachment_routed;
      CREATE TRIGGER bridge_attachment_routed AFTER INSERT ON run_attachment_refs
      WHEN ${eligibleSql("run_attachment_refs", "NEW")}
      BEGIN
        UPDATE run_attachments SET name=name WHERE id=NEW.attachment_id;
      END;`);
    // No permanently deleted fixed ids: the service archives seeds, SQL must also protect them.
    for (const [table, ids] of [["accounts", ["default"]], ["spaces", ["claude", "codex", "copilot", "cursor"].filter(isSeededSpaceId)]] as const) {
      sqlite.exec(`DROP TRIGGER IF EXISTS ${quote(`bridge_${table}_fixed`)};
        CREATE TRIGGER ${quote(`bridge_${table}_fixed`)} BEFORE DELETE ON ${quote(table)}
        WHEN (SELECT max(enabled,tracking_enabled) FROM bridge_config WHERE id=1)=1 AND OLD.id IN (${ids.map(literal).join(",")})
        BEGIN SELECT RAISE(ABORT,'Fixed Bridge identities must be archived'); END;`);
    }
  })();
}
