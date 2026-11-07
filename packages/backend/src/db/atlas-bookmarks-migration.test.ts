import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as schema from "./schema";
import { migrateDatabase } from "./migrate";

describe("Atlas bookmark migration", () => {
  it("preserves Pages, current revisions, embedded files, favorites and triggers through a real Drizzle transaction", () => {
    const sqlite = new Database(":memory:");
    try {
      sqlite.pragma("foreign_keys=ON");
      const folder = path.resolve(__dirname, "migrations");
      const journal = JSON.parse(fs.readFileSync(path.join(folder, "meta/_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] };
      const previous = journal.entries.filter(({ tag }) => tag !== "0042_atlas_bookmarks");
      for (const { tag } of previous) for (const sql of fs.readFileSync(path.join(folder, `${tag}.sql`), "utf8").split("--> statement-breakpoint")) if (sql.trim()) sqlite.exec(sql);
      sqlite.exec(`INSERT INTO accounts(id) VALUES ('default');
        INSERT INTO atlas_items(id,account_id,kind,title,version,is_favorite,metadata) VALUES
          ('page','default','page','Notes',1,1,'{"icon":"emoji:📚"}'), ('image','default','image','Cover',0,0,NULL);
        INSERT INTO atlas_page_revisions(id,item_id,version,title,blocks_json,markdown,actor) VALUES ('rev','page',1,'Notes','[]','Keep me','user');
        UPDATE atlas_items SET current_revision_id='rev' WHERE id='page';
        INSERT INTO atlas_page_file_refs(revision_id,file_id) VALUES ('rev','image');
        CREATE TRIGGER atlas_test_reference AFTER UPDATE ON atlas_page_revisions BEGIN SELECT title FROM atlas_items WHERE id=NEW.item_id; END;
        CREATE TABLE __drizzle_migrations(id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at numeric);`);
      sqlite.prepare("INSERT INTO __drizzle_migrations(hash,created_at) VALUES ('previous',?)").run(previous.at(-1)!.when);
      migrateDatabase(drizzle(sqlite, { schema }), sqlite, folder);
      expect(sqlite.prepare("SELECT title,version,is_favorite,current_revision_id,metadata,url FROM atlas_items WHERE id='page'").get())
        .toEqual({ title: "Notes", version: 1, is_favorite: 1, current_revision_id: "rev", metadata: '{"icon":"emoji:📚"}', url: null });
      expect(sqlite.prepare("SELECT markdown FROM atlas_page_revisions").get()).toEqual({ markdown: "Keep me" });
      expect(sqlite.prepare("SELECT * FROM atlas_page_file_refs").all()).toEqual([{ revision_id: "rev", file_id: "image" }]);
      expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='atlas_test_reference'").get()).toBeTruthy();
      sqlite.exec("UPDATE atlas_page_revisions SET title='Still works' WHERE id='rev'");
      sqlite.exec("INSERT INTO atlas_items(id,account_id,kind,title,url) VALUES ('bookmark','default','bookmark','Link','https://example.com')");
      expect(sqlite.pragma("foreign_key_check")).toEqual([]);
      expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(() => sqlite.exec("DELETE FROM atlas_items WHERE id='image'")).toThrow(/FOREIGN KEY/);
    } finally { sqlite.close(); }
  });
});
