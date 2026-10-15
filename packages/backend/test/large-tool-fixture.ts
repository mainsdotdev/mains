import { readFile } from "node:fs/promises";
import type { SQLiteInstance } from "../src/db/types";

export type LargeToolRecord = Record<string, string | number | null>;
export type SeededLargeTool = LargeToolRecord & { run_id: string; provider_id: string; account_id: string };

/** Optional private input stays outside the repository; CI uses equivalent synthetic records. */
export async function largeToolFixture(): Promise<LargeToolRecord[]> {
  if (process.env.MAINS_BRIDGE_REAL_TOOL_RECORDS) {
    const records = JSON.parse(await readFile(process.env.MAINS_BRIDGE_REAL_TOOL_RECORDS, "utf8")) as LargeToolRecord[];
    if (!Array.isArray(records) || records.length !== 3 || records.some((record, index) => record.tool_name !== ["Read", "Read", "Grep"][index] || typeof record.output !== "string"))
      throw new Error("Expected three Read, Read and Grep fixture records");
    return records;
  }
  const document = JSON.stringify([{ type: "document", source: { type: "base64", media_type: "application/pdf", data: "Q".repeat(2_980_508) } }]);
  return [
    { tool_name: "Read", input: JSON.stringify({ file_path: "sample.pdf" }), output: document },
    { tool_name: "Read", input: JSON.stringify({ file_path: "sample.pdf" }), output: document },
    { tool_name: "Grep", input: JSON.stringify({ pattern: "search", path: "library" }), output: JSON.stringify("long matching text\n".repeat(70_000)) },
  ];
}

/** Only call while the host is stopped, or on a test-owned SQLite instance. */
export function seedLargeTools(sqlite: SQLiteInstance, backendId: string, records: LargeToolRecord[]): SeededLargeTool[] {
  const columns = new Set((sqlite.prepare("PRAGMA table_info(tool_calls)").all() as { name: string }[]).map((column) => column.name));
  const expected = records.map((record, index) => ({ ...record, run_id: String(record.run_id ?? `large-${index}`), provider_id: String(record.provider_id ?? "codex"), account_id: "default" }));
  sqlite.transaction(() => {
    for (const record of expected) {
      sqlite.prepare("INSERT OR IGNORE INTO providers(id,kind,display_name) VALUES(?,'agent_runtime','Test provider')").run(record.provider_id);
      sqlite.prepare("INSERT INTO runs(id,owner_backend_id,account_id,provider_id,status) VALUES(? ,?,'default',?,'succeeded')").run(record.run_id, backendId, record.provider_id);
      const keys = Object.keys(record).filter((column) => column !== "id");
      if (!keys.every((column) => columns.has(column))) throw new Error("Unknown tool fixture column");
      sqlite.prepare(`INSERT INTO tool_calls(${keys.map((column) => `"${column}"`).join(",")}) VALUES(${keys.map(() => "?").join(",")})`).run(...keys.map((column) => (record as LargeToolRecord)[column]));
    }
  })();
  return expected;
}
