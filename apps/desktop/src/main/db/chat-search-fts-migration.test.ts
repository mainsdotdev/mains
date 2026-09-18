import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const migrationsDirectory = path.resolve(__dirname, "migrations");
const migrationTag = "0021_chat_search_fts";

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

function matchingIds(sqlite: Database.Database, query: string): number[] {
  return (
    sqlite
      .prepare(
        "SELECT rowid AS id FROM run_artifacts_fts WHERE run_artifacts_fts MATCH ? ORDER BY rowid",
      )
      .all(query) as Array<{ id: number }>
  ).map((row) => row.id);
}

describe("Chat search FTS migration", () => {
  let sqlite: Database.Database | null = null;

  afterEach(() => {
    sqlite?.close();
    sqlite = null;
  });

  it("backfills visible conversation text and keeps the index in sync", () => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const journal = JSON.parse(
      fs.readFileSync(path.join(migrationsDirectory, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ tag: string }> };
    for (const { tag } of journal.entries) {
      if (tag === migrationTag) break;
      apply(sqlite, tag);
    }

    sqlite.exec(`
      INSERT INTO accounts(id) VALUES ('account-1');
      INSERT INTO providers(id, kind, display_name)
      VALUES ('codex', 'agent_runtime', 'Codex');
      INSERT INTO runs(id, account_id, provider_id, title)
      VALUES ('run-1', 'account-1', 'codex', 'Physics');
      INSERT INTO run_artifacts(run_id, kind, content, metadata) VALUES
        ('run-1', 'report', 'Reverse the spin to reverse precession.', '{}'),
        ('run-1', 'log', 'Precession hidden in a diagnostic log.', '{}'),
        ('run-1', 'file', 'Precession hidden in source output.', '{}');
    `);

    apply(sqlite, migrationTag);

    expect(matchingIds(sqlite, '"precess"*')).toEqual([1]);

    const inserted = Number(
      sqlite
        .prepare(
          `INSERT INTO run_artifacts(run_id, kind, content, metadata)
           VALUES ('run-1', 'user-prompt', 'Increase gyroscopic torque.', '{}')`,
        )
        .run().lastInsertRowid,
    );
    expect(matchingIds(sqlite, '"gyros"*')).toEqual([inserted]);

    sqlite
      .prepare("UPDATE run_artifacts SET kind = 'log' WHERE id = ?")
      .run(inserted);
    expect(matchingIds(sqlite, '"gyros"*')).toEqual([]);

    sqlite
      .prepare("UPDATE run_artifacts SET kind = 'report' WHERE id = ?")
      .run(inserted);
    expect(matchingIds(sqlite, '"gyros"*')).toEqual([inserted]);

    sqlite.prepare("DELETE FROM run_artifacts WHERE id = ?").run(inserted);
    expect(matchingIds(sqlite, '"gyros"*')).toEqual([]);
  });
});
