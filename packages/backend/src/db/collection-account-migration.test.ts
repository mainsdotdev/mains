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

describe("Collection account-scope migration", () => {
  let sqlite: Database.Database | null = null;

  afterEach(() => {
    sqlite?.close();
    sqlite = null;
  });

  it("preserves Work/Chat Collections and their Sources while removing mode", () => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const journal = JSON.parse(
      fs.readFileSync(path.join(migrationsDirectory, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ tag: string }> };
    for (const { tag } of journal.entries) {
      if (tag === "0013_familiar_starjammers") break;
      apply(sqlite, tag);
    }

    sqlite.exec("INSERT INTO accounts(id) VALUES ('account-1')");
    sqlite.exec(`
      INSERT INTO collections(id, account_id, mode, name)
      VALUES
        ('work-collection', 'account-1', 'work', 'Mains'),
        ('chat-collection', 'account-1', 'chat', 'Research')
    `);
    sqlite.exec(`
      INSERT INTO collection_sources(
        id, collection_id, kind, name, mime_type, byte_size, content_hash, storage_key
      ) VALUES (
        'source-1', 'work-collection', 'text', 'Brief', 'text/plain', 5,
        'hash-1', 'collections/work-collection/sources/source-1/content'
      )
    `);

    apply(sqlite, "0013_familiar_starjammers");

    const columns = sqlite
      .prepare("PRAGMA table_info(collections)")
      .all() as Array<{ name: string }>;
    const collections = sqlite
      .prepare("SELECT id, name FROM collections ORDER BY id")
      .all();
    const source = sqlite
      .prepare("SELECT collection_id AS collectionId FROM collection_sources WHERE id = 'source-1'")
      .get();

    expect(columns.some((column) => column.name === "mode")).toBe(false);
    expect(collections).toEqual([
      { id: "chat-collection", name: "Research" },
      { id: "work-collection", name: "Mains" },
    ]);
    expect(source).toEqual({ collectionId: "work-collection" });
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  });
});
