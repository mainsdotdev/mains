import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Bridge ownership migration", () => {
  it.each(["backend-a", null])("preserves existing data and backfills one stable identity (%s)", (backendId) => {
    const sqlite = new Database(":memory:");
    try {
      sqlite.pragma("foreign_keys = ON");
      const directory = path.join(__dirname, "migrations");
      const journal = JSON.parse(fs.readFileSync(path.join(directory, "meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
      const apply = (tag: string) => { for (const statement of fs.readFileSync(path.join(directory, `${tag}.sql`), "utf8").split("--> statement-breakpoint")) if (statement.trim()) sqlite.exec(statement); };
      for (const { tag } of journal.entries) { if (tag === "0030_bridge_ownership") break; apply(tag); }
      sqlite.exec(`INSERT INTO accounts(id) VALUES ('default');
        INSERT INTO app_settings(id, account_id) VALUES ('default', 'default');
        INSERT INTO providers(id, kind, display_name) VALUES ('codex', 'agent_runtime', 'Codex');
        INSERT INTO projects(id, account_id, name, root_path) VALUES ('p', 'default', 'Repo', '/repo');
        INSERT INTO workspaces(id, account_id, project_id, name, root_path) VALUES ('w', 'default', 'p', 'Repo', '/repo');
        INSERT INTO runs(id, account_id, workspace_id, provider_id, goal) VALUES ('r', 'default', 'w', 'codex', 'Keep my history');`);
      sqlite.prepare("UPDATE app_settings SET backend_id = ?").run(backendId);
      sqlite.transaction(() => apply("0030_bridge_ownership"))();
      const identity = (sqlite.prepare("SELECT backend_id AS id FROM app_settings").get() as { id: string }).id;
      expect(identity).toBeTruthy();
      if (backendId) expect(identity).toBe(backendId);
      for (const table of ["projects", "workspaces", "runs"]) expect(sqlite.prepare(`SELECT owner_backend_id FROM ${table}`).get()).toEqual({ owner_backend_id: identity });
      expect(sqlite.prepare("SELECT goal FROM runs WHERE id = 'r'").get()).toEqual({ goal: "Keep my history" });
      sqlite.exec(`INSERT INTO projects(id, account_id, owner_backend_id, name, root_path) VALUES ('remote-p', 'default', 'backend-b', 'Repo', '/repo');
        INSERT INTO workspaces(id, account_id, owner_backend_id, project_id, name, root_path) VALUES ('remote-w', 'default', 'backend-b', 'remote-p', 'Repo', '/repo');
        INSERT INTO runs(id, account_id, provider_id) VALUES ('sql-writer', 'default', 'codex');`);
      expect(sqlite.prepare("SELECT owner_backend_id FROM runs WHERE id = 'sql-writer'").get()).toEqual({ owner_backend_id: identity });
      expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally { sqlite.close(); }
  });
});
