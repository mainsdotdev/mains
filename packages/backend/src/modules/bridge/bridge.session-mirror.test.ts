import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { BRIDGE_IDLE_RETENTION_MS } from "@mains/contracts/bridge-protocol";
import { createTestDb } from "../../../test/setup-db";
import { claudeSessionFixture } from "../../../test/claude-session-fixture";
import { bridgeTestCodec, bridgeTestRecordKey, createBridgeTestHub, disposeBridgeTestHub, networkMode, type BridgeTestHub } from "../../../test/bridge-hub";
import { createBridgeEngine } from "./bridge.engine";
import { createClaudeSessionMirror, importClaudeSessionMirror, refreshClaudeSessionMirrors } from "./bridge.session-mirror";
import { setBridgeProjectScope } from "./bridge.product";

const cleanups: (() => void | Promise<void>)[] = [];
afterAll(disposeBridgeTestHub);
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function node(hub: BridgeTestHub, backendId: string, schemaVersion?: number) {
  const { sqlite, cleanup } = createTestDb(); cleanups.push(cleanup);
  sqlite.exec("INSERT INTO accounts(id) VALUES('default'); INSERT INTO providers(id,kind,display_name) VALUES('claude_code','agent_runtime','Claude')");
  sqlite.prepare("INSERT INTO app_settings(id,account_id,backend_id) VALUES('default','default',?)").run(backendId);
  const engine = createBridgeEngine({ sqlite, backendId, recordKey: bridgeTestRecordKey, codec: hub.codec(backendId), transport: hub.connect(backendId), schemaVersion });
  cleanups.push(() => engine.stop()); await engine.bootstrap(); return { sqlite, engine, backendId };
}
type Node = Awaited<ReturnType<typeof node>>;
function source(n: Node, sessionId: string, runId = "r") {
  n.sqlite.prepare("INSERT INTO runs(id,owner_backend_id,account_id,provider_id,session_id,title) VALUES(?,?,'default','claude_code',?,'Claude mirror')").run(runId, n.backendId, sessionId);
}
function store(n: Node, sessionId: string, runId = "r") { return createClaudeSessionMirror({ sqlite: n.sqlite, backendId: n.backendId, runId, sessionId }); }
async function fixture() { const value = await claudeSessionFixture(); cleanups.push(value.cleanup); vi.stubEnv("CLAUDE_CONFIG_DIR", value.configDir); return value; }
async function drain(n: Node) {
  for (let i = 0; i < 30; i++) {
    const streams = [...new Set(n.engine.pending().map((entry) => entry.stream))].sort((a, b) => a === "account" ? -1 : b === "account" ? 1 : a.localeCompare(b));
    if (!streams.length) return;
    for (const stream of streams) await n.engine.push(stream);
  }
  throw new Error("Mirror outbox did not drain");
}
async function backfill(n: Node) { while (!(await n.engine.backfill(100)).done) { /* Persisted bounded batches. */ } }

describe("B9 Claude session mirror between independent SQLite backends", () => {
  it("imports the real SDK's main/subagent JSONL and metadata exactly, then replicates lazily and idempotently", async () => {
    const f = await fixture(), hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B");
    source(a, f.sessionId);
    const input = { sqlite: a.sqlite, backendId: "A", runId: "r", sessionId: f.sessionId, dir: f.dir };
    await importClaudeSessionMirror(input);
    const key = { projectKey: "another-machine", sessionId: f.sessionId };
    expect(await store(a, f.sessionId).load(key)).toEqual(f.main);
    expect(await store(a, f.sessionId).listSubkeys!(key)).toEqual(["subagents/agent-review"]);
    expect(await store(a, f.sessionId).load({ ...key, subpath: "subagents/agent-review" })).toEqual(f.child);
    const pending = a.engine.pending();
    await importClaudeSessionMirror(input); expect(a.engine.pending()).toEqual(pending);
    await drain(a); await b.engine.pull();
    expect(await store(b, f.sessionId).load(key)).toBeNull();
    await b.engine.pull("run:r");
    expect(await store(b, f.sessionId).load(key)).toEqual(f.main);
    expect(await store(b, f.sessionId).load({ ...key, subpath: "subagents/agent-review" })).toEqual(f.child);
    expect(b.engine.pending().filter((entry) => entry.table_name === "provider_session_entries")).toEqual([]);
    const extra = { type: "assistant", uuid: randomUUID(), message: { role: "assistant", content: "Next turn" } };
    await appendFile(f.file, JSON.stringify(extra) + "\n"); await importClaudeSessionMirror(input);
    expect(a.engine.pending().filter((entry) => entry.table_name === "provider_session_entries")).toHaveLength(1);
    await drain(a); await b.engine.pull("run:r"); await f.cleanup();
    expect(await store(b, f.sessionId).load(key)).toEqual([...f.main, extra]);
    await expect(store(b, f.sessionId).append(key, [extra])).rejects.toThrow("owner");
  });

  it("preserves Local only entries without uploading them, then backfills their original clocks when enabled", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B"), sessionId = randomUUID();
    a.sqlite.exec("INSERT INTO projects(id,owner_backend_id,account_id,name,root_path) VALUES('p','A','default','Private','/private'); INSERT INTO workspaces(id,owner_backend_id,account_id,project_id,name,root_path) VALUES('w','A','default','p','Private','/private')");
    source(a, sessionId); a.sqlite.exec("UPDATE runs SET workspace_id='w' WHERE id='r'"); setBridgeProjectScope(a.sqlite, "A", "p", true);
    const key = { projectKey: "private", sessionId }, entries = [{ type: "user", uuid: randomUUID(), message: { content: "Private" } }];
    await store(a, sessionId).append(key, entries);
    const clock = a.sqlite.prepare("SELECT physical_ms,counter FROM bridge_row_clock WHERE table_name='provider_session_entries'").get();
    await backfill(a); await drain(a); await b.engine.pull(); expect(b.sqlite.prepare("SELECT id FROM runs WHERE id='r'").get()).toBeUndefined();
    setBridgeProjectScope(a.sqlite, "A", "p", false); await backfill(a); await drain(a); await b.engine.pull(); await b.engine.pull("run:r");
    expect(await store(b, sessionId).load(key)).toEqual(entries);
    expect(a.sqlite.prepare("SELECT physical_ms,counter FROM bridge_row_clock WHERE table_name='provider_session_entries'").get()).toEqual(clock);
  });

  it("parks the new table on an older schema and applies it after upgrade", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B", 2), sessionId = randomUUID();
    source(a, sessionId); const key = { projectKey: "p", sessionId }, entries = [{ type: "assistant", uuid: randomUUID() }];
    await store(a, sessionId).append(key, entries); await drain(a); await b.engine.pull(); await b.engine.pull("run:r");
    expect(await store(b, sessionId).load(key)).toBeNull();
    expect(b.sqlite.prepare("SELECT reason FROM bridge_parked WHERE stream='run:r'").get()).toMatchObject({ reason: "schema" });
    await b.engine.stop(); const upgraded = createBridgeEngine({ sqlite: b.sqlite, backendId: "B", recordKey: bridgeTestRecordKey, codec: hub.codec("B"), transport: hub.connect("B") });
    cleanups.push(() => upgraded.stop()); await upgraded.retryParked(); expect(await store(b, sessionId).load(key)).toEqual(entries);
  });

  it("validates a whole batch and isolates sessions/subpaths; updated UUIDs retain order", async () => {
    const a = await node(await createBridgeTestHub(), "A"), sessionId = randomUUID(); source(a, sessionId);
    const key = { projectKey: "p", sessionId }, uuid = randomUUID();
    await expect(store(a, sessionId).append(key, [{ type: "user", uuid }, { type: undefined } as never])).rejects.toThrow("Invalid");
    expect(await store(a, sessionId).load(key)).toBeNull();
    await expect(store(a, sessionId).append({ ...key, sessionId: randomUUID() }, [{ type: "user" }])).rejects.toThrow("mismatch");
    await expect(store(a, sessionId).load({ ...key, subpath: "../other" })).rejects.toThrow("subpath");
    await store(a, sessionId).append(key, [{ type: "user", uuid, value: 1 }, { type: "assistant", uuid: randomUUID() }]);
    await store(a, sessionId).append(key, [{ type: "user", uuid, value: 2 }]);
    expect(await store(a, sessionId).load(key)).toMatchObject([{ type: "user", uuid, value: 2 }, { type: "assistant" }]);
    a.sqlite.exec("UPDATE provider_session_entries SET content_hash='bad'"); await expect(store(a, sessionId).load(key)).rejects.toThrow("integrity");
  });

  it.skipIf(networkMode)("expires only idle mirrors, preserves transcripts and permits active owners to republish the same clocks", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), sessionId = randomUUID(); source(a, sessionId);
    const key = { projectKey: "p", sessionId }, entries = [{ type: "assistant", uuid: randomUUID() }];
    await store(a, sessionId).append(key, entries); a.sqlite.exec("INSERT INTO run_artifacts(run_id,kind,content) VALUES('r','report','Visible history')");
    await drain(a); const future = Date.now() + BRIDGE_IDLE_RETENTION_MS + 1000;
    const realNow = Date.now.bind(Date); vi.spyOn(Date, "now").mockReturnValue(future); await hub.compact();
    expect((await hub.inspect("run:r")).map((row) => bridgeTestCodec.open(row.envelope).body.table)).toEqual(["run_artifacts"]);
    expect(refreshClaudeSessionMirrors(a.sqlite, "A")).toBe(0);
    a.sqlite.prepare("UPDATE runs SET updated_at=? WHERE id='r'").run(Math.floor(future / 1000));
    expect(refreshClaudeSessionMirrors(a.sqlite, "A")).toBe(1); await backfill(a); await drain(a);
    // A fresh backend can recover the full session even after hub expiry.
    vi.mocked(Date.now).mockImplementation(realNow); const b = await node(hub, "B"); await b.engine.pull("run:r");
    expect(await store(b, sessionId).load(key)).toEqual(entries);
  });
});
