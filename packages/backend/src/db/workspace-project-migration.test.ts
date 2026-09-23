import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const migrationsDirectory = path.resolve(__dirname, "migrations");

function statements(tag: string): string[] {
  return fs
    .readFileSync(path.join(migrationsDirectory, `${tag}.sql`), "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function apply(sqlite: Database.Database, tag: string): void {
  for (const statement of statements(tag)) sqlite.exec(statement);
}

describe("Workspace → Project invariant migration", () => {
  let sqlite: Database.Database | null = null;

  afterEach(() => {
    sqlite?.close();
    sqlite = null;
  });

  it("backfills legacy orphan Workspaces before enforcing NOT NULL + RESTRICT", () => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const journal = JSON.parse(
      fs.readFileSync(path.join(migrationsDirectory, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ tag: string }> };
    for (const { tag } of journal.entries) {
      if (tag === "0012_motionless_menace") break;
      apply(sqlite, tag);
    }

    sqlite.exec("INSERT INTO accounts(id) VALUES ('account-1')");
    sqlite.exec(`
      INSERT INTO workspaces(id, account_id, project_id, name, root_path, base_branch)
      VALUES ('workspace-1', 'account-1', NULL, 'Legacy repo', '/legacy/repo', 'main')
    `);

    apply(sqlite, "0012_motionless_menace");

    const workspace = sqlite
      .prepare("SELECT project_id AS projectId FROM workspaces WHERE id = 'workspace-1'")
      .get() as { projectId: string };
    const project = sqlite
      .prepare("SELECT name, root_path AS rootPath FROM projects WHERE id = ?")
      .get(workspace.projectId) as { name: string; rootPath: string };

    expect(workspace.projectId).toMatch(/^legacy-/);
    expect(project).toEqual({ name: "Legacy repo", rootPath: "/legacy/repo" });
    expect(() =>
      sqlite!.exec(`
        INSERT INTO workspaces(id, account_id, project_id, name, root_path)
        VALUES ('workspace-2', 'account-1', NULL, 'Invalid', '/invalid')
      `),
    ).toThrow(/NOT NULL/);
    expect(() =>
      sqlite!.prepare("DELETE FROM projects WHERE id = ?").run(workspace.projectId),
    ).toThrow(/FOREIGN KEY/);
  });
});
