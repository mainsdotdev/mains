import type { SQLiteInstance } from "../../db/types";
import { BRIDGE_TABLES, type BridgeTableDefinition } from "./bridge.records";

export type SqlRow = Record<string, string | number | null>;
export const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
export const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
export const syncedTables = Object.entries(BRIDGE_TABLES).filter(([, def]) => def.class !== "local");
export const isAtlas = (table: string) => table.startsWith("atlas_");
export const clockColumns = "table_name, pk, register, physical_ms, counter, origin, synced_seq, values_json, refs_json, blob_refs_json, portable";
export interface RowClock {
  table_name: string; pk: string; register: string; physical_ms: number; counter: number;
  origin: string; synced_seq: number | null; values_json: string; refs_json: string; portable: number;
  blob_refs_json: string | null;
}
export { compareClock, headerClock } from "./bridge.clock";
export const clockOf = (clock: RowClock) => ({ physicalMs: clock.physical_ms, counter: clock.counter, origin: clock.origin });
export function definition(table: string): BridgeTableDefinition {
  const def = BRIDGE_TABLES[table];
  if (!def || def.class === "local") throw new Error(`Table does not sync: ${table}`);
  return def;
}
export function rowWhere(def: BridgeTableDefinition, pk: string): { sql: string; args: (string | number)[] } {
  const args: (string | number)[] = def.idKind === "composite" ? JSON.parse(pk) : [pk];
  if (args.length !== def.primaryKey.length || args.some((value) => typeof value !== "string" && typeof value !== "number"))
    throw new Error("Invalid Bridge primary key");
  return { sql: def.primaryKey.map((col) => `${quote(col)} = ?`).join(" AND "), args };
}
export function getClock(sqlite: SQLiteInstance, table: string, pk: string, register: string): RowClock | undefined {
  return sqlite.prepare("SELECT * FROM bridge_row_clock WHERE table_name=? AND pk=? AND register=?").get(table, pk, register) as RowClock | undefined;
}
export function canonicalPk(sqlite: SQLiteInstance, table: string, pk: string): string {
  return (sqlite.prepare("SELECT canonical_pk FROM bridge_aliases WHERE table_name=? AND alias_pk=?").get(table, pk) as { canonical_pk: string } | undefined)?.canonical_pk ?? pk;
}
export function aliasSet(sqlite: SQLiteInstance, table: string, pk: string): string[] {
  const canonical = canonicalPk(sqlite, table, pk);
  return [...new Set([canonical, pk, ...(sqlite.prepare("SELECT alias_pk FROM bridge_aliases WHERE table_name=? AND canonical_pk=?").all(table, canonical) as { alias_pk: string }[]).map((row) => row.alias_pk)])];
}
export function deleted(sqlite: SQLiteInstance, table: string, pk: string): boolean {
  return aliasSet(sqlite, table, pk).some((id) => !!sqlite.prepare("SELECT 1 FROM bridge_tombstones WHERE table_name=? AND pk=?").get(table, id));
}
