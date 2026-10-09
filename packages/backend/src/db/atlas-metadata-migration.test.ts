import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Atlas metadata migration", () => {
  it("preserves existing Pages, files and revision references inside the migration transaction", () => {
    const sqlite = new Database(":memory:");
    try {
      sqlite.pragma("foreign_keys = ON");
      const directory = path.resolve(__dirname, "migrations");
      const journal = JSON.parse(fs.readFileSync(path.join(directory, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
      const apply = (tag: string) => {
        for (const statement of fs.readFileSync(path.join(directory, `${tag}.sql`), "utf8").split("--> statement-breakpoint"))
          if (statement.trim()) sqlite.exec(statement);
      };
      for (const { tag } of journal.entries) {
        if (tag === "0029_atlas_item_metadata") break;
        apply(tag);
      }
      sqlite.exec(`
        INSERT INTO accounts (id) VALUES ('default');
        INSERT INTO atlas_items (id, account_id, kind, title, version) VALUES
          ('page', 'default', 'page', 'Notes', 1), ('file', 'default', 'image', 'Photo', 0);
        INSERT INTO atlas_page_revisions (id, item_id, version, title, blocks_json, markdown, actor)
          VALUES ('revision', 'page', 1, 'Notes', '[]', 'Original content', 'user');
        INSERT INTO atlas_page_file_refs (revision_id, file_id) VALUES ('revision', 'file');
      `);
      sqlite.transaction(() => apply("0029_atlas_item_metadata"))();
      expect(sqlite.prepare("SELECT id, metadata FROM atlas_items ORDER BY id").all()).toEqual([
        { id: "file", metadata: null }, { id: "page", metadata: null },
      ]);
      expect(sqlite.prepare("SELECT markdown FROM atlas_page_revisions").get()).toEqual({ markdown: "Original content" });
      expect(sqlite.prepare("SELECT * FROM atlas_page_file_refs").all()).toEqual([{ revision_id: "revision", file_id: "file" }]);
      expect(sqlite.pragma("foreign_key_check")).toEqual([]);
      expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(() => sqlite.exec("UPDATE atlas_items SET metadata = 'invalid json' WHERE id = 'page'")).toThrow(/CHECK/);
      expect(() => sqlite.exec("DELETE FROM atlas_items WHERE id = 'file'")).toThrow(/FOREIGN KEY/);
    } finally { sqlite.close(); }
  });
});
