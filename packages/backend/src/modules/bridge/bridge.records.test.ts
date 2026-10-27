import { describe, expect, it } from "vitest";
import { auditBridgeSchema, BRIDGE_TABLES, bridgePortablePk } from "./bridge.records";

describe("Bridge schema registry", () => {
  it("classifies every table, synced column, foreign key and unique index", () => {
    expect(() => auditBridgeSchema()).not.toThrow();
  });

  it("refuses to silently ship an unclassified column or foreign key", () => {
    const runs = BRIDGE_TABLES.runs;
    expect(() => auditBridgeSchema(undefined, { ...BRIDGE_TABLES, runs: { ...runs, registers: { row: runs.registers.row.filter((column) => column !== "goal") } } })).toThrow(/columns/);
    const { workspace_id: _workspace, ...references } = runs.references;
    expect(() => auditBridgeSchema(undefined, { ...BRIDGE_TABLES, runs: { ...runs, references } })).toThrow(/foreign key/);
  });

  it("requires a natural-key rule for every synced unique index", () => {
    expect(() => auditBridgeSchema(undefined, { ...BRIDGE_TABLES, collection_sources: { ...BRIDGE_TABLES.collection_sources, uniqueIndexes: {} } })).toThrow(/unique index/);
  });

  it("can create a complete Atlas item from the primary register alone", () => {
    const item = BRIDGE_TABLES.atlas_items;
    expect(item.primaryRegister).toBe("content");
    expect(item.registers.content).toEqual(expect.arrayContaining(["id", "account_id", "kind", "title", "source_key", "storage_key", "created_at"]));
    expect(item.registers.metadata).toContain("is_favorite");
    expect(item.registers.content).not.toContain("is_favorite");
    expect(item.localColumns).toEqual(["version", "updated_at"]);
  });

  it("keeps equal local integers on different runs distinct on the wire", () => {
    expect(bridgePortablePk("run_turns", { id: 1, run_id: "a" })).toBe("a:1");
    expect(bridgePortablePk("run_turns", { id: 1, run_id: "b" })).toBe("b:1");
    expect(() => bridgePortablePk("tool_calls", { id: 1 })).toThrow(/run/);
    expect(() => bridgePortablePk("providers", { id: "codex" })).toThrow(/does not sync/);
    expect(bridgePortablePk("atlas_page_file_refs", { revision_id: "r", file_id: "f" })).toBe('["r","f"]');
  });
});
