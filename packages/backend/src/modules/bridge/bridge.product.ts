import { SEEDED_SPACE_IDS } from "@mains/contracts/spaces";
import type { BridgeProjectScope } from "@mains/contracts/bridge";
import type { SQLiteInstance } from "../../db/types";
import { installBridgeCapture, portablePkSql, scopeSql } from "./bridge.capture";
import { quote, syncedTables } from "./bridge.sql";

export function resetBridgeBackfill(sqlite: SQLiteInstance): void {
  sqlite.exec("UPDATE bridge_config SET backfill_done=0,backfill_table=NULL,backfill_pk=NULL WHERE id=1");
}

/** Freeze the first-sign-in choice now, including while another device approves us. */
export function beginBridgeEnrollment(sqlite: SQLiteInstance, backendId: string, includeExisting: boolean): void {
  sqlite.transaction(() => {
    sqlite.prepare(`INSERT INTO bridge_config(id,backend_id,enabled,tracking_enabled,atlas_enabled) VALUES(1,?,0,1,1)
      ON CONFLICT(id) DO UPDATE SET enabled=0,tracking_enabled=1`).run(backendId);
    sqlite.exec("UPDATE bridge_config SET dev_disabled=1 WHERE id=1");
    installBridgeCapture(sqlite);
    sqlite.exec("DELETE FROM bridge_exclusions WHERE reason='enrollment'");
    if (!includeExisting) {
      // Previously public rows remain public on re-entry; this choice concerns local history.
      sqlite.prepare(`INSERT OR IGNORE INTO bridge_exclusions(table_name,pk,reason)
        SELECT 'runs',id,'enrollment' FROM runs WHERE owner_backend_id=? AND NOT EXISTS
        (SELECT 1 FROM bridge_row_clock c WHERE c.table_name='runs' AND c.pk=runs.id AND c.synced_seq IS NOT NULL)`).run(backendId);
      sqlite.exec(`INSERT OR IGNORE INTO bridge_exclusions(table_name,pk,reason)
        SELECT 'atlas_items',id,'enrollment' FROM atlas_items WHERE NOT EXISTS
        (SELECT 1 FROM bridge_row_clock c WHERE c.table_name='atlas_items' AND c.pk=atlas_items.id AND c.synced_seq IS NOT NULL)`);
    }
  })();
}

export function bindBridgeAccount(sqlite: SQLiteInstance, fingerprint: string, hubOrigin: string, accountId: string): boolean {
  return sqlite.transaction(() => {
    const binding = sqlite.prepare("SELECT account_fingerprint,account_id,hub_origin FROM bridge_config WHERE id=1").get() as
      { account_fingerprint: string | null; account_id: string | null; hub_origin: string | null };
    const same = binding.account_fingerprint === fingerprint && (!binding.account_id || binding.account_id === accountId) && (!binding.hub_origin || binding.hub_origin === hubOrigin);
    if (!same) {
      // Rows stay local; cloud provenance is meaningful only within the original account.
      if (binding.account_fingerprint || binding.account_id) {
        for (const table of ["bridge_publications", "bridge_outbox", "bridge_row_clock", "bridge_cursors", "bridge_parked", "bridge_pending_links", "bridge_id_map", "bridge_aliases", "bridge_tombstones", "bridge_peers", "bridge_atlas_recoveries"])
          sqlite.exec(`DELETE FROM ${table}`);
      }
      sqlite.exec("UPDATE bridge_config SET enrollment_staging=1 WHERE id=1");
    }
    sqlite.prepare("UPDATE bridge_config SET account_fingerprint=?,account_id=?,hub_origin=? WHERE id=1").run(fingerprint, accountId, hubOrigin);
    sqlite.exec("UPDATE bridge_exclusions SET reason='history' WHERE reason='enrollment'");
    resetBridgeBackfill(sqlite);
    return !same;
  })();
}

export function bridgeProjectScopes(sqlite: SQLiteInstance, backendId: string): BridgeProjectScope[] {
  const rows = sqlite.prepare(`SELECT p.id,p.name,EXISTS(SELECT 1 FROM bridge_exclusions e WHERE e.table_name='projects' AND e.pk=p.id) localOnly,
    (SELECT count(*) FROM workspaces w WHERE w.project_id=p.id) workspaces,
    (SELECT count(*) FROM runs r JOIN workspaces w ON w.id=r.workspace_id WHERE w.project_id=p.id) runs
    FROM projects p WHERE p.owner_backend_id=? ORDER BY p.name,p.id`).all(backendId) as (Omit<BridgeProjectScope, "localOnly"> & { localOnly: number })[];
  return rows.map((row) => ({ ...row, localOnly: !!row.localOnly }));
}

export function setBridgeProjectScope(sqlite: SQLiteInstance, backendId: string, projectId: string, localOnly: boolean): void {
  sqlite.transaction(() => {
    const project = sqlite.prepare("SELECT owner_backend_id FROM projects WHERE id=?").get(projectId) as { owner_backend_id: string } | undefined;
    if (!project || project.owner_backend_id !== backendId) throw new Error("Only this backend's projects can change sync scope");
    if (localOnly) sqlite.prepare("INSERT OR REPLACE INTO bridge_exclusions(table_name,pk,reason) VALUES('projects',?,'manual')").run(projectId);
    else sqlite.prepare("DELETE FROM bridge_exclusions WHERE table_name='projects' AND pk=?").run(projectId);
    // Remove pre-existing entries as well as fencing future SQL writes. Keep dirty clocks.
    for (const [table] of syncedTables) {
      sqlite.exec(`DELETE FROM bridge_outbox WHERE table_name='${table}' AND pk IN
        (SELECT ${portablePkSql(table, "r")} FROM ${quote(table)} r WHERE NOT (${scopeSql(table, "r")}))`);
    }
    sqlite.exec(`DELETE FROM bridge_outbox WHERE run_id IN(SELECT r.id FROM runs r JOIN workspaces w ON w.id=r.workspace_id
      JOIN bridge_exclusions e ON e.table_name='projects' AND e.pk=w.project_id)`);
    sqlite.prepare(`DELETE FROM bridge_outbox WHERE EXISTS(SELECT 1 FROM bridge_tombstones t JOIN bridge_exclusions e ON e.table_name='projects' AND e.pk=t.project_id
      WHERE t.table_name=bridge_outbox.table_name AND t.pk=bridge_outbox.pk)`).run();
    resetBridgeBackfill(sqlite);
  })();
}

export function includeBridgeLocalHistory(sqlite: SQLiteInstance): void {
  sqlite.transaction(() => {
    sqlite.exec("DELETE FROM bridge_exclusions WHERE reason IN ('history','enrollment')");
    resetBridgeBackfill(sqlite);
  })();
}

/** All deletes here are local cleanup, never new sync tombstones. Safe to repeat after a crash. */
export function removeBridgeReplicas(sqlite: SQLiteInstance, backendId: string, removeAccountObjects = false): void {
  sqlite.transaction(() => {
    sqlite.exec("UPDATE bridge_config SET enabled=0 WHERE id=1; UPDATE bridge_state SET applying=1 WHERE id=1");
    sqlite.pragma("defer_foreign_keys=ON");
    const owned = syncedTables.filter(([, def]) => def.ownerRoot).map(([table]) => `'${table}'`).join(",");
    // Clocks contain plaintext row images, so removing SQL roots alone is insufficient.
    sqlite.exec(`CREATE TEMP TABLE IF NOT EXISTS bridge_cleanup(table_name TEXT,pk TEXT,PRIMARY KEY(table_name,pk)); DELETE FROM bridge_cleanup;`);
    sqlite.prepare(`INSERT OR IGNORE INTO bridge_cleanup SELECT table_name,pk FROM bridge_row_clock WHERE table_name IN (${owned}) AND origin<>?`).run(backendId);
    for (const table of ["runs", "automations", "pulses", "workspaces", "projects"]) sqlite.prepare(`DELETE FROM ${table} WHERE owner_backend_id<>?`).run(backendId);
    if (removeAccountObjects) {
      const synced = (table: string, id: string) => `EXISTS(SELECT 1 FROM bridge_row_clock c WHERE c.table_name='${table}' AND c.pk=${id} AND c.synced_seq IS NOT NULL)`;
      const pending = (table: string, id: string) => `(NOT (${synced(table, id)}) OR EXISTS(SELECT 1 FROM bridge_row_clock c WHERE c.table_name='${table}' AND c.pk=${id} AND c.dirty=1))`;
      sqlite.exec(`CREATE TEMP TABLE IF NOT EXISTS bridge_keep(table_name TEXT,pk TEXT,PRIMARY KEY(table_name,pk)); DELETE FROM bridge_keep;
        INSERT OR IGNORE INTO bridge_keep SELECT 'atlas_items',a.id FROM atlas_items a WHERE ${pending("atlas_items", "a.id")}
          OR EXISTS(SELECT 1 FROM atlas_page_revisions v WHERE v.item_id=a.id AND ${pending("atlas_page_revisions", "v.id")});
        INSERT OR IGNORE INTO bridge_keep SELECT 'atlas_items',f.file_id FROM atlas_page_file_refs f JOIN atlas_page_revisions v ON v.id=f.revision_id
          JOIN bridge_keep k ON k.table_name='atlas_items' AND k.pk=v.item_id;
        INSERT OR IGNORE INTO bridge_keep SELECT 'collections',c.id FROM collections c WHERE ${pending("collections", "c.id")}
          OR EXISTS(SELECT 1 FROM collection_sources s WHERE s.collection_id=c.id AND ${pending("collection_sources", "s.id")})
          OR EXISTS(SELECT 1 FROM atlas_items a JOIN bridge_keep k ON k.table_name='atlas_items' AND k.pk=a.id WHERE a.collection_id=c.id);
        INSERT OR IGNORE INTO bridge_keep SELECT 'spaces',s.id FROM spaces s WHERE ${pending("spaces", "s.id")};
        INSERT OR IGNORE INTO bridge_cleanup SELECT 'atlas_page_revisions',v.id FROM atlas_page_revisions v WHERE NOT EXISTS(SELECT 1 FROM bridge_keep k WHERE k.table_name='atlas_items' AND k.pk=v.item_id);
        INSERT OR IGNORE INTO bridge_cleanup SELECT 'collection_sources',s.id FROM collection_sources s WHERE NOT EXISTS(SELECT 1 FROM bridge_keep k WHERE k.table_name='collections' AND k.pk=s.collection_id);`);
      for (const table of ["atlas_items", "collections", "spaces"]) {
        const seeds = table === "spaces" ? `AND id NOT IN (${SEEDED_SPACE_IDS.map((id) => `'${id}'`).join(",")})` : "";
        sqlite.exec(`INSERT OR IGNORE INTO bridge_cleanup SELECT '${table}',id FROM ${table} WHERE NOT EXISTS(SELECT 1 FROM bridge_keep k WHERE k.table_name='${table}' AND k.pk=${table}.id) ${seeds};
          ${table === "atlas_items" ? "DELETE FROM atlas_items WHERE kind='page' AND id IN(SELECT pk FROM bridge_cleanup WHERE table_name='atlas_items');" : ""}
          DELETE FROM ${table} WHERE id IN(SELECT pk FROM bridge_cleanup WHERE table_name='${table}');`);
      }
      sqlite.exec("DROP TABLE bridge_keep");
    }
    for (const table of ["bridge_row_clock", "bridge_outbox", "bridge_pending_links", "bridge_tombstones"])
      sqlite.exec(`DELETE FROM ${table} WHERE EXISTS(SELECT 1 FROM bridge_cleanup c WHERE c.table_name=${table}.table_name AND c.pk=${table}.pk)`);
    sqlite.exec("DELETE FROM bridge_aliases WHERE EXISTS(SELECT 1 FROM bridge_cleanup c WHERE c.table_name=bridge_aliases.table_name AND (c.pk=bridge_aliases.alias_pk OR c.pk=bridge_aliases.canonical_pk))");
    sqlite.prepare("DELETE FROM bridge_id_map WHERE owner_backend_id<>?").run(backendId);
    sqlite.exec("DELETE FROM bridge_publications; DELETE FROM bridge_peers; DELETE FROM bridge_cursors; DELETE FROM bridge_parked; DROP TABLE bridge_cleanup; UPDATE bridge_state SET applying=0 WHERE id=1");
  })();
}
