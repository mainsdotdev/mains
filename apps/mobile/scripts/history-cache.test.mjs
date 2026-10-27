import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { migrateDatabase } from "../src/db/migrations.ts";
import { cachedHistoryQueries } from "../src/db/history-queries.ts";

test("an old phone cache cannot materialize full large bodies before the first sync", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    migrateDatabase({
      execSync: (sql) => sqlite.exec(sql),
      getFirstSync: (sql) => sqlite.prepare(sql).get(),
      getAllSync: (sql) => sqlite.prepare(sql).all(),
      withTransactionSync(callback) {
        sqlite.exec("BEGIN");
        try { callback(); sqlite.exec("COMMIT"); } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
      },
    });
    const huge = JSON.stringify({ stdout: "x".repeat(8 * 1024 * 1024) });
    const call = sqlite.prepare("INSERT INTO tool_calls (backend_id,run_id,id,tool_name,status,input_json,output_json,metadata_json,created_at,updated_at) VALUES ('b','r',?,'Bash','done',?,?,?, ?,?)");
    for (let id = 0; id < 500; id++) call.run(id, "{}", "{}", null, id, id);
    call.run(501, huge, huge, huge, 501, 501);
    sqlite.prepare("INSERT INTO run_artifacts (backend_id,run_id,id,kind,content,metadata_json,created_at) VALUES ('b','r',1,'report',?,NULL,0)").run("x".repeat(8 * 1024 * 1024));
    sqlite.prepare("INSERT INTO run_turns (backend_id,run_id,turn_index,status,prompt_content,response_content,metadata_json,changes_json) VALUES ('b','r',0,'completed',?,?,?,?)").run(huge, huge, huge, huge);
    const db = drizzle(async (sql, params) => {
      const statement = sqlite.prepare(sql);
      statement.setReturnArrays(true);
      return { rows: statement.all(...params) };
    });
    const queries = cachedHistoryQueries(db, "b", "r");
    const calls = await queries.calls;
    const artifacts = await queries.artifacts;
    const turns = await queries.turns;
    assert.equal(calls.length, 200);
    assert.equal(JSON.parse(calls[0].outputJson).type, "mains/deferred-tool-output");
    assert.equal(calls[0].metadataJson, null);
    assert.equal(artifacts[0].content.length, 8192);
    assert.equal(turns[0].promptContent, null);
    assert.equal(turns[0].responseContent, null);
    assert.equal(turns[0].metadataJson, null);
    assert.equal(turns[0].changesJson, null);
    assert.equal(JSON.parse(artifacts[0].metadataJson).mobileContentDeferred.chars, 8 * 1024 * 1024);
    assert.ok(Buffer.byteLength(JSON.stringify({ calls, artifacts })) < 1024 * 1024);
    assert.equal(sqlite.prepare("SELECT length(output_json) AS n FROM tool_calls WHERE id=501").get().n, huge.length);
  } finally { sqlite.close(); }
});
