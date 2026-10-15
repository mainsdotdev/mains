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
export function eligibleSql(table: string, prefix: string): string {
  const def = definition(table), pk = portablePkSql(table, prefix);
  const runId = runIdSql(table, prefix);
  return [
    "coalesce((SELECT enabled FROM bridge_config WHERE id=1),0)=1",
    "(SELECT applying FROM bridge_state WHERE id=1)=0",
    isAtlas(table) ? "(SELECT atlas_enabled FROM bridge_config WHERE id=1)=1" : "1",
    def.ownerRoot ? `${ownerSql(table, prefix)}=${backend}` : "1",
    `NOT EXISTS(SELECT 1 FROM bridge_exclusions WHERE table_name=${literal(table)} AND pk=${pk})`,
    def.ownerRoot === "runs" ? `NOT EXISTS(SELECT 1 FROM bridge_exclusions WHERE table_name='runs' AND pk=${runId})` : "1",
    `NOT EXISTS(SELECT 1 FROM bridge_tombstones WHERE table_name=${literal(table)} AND pk=${pk})`,
  ].join(" AND ");
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
    INSERT INTO bridge_row_clock(table_name,pk,register,physical_ms,counter,origin,values_json,refs_json,portable)
      VALUES(${literal(table)},${pk},${literal(register)},${localClock},${localCounter},${backend},json_object(${values.join(",")}), '{}',0)
      ON CONFLICT(table_name,pk,register) DO UPDATE SET physical_ms=excluded.physical_ms,counter=excluded.counter,
        origin=excluded.origin,values_json=excluded.values_json,refs_json='{}',blob_refs_json=${preserveFiles},portable=0;
    DELETE FROM bridge_pending_links WHERE table_name=${literal(table)} AND pk=${pk} AND register=${literal(register)};
    INSERT INTO bridge_outbox(table_name,pk,register,op,generation,stream,owner,run_id,changed_at)
      VALUES(${literal(table)},${pk},${literal(register)},'upsert',${generation},${stream},${owner},${runId},${localClock})
      ON CONFLICT(table_name,pk,register) DO UPDATE SET op='upsert',generation=excluded.generation,stream=excluded.stream,owner=excluded.owner,run_id=excluded.run_id,changed_at=excluded.changed_at;`;
}

/** Persistent SQL triggers deliberately use no JS UDF: every SQLite connection can write. */
export function installBridgeCapture(sqlite: SQLiteInstance): void {
  sqlite.transaction(() => {
    sqlite.exec("INSERT OR IGNORE INTO bridge_clock(id) VALUES(1); INSERT OR IGNORE INTO bridge_state(id) VALUES(1)");
    for (const [table, def] of syncedTables) {
      const pkNew = portablePkSql(table, "NEW"), pkOld = portablePkSql(table, "OLD");
      // Primary keys are immutable. Re-adding a permanently deleted identity is never allowed.
      sqlite.exec(`CREATE TRIGGER IF NOT EXISTS ${quote(`bridge_${table}_identity`)} BEFORE UPDATE ON ${quote(table)}
        WHEN (SELECT enabled FROM bridge_config WHERE id=1)=1 AND (SELECT applying FROM bridge_state WHERE id=1)=0 AND (${pkNew} IS NOT ${pkOld})
        BEGIN SELECT RAISE(ABORT,'Bridge identities are immutable'); END;
        CREATE TRIGGER IF NOT EXISTS ${quote(`bridge_${table}_fence`)} BEFORE INSERT ON ${quote(table)}
        WHEN (SELECT enabled FROM bridge_config WHERE id=1)=1 AND EXISTS(SELECT 1 FROM bridge_tombstones WHERE table_name=${literal(table)} AND pk=${pkNew})
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
          INSERT INTO bridge_tombstones(table_name,pk) SELECT ${literal(table)},pk FROM (${aliases}) WHERE 1
            ON CONFLICT(table_name,pk) DO NOTHING;
          INSERT INTO bridge_row_clock(table_name,pk,register,physical_ms,counter,origin,values_json,portable)
            SELECT ${literal(table)},pk,'__delete__',${localClock},${localCounter},${backend},'{}',0 FROM (${aliases}) WHERE 1
            ON CONFLICT(table_name,pk,register) DO NOTHING;
          INSERT INTO bridge_outbox(table_name,pk,register,op,generation,stream,owner,run_id,changed_at)
            SELECT ${literal(table)},pk,'__delete__','delete',${generation},${stream},${ownerSql(table, "OLD")},${runIdSql(table, "OLD")},${localClock} FROM (${aliases}) WHERE 1
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
      sqlite.exec(`CREATE TRIGGER IF NOT EXISTS ${quote(`bridge_${table}_fixed`)} BEFORE DELETE ON ${quote(table)}
        WHEN (SELECT enabled FROM bridge_config WHERE id=1)=1 AND OLD.id IN (${ids.map(literal).join(",")})
        BEGIN SELECT RAISE(ABORT,'Fixed Bridge identities must be archived'); END;`);
    }
  })();
}
