import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("upgrades existing Bridge databases without changing user data or register conflict clocks", () => {
  const sqlite = new Database(":memory:");
  try {
    const directory = join(__dirname, "migrations");
    const journal = JSON.parse(readFileSync(join(directory, "meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
    const apply = (tag: string) => { for (const part of readFileSync(join(directory, `${tag}.sql`), "utf8").split("--> statement-breakpoint")) if (part.trim()) sqlite.exec(part); };
    for (const { tag } of journal.entries) { if (tag === "0038_bridge_blob_roots") break; apply(tag); }
    sqlite.exec(`INSERT INTO accounts(id,display_name) VALUES('default','Keep my data');
      INSERT INTO app_settings(id,account_id,backend_id) VALUES('default','default','A');
      INSERT INTO bridge_config(id,backend_id,backfill_done,backfill_table,backfill_pk) VALUES(1,'A',1,'accounts','default');
      INSERT INTO bridge_row_clock(table_name,pk,register,physical_ms,counter,origin,synced_seq,values_json,blob_refs_json,dirty)
        VALUES('accounts','default','row',123,4,'A',7,'{}','[]',0);`);
    const before = sqlite.prepare("SELECT * FROM bridge_row_clock").all();
    apply("0038_bridge_blob_roots");
    expect(sqlite.prepare("SELECT display_name FROM accounts").get()).toEqual({ display_name: "Keep my data" });
    expect(sqlite.prepare("SELECT * FROM bridge_row_clock").all()).toEqual(before);
    expect(sqlite.prepare("SELECT backfill_done,backfill_table,backfill_pk,blob_roots_version FROM bridge_config").get())
      .toEqual({ backfill_done: 0, backfill_table: null, backfill_pk: null, blob_roots_version: 0 });
  } finally { sqlite.close(); }
});
