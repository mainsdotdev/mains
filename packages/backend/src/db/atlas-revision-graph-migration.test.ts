import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("backfills revision parents and the selected pointer without changing content, ordinals or file refs", () => {
  const db = new Database(":memory:");
  const dir = resolve(__dirname, "migrations");
  const journal = JSON.parse(readFileSync(resolve(dir, "meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
  const apply = (tag: string) => {
    for (const sql of readFileSync(resolve(dir, `${tag}.sql`), "utf8").split("--> statement-breakpoint")) if (sql.trim()) db.exec(sql);
  };
  try {
    db.pragma("foreign_keys=ON");
    for (const { tag } of journal.entries) { if (tag === "0034_atlas_revision_graph") break; apply(tag); }
    db.exec(`INSERT INTO accounts(id) VALUES('default');
      INSERT INTO atlas_items(id,account_id,kind,title,version) VALUES('p','default','page','Chosen',4),('f','default','image','Image',0);
      INSERT INTO atlas_page_revisions(id,item_id,version,title,blocks_json,markdown,actor) VALUES
        ('r1','p',1,'First','[]','First body','user'),('r4','p',4,'Chosen','[]','Chosen body','agent'),('r7','p',7,'Later','[]','Later body','user');
      INSERT INTO atlas_page_file_refs(revision_id,file_id) VALUES('r1','f');`);
    db.transaction(() => apply("0034_atlas_revision_graph"))();
    expect(db.prepare("SELECT id,parent_revision_id,merged_revision_id FROM atlas_page_revisions ORDER BY version").all()).toEqual([
      { id: "r1", parent_revision_id: null, merged_revision_id: null },
      { id: "r4", parent_revision_id: "r1", merged_revision_id: null },
      { id: "r7", parent_revision_id: "r4", merged_revision_id: null },
    ]);
    expect(db.prepare("SELECT current_revision_id,version FROM atlas_items WHERE id='p'").get()).toEqual({ current_revision_id: "r4", version: 4 });
    expect(db.prepare("SELECT markdown FROM atlas_page_revisions WHERE id='r4'").get()).toEqual({ markdown: "Chosen body" });
    expect(db.prepare("SELECT * FROM atlas_page_file_refs").all()).toEqual([{ revision_id: "r1", file_id: "f" }]);
    expect(() => db.exec("DELETE FROM atlas_items WHERE id='f'")).toThrow(/FOREIGN KEY/);
    db.exec("DELETE FROM atlas_items WHERE id='p'");
    expect(db.prepare("SELECT * FROM atlas_page_revisions").all()).toEqual([]);
    db.exec("DELETE FROM atlas_items WHERE id='f'");
    expect(db.pragma("foreign_key_check")).toEqual([]);
  } finally { db.close(); }
});
