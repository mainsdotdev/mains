import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = path.resolve(__dirname, "migrations");

function apply(sqlite: Database.Database, tag: string): void {
  const statements = fs
    .readFileSync(path.join(migrationsDirectory, `${tag}.sql`), "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) sqlite.exec(statement);
}

describe("sidebar organization migration", () => {
  it("keeps the previous alphabetic project and recent workspace order", () => {
    const sqlite = new Database(":memory:");
    try {
      sqlite.pragma("foreign_keys = ON");
      const journal = JSON.parse(
        fs.readFileSync(path.join(migrationsDirectory, "meta", "_journal.json"), "utf8"),
      ) as { entries: Array<{ tag: string }> };
      for (const { tag } of journal.entries) {
        if (tag === "0026_lucky_swordsman") break;
        apply(sqlite, tag);
      }

      sqlite.exec("INSERT INTO accounts(id) VALUES ('default')");
      sqlite.exec(`
        INSERT INTO projects(id, account_id, name, root_path) VALUES
          ('z', 'default', 'zebra', '/tmp/z'),
          ('a', 'default', 'alpha', '/tmp/a');
        INSERT INTO workspaces(id, account_id, project_id, name, root_path, updated_at) VALUES
          ('old', 'default', 'a', 'Old', '/tmp/old', 100),
          ('new', 'default', 'z', 'New', '/tmp/new', 200);
      `);

      apply(sqlite, "0026_lucky_swordsman");

      const projects = sqlite.prepare(
        "SELECT id FROM projects ORDER BY sort_order",
      ).all() as Array<{ id: string }>;
      const workspaces = sqlite.prepare(
        "SELECT id, pinned_at AS pinnedAt FROM workspaces ORDER BY sort_order",
      ).all() as Array<{ id: string; pinnedAt: number | null }>;
      expect(projects.map(({ id }) => id)).toEqual(["a", "z"]);
      expect(workspaces).toEqual([
        { id: "new", pinnedAt: null },
        { id: "old", pinnedAt: null },
      ]);
    } finally {
      sqlite.close();
    }
  });
});
