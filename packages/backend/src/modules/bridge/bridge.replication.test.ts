import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { BridgeEnvelope, BridgeUpsertBody } from "@mains/contracts/bridge-protocol";
import { createTestDb } from "../../../test/setup-db";
import { createBridgeEngine, type BridgeEngineOptions } from "./bridge.engine";
import { createBridgeTestHub, bridgeTestCodec, bridgeTestRecordKey, closeBridgeTestConnections, disposeBridgeTestHub } from "../../../test/bridge-hub";
import type { BridgeTransport } from "./bridge.transport";
import { registerEventSink } from "../../ipc-kit/event-bus";

const key = bridgeTestRecordKey;
const cleanups: (() => void)[] = [];
afterAll(disposeBridgeTestHub);
afterEach(() => { closeBridgeTestConnections(); for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
type Hub = Awaited<ReturnType<typeof createBridgeTestHub>>;
type Node = Awaited<ReturnType<typeof node>>;
async function node(hub: Hub, id: string, extra: Partial<BridgeEngineOptions> = {}) {
  const fixture = createTestDb(); cleanups.push(fixture.cleanup);
  const sqlite = fixture.sqlite;
  sqlite.exec(`INSERT INTO accounts(id) VALUES('default'); INSERT INTO app_settings(id,account_id,backend_id) VALUES('default','default','${id}');
    INSERT INTO providers(id,kind,display_name) VALUES('claude_code','agent_runtime','Claude');`);
  const transport = extra.transport ?? hub.connect(id);
  const engine = createBridgeEngine({ sqlite, backendId: id, recordKey: key, codec: bridgeTestCodec, transport, experimentalAtlas: true, ...extra });
  await engine.bootstrap();
  return { sqlite, engine, id, hub, transport };
}
function row(n: Node, table: string, id: string | number) { return n.sqlite.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as Record<string, any> | undefined; }
function rows(n: Node, table: string) { return n.sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all() as Record<string, any>[]; }
function space(n: Node, id: string, name = id) { n.sqlite.prepare("INSERT INTO spaces(id,account_id,name,slug,provider_id) VALUES(?,'default',?,?,'claude_code')").run(id, name, name); }
function collection(n: Node, id: string, name = id) { n.sqlite.prepare("INSERT INTO collections(id,account_id,name) VALUES(?,'default',?)").run(id, name); }
function run(n: Node, id: string, workspaceId: string | null = null, spaceId: string | null = null) { n.sqlite.prepare("INSERT INTO runs(id,owner_backend_id,account_id,provider_id,title,workspace_id,space_id) VALUES(?,?,'default','claude_code',?,?,?)").run(id, n.id, id, workspaceId, spaceId); }
function item(n: Node, id: string, sourceRun: string | null = null, sourceKey: string | null = null, hash = "same-bytes") {
  n.sqlite.prepare("INSERT INTO atlas_items(id,account_id,kind,title,source_run_id,source_key,content_hash) VALUES(?,'default','file',?,?,?,?)").run(id, id, sourceRun, sourceKey, hash);
}
function source(n: Node, id: string, collectionId: string) { n.sqlite.prepare("INSERT INTO collection_sources(id,collection_id,kind,name,mime_type,byte_size,content_hash,storage_key) VALUES(?,?,'file',?,'text/plain',3,'same','files/x')").run(id, collectionId, id); }
async function drain(n: Node) {
  for (let i = 0; i < 50; i++) {
    const streams = [...new Set(n.engine.pending().map((entry) => entry.stream))].sort((a, b) => a === "account" ? -1 : b === "account" ? 1 : a.localeCompare(b));
    if (!streams.length) return;
    for (const stream of streams) await n.engine.push(stream);
  }
  throw new Error("Outbox did not drain");
}
async function pullAll(n: Node) {
  await n.engine.pull();
  for (const r of rows(n, "runs")) await n.engine.pull(`run:${r.id}`);
}
async function settle(a: Node, b: Node) { await drain(a); await pullAll(b); await drain(b); await pullAll(a); await drain(a); await pullAll(b); }
const bodyOf = (envelope: BridgeEnvelope) => bridgeTestCodec.open(envelope).body;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }

// All integration scenarios below use separately migrated SQLite handles with FK checks ON.
describe("Bridge transfer between independent SQLite databases", () => {
  it("preserves SQLite JSON1 text through trigger capture, encryption and independent database apply", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B");
    run(a, "json-run"); await settle(a, b);
    a.sqlite.exec(`UPDATE runs SET config_snapshot=json_set('{}','$.conversationSettings',json('{"model":"test","config":{"fastMode":true}}')) WHERE id='json-run';
      INSERT INTO run_artifacts(run_id,kind,content,metadata) VALUES('json-run','report','Reply',json_object('turnIndex',0));`);
    const clock = a.sqlite.prepare("SELECT values_json FROM bridge_row_clock WHERE table_name='runs' AND pk='json-run'").get() as { values_json: string };
    expect(typeof JSON.parse(clock.values_json).config_snapshot).toBe("string");
    await settle(a, b);
    expect(row(b, "runs", "json-run")?.config_snapshot).toBe(row(a, "runs", "json-run")?.config_snapshot);
    expect(typeof rows(b, "run_artifacts")[0].metadata).toBe("string");
    expect(JSON.parse(rows(b, "run_artifacts")[0].metadata)).toEqual({ turnIndex: 0 });
    expect(a.engine.pending()).toEqual([]);
  });

  it("retries an older locally captured JSON subtype image using its original clock and values", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B");
    run(a, "json-legacy");
    a.sqlite.exec(`UPDATE runs SET config_snapshot='{"conversationSettings":{"model":"captured"}}' WHERE id='json-legacy';
      UPDATE bridge_row_clock SET values_json=json_set(values_json,'$.config_snapshot',json('{"conversationSettings":{"model":"captured"}}')),portable=0 WHERE table_name='runs' AND pk='json-legacy';`);
    const before = a.sqlite.prepare("SELECT physical_ms,counter FROM bridge_row_clock WHERE table_name='runs' AND pk='json-legacy'").get();
    await settle(a, b);
    expect(row(b, "runs", "json-legacy")?.config_snapshot).toBe('{"conversationSettings":{"model":"captured"}}');
    expect(a.sqlite.prepare("SELECT physical_ms,counter FROM bridge_row_clock WHERE table_name='runs' AND pk='json-legacy'").get()).toEqual(before);
    expect(a.engine.pending()).toEqual([]);
  });

  it("captures coalesced registers transactionally and applies roots, parents, turns and attachments without echoes", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B");
    a.sqlite.exec("INSERT INTO projects(id,owner_backend_id,account_id,name,root_path) VALUES('p','A','default','Project','/repo'); INSERT INTO workspaces(id,owner_backend_id,account_id,project_id,name,root_path) VALUES('w','A','default','p','Workspace','/repo');");
    space(a, "s"); run(a, "r", "w", "s");
    a.sqlite.exec("INSERT INTO run_turns(run_id,turn_index,response_content) VALUES('r',0,'one'); UPDATE run_turns SET response_content='two' WHERE run_id='r'; INSERT INTO run_attachments(id,name,type,mime_type,storage_key,byte_size,content_hash) VALUES('att','x.png','image','image/png','attachments/x',3,'hash'); INSERT INTO run_attachment_refs(run_id,attachment_id,input_key,ordinal) VALUES('r','att','input',0);");
    expect(a.engine.pending().filter((entry) => entry.table_name === "run_turns")).toHaveLength(1);
    expect(a.engine.pending().some((entry) => entry.table_name === "run_attachments")).toBe(true);
    await settle(a, b);
    expect(row(b, "runs", "r")).toMatchObject({ owner_backend_id: "A", workspace_id: "w", space_id: "s" });
    expect(rows(b, "run_turns")).toMatchObject([{ response_content: "two" }]);
    expect(row(b, "run_attachments", "att")).toMatchObject({ name: "x.png" });
    expect(a.engine.pending()).toEqual([]); expect(b.engine.pending()).toEqual([]);
    expect(b.sqlite.pragma("foreign_key_check")).toEqual([]);
    const before = a.sqlite.prepare("SELECT generation FROM bridge_clock").get();
    expect(() => a.sqlite.transaction(() => { space(a, "rolled-back"); throw new Error("rollback"); })()).toThrow("rollback");
    expect(row(a, "spaces", "rolled-back")).toBeUndefined();
    expect(a.sqlite.prepare("SELECT generation FROM bridge_clock").get()).toEqual(before);
  });

  it("remaps colliding integers and their foreign keys, but preserves opaque provider call ids", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B");
    run(a, "ar"); run(b, "br");
    for (const n of [a, b]) n.sqlite.prepare("INSERT INTO run_turns(run_id,turn_index,response_content) VALUES(?,0,?)").run(`${n.id.toLowerCase()}r`, n.id);
    a.sqlite.exec("INSERT INTO run_turn_changes(id,run_id,turn_id,diff_text,files_json) VALUES('patch','ar',1,'diff','[]'); INSERT INTO tool_calls(account_id,run_id,provider_id,tool_call_id,parent_tool_call_id,tool_name,status) VALUES('default','ar','claude_code','call-1','parent-opaque','Read','completed');");
    await settle(a, b);
    const aTurnAtB = rows(b, "run_turns").find((r) => r.run_id === "ar")!;
    expect(aTurnAtB.id).not.toBe(1);
    expect(row(b, "run_turn_changes", "patch")?.turn_id).toBe(aTurnAtB.id);
    expect(rows(b, "tool_calls")[0]).toMatchObject({ tool_call_id: "call-1", parent_tool_call_id: "parent-opaque" });
    expect(b.sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it("does not clear a new generation when an older push is ACKed", async () => {
    const hub = await createBridgeTestHub(), gate = deferred<void>(), entered = deferred<void>();
    const raw = hub.connect("A"); let delay = false;
    const transport: BridgeTransport = { ...raw, async push(stream, records) { const result = await raw.push(stream, records); if (delay) { entered.resolve(); await gate.promise; } return result; } };
    const a = await node(hub, "A", { transport }), b = await node(hub, "B");
    space(a, "s", "first"); delay = true;
    const pushing = a.engine.push(); await entered.promise;
    a.sqlite.exec("UPDATE spaces SET name='second' WHERE id='s'");
    const newer = a.engine.pending().find((entry) => entry.pk === "s")!.generation;
    gate.resolve(); await pushing;
    expect(a.engine.pending().find((entry) => entry.pk === "s")?.generation).toBe(newer);
    delay = false; await settle(a, b);
    expect(row(b, "spaces", "s")?.name).toBe("second");
  });

  it("uses capture-time clocks: an older edit pushed late loses, a newer remote edit drops the stale outbox", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B");
    space(a, "s"); await settle(a, b);
    a.sqlite.exec("UPDATE spaces SET name='older offline edit' WHERE id='s'");
    const aClock = a.sqlite.prepare("SELECT physical_ms,counter FROM bridge_row_clock WHERE table_name='spaces' AND pk='s'").get() as { physical_ms: number; counter: number };
    b.sqlite.prepare("UPDATE bridge_clock SET physical_ms=?,counter=?").run(aClock.physical_ms + 1, 0);
    b.sqlite.exec("UPDATE spaces SET name='newer edit' WHERE id='s'");
    await drain(b); await a.engine.pull();
    expect(row(a, "spaces", "s")?.name).toBe("newer edit"); expect(a.engine.pending().some((entry) => entry.pk === "s")).toBe(false);
    // Force an older wire image to be delivered after the newer one: LWW on the hub also keeps the winner.
    await settle(a, b); expect(row(b, "spaces", "s")?.name).toBe("newer edit");
  });

  it("keeps a newer pending local register when pulling an older remote register", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B");
    space(a, "s"); await settle(a, b);
    a.sqlite.exec("UPDATE spaces SET name='remote old' WHERE id='s'"); await drain(a);
    b.sqlite.exec("UPDATE bridge_clock SET physical_ms=physical_ms+1000; UPDATE spaces SET name='local new' WHERE id='s'");
    await b.engine.pull();
    expect(row(b, "spaces", "s")?.name).toBe("local new"); expect(b.engine.pending().some((entry) => entry.pk === "s")).toBe(true);
    await settle(b, a); expect(row(a, "spaces", "s")?.name).toBe("local new");
  });

  it("merges independent content and metadata registers without rolling back content", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B");
    item(a, "i"); await settle(a, b);
    a.sqlite.exec("UPDATE atlas_items SET title='New content' WHERE id='i'");
    b.sqlite.exec("UPDATE atlas_items SET is_favorite=1 WHERE id='i'");
    expect(a.engine.pending().filter((entry) => entry.pk === "i").map((entry) => entry.register)).toEqual(["content"]);
    expect(b.engine.pending().filter((entry) => entry.pk === "i").map((entry) => entry.register)).toEqual(["metadata"]);
    await settle(a, b);
    for (const n of [a, b]) expect(row(n, "atlas_items", "i")).toMatchObject({ title: "New content", is_favorite: 1 });
  });

  it("applies optional references as NULL, fills them later without capture and discards stale links", async () => {
    const staging = await createBridgeTestHub(), a = await node(staging, "A");
    run(a, "r"); item(a, "keep", "r"); item(a, "change", "r"); await drain(a);
    const hub = await createBridgeTestHub(), b = await node(hub, "B"); await drain(b);
    const envelopes = (await staging.inspect("account")).map((record) => record.envelope);
    const send = async (predicate: (body: any) => boolean) => hub.connect("A").push("account", envelopes.filter((envelope) => predicate(bodyOf(envelope))));
    await send((body) => body.table !== "runs"); await b.engine.pull();
    expect(row(b, "atlas_items", "keep")?.source_run_id).toBeNull();
    expect(b.sqlite.prepare("SELECT count(*) AS n FROM bridge_pending_links").get()).toEqual({ n: 2 });
    b.sqlite.exec("UPDATE atlas_items SET title='user changed' WHERE id='change'");
    await send((body) => body.table === "runs"); await b.engine.pull();
    expect(row(b, "atlas_items", "keep")?.source_run_id).toBe("r");
    expect(row(b, "atlas_items", "change")?.source_run_id).toBeNull();
    expect(b.engine.pending().filter((entry) => entry.pk === "keep")).toHaveLength(0);
    expect(b.engine.pending().filter((entry) => entry.pk === "change")).toHaveLength(1);
    expect(b.sqlite.prepare("SELECT count(*) AS n FROM bridge_pending_links").get()).toEqual({ n: 0 });
  });

  it("sends local and out-of-scope optional references as NULL with portable display refs", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B");
    a.sqlite.exec("INSERT INTO bridge_exclusions(table_name,pk) VALUES('runs','private'); INSERT INTO entities(id,account_id,kind,title,external_id) VALUES('entity','default','issue','Issue 123','123');");
    run(a, "private"); item(a, "i", "private"); run(a, "public");
    a.sqlite.exec("INSERT INTO run_context(run_id,kind,entity_id,content) VALUES('public','note','entity','Context')");
    await settle(a, b);
    expect(row(b, "runs", "private")).toBeUndefined(); expect(row(b, "atlas_items", "i")?.source_run_id).toBeNull();
    expect(rows(b, "run_context")[0].entity_id).toBeNull(); expect(rows(b, "entities")).toEqual([]);
    const itemBody = (await hub.inspect("account")).map((r) => bodyOf(r.envelope)).find((body) => body.table === "atlas_items" && "register" in body && body.register === "content") as BridgeUpsertBody;
    expect(itemBody.refs.source_run_id).toMatchObject({ runTitle: "private" });
    const contextBody = bodyOf((await hub.inspect("run:public"))[0].envelope) as BridgeUpsertBody;
    expect(contextBody.refs.entity_id).toMatchObject({ title: "Issue 123", externalId: "123" });
  });

  it("keeps deletes final after long offline edits and hub compaction, but allows explicit re-add with a fresh id", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B");
    collection(a, "old"); await settle(a, b);
    b.sqlite.exec("UPDATE collections SET name='offline' WHERE id='old'");
    a.sqlite.exec("DELETE FROM collections WHERE id='old'"); await drain(a); await hub.compact();
    await drain(b);
    expect(row(b, "collections", "old")).toBeUndefined(); expect(b.engine.pending()).toEqual([]);
    expect(() => collection(b, "old")).toThrow(/deleted/);
    collection(b, "new", "offline"); await settle(b, a);
    expect(row(a, "collections", "new")?.name).toBe("offline"); expect(row(a, "collections", "old")).toBeUndefined();
  });

  it("recovers before cascade on pull and deleted ACK, even if publication's ACK was lost", async () => {
    const hub = await createBridgeTestHub(), recover = vi.fn(({ sqlite, table, pk, captureAfterDelete }) => {
      if (table !== "collections") return;
      expect(sqlite.prepare("SELECT 1 FROM collection_sources WHERE collection_id=?").get(pk)).toBeTruthy();
      sqlite.prepare("INSERT INTO collections(id,account_id,name) VALUES(?,'default','Recovered')").run(`recovered-${pk}`);
      captureAfterDelete("collections", `recovered-${pk}`);
    });
    const raw = hub.connect("B"); let loseAck = false;
    const transport: BridgeTransport = { ...raw, async push(stream, records) { const result = await raw.push(stream, records); if (loseAck) throw new Error("lost ACK"); return result; } };
    const a = await node(hub, "A"), b = await node(hub, "B", { transport, recover });
    collection(b, "c"); source(b, "src", "c"); loseAck = true;
    await expect(b.engine.push()).rejects.toThrow("lost ACK");
    await a.engine.pull(); a.sqlite.exec("DELETE FROM collections WHERE id='c'"); await drain(a); await hub.compact();
    loseAck = false; await drain(b);
    expect(recover).toHaveBeenCalledTimes(1); expect(row(b, "collections", "c")).toBeUndefined();
    expect(row(b, "collections", "recovered-c")).toBeTruthy();
    await b.engine.fullPull(); expect(recover).toHaveBeenCalledTimes(1);
    collection(a, "pull-delete"); source(a, "pull-src", "pull-delete"); await settle(a, b);
    a.sqlite.exec("DELETE FROM collections WHERE id='pull-delete'"); await drain(a); await b.engine.pull();
    expect(recover).toHaveBeenCalledTimes(2); expect(row(b, "collections", "recovered-pull-delete")).toBeTruthy();
  });

  it("keeps local edits made during a full pull and serializes it after in-flight pushes", async () => {
    const hub = await createBridgeTestHub(), gate = deferred<void>(), entered = deferred<void>(), raw = hub.connect("B"); let delay = false;
    const transport: BridgeTransport = { ...raw, async pull(stream, after, limit) { const page = await raw.pull(stream, after, limit); if (delay) { entered.resolve(); await gate.promise; } return page; } };
    const a = await node(hub, "A"), b = await node(hub, "B", { transport });
    space(a, "s"); await settle(a, b);
    a.sqlite.exec("UPDATE spaces SET name='remote' WHERE id='s'"); await drain(a);
    delay = true; const pulling = b.engine.fullPull(); await entered.promise;
    b.sqlite.exec("UPDATE bridge_clock SET physical_ms=physical_ms+1000; UPDATE spaces SET name='during pull' WHERE id='s'");
    gate.resolve(); await pulling; delay = false;
    expect(row(b, "spaces", "s")?.name).toBe("during pull");
    await settle(b, a); expect(row(a, "spaces", "s")?.name).toBe("during pull");
  });

  it("publishes UI notifications only after commit and suppresses replica capture", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), changes = vi.fn();
    const b = await node(hub, "B", { onApplied: changes }); await settle(a, b); changes.mockClear();
    const sink = vi.fn((channel: string) => { if (channel === "space:changed") expect(row(b, "spaces", "s")).toBeTruthy(); });
    cleanups.push(registerEventSink({ kind: "bridge-test", send: sink }));
    space(a, "s"); run(a, "r"); await drain(a); await pullAll(b);
    expect(changes).toHaveBeenCalled(); expect(sink).toHaveBeenCalledWith("space:changed", {}, undefined);
    expect(b.engine.pending()).toEqual([]);
    // Even a direct accidental SQL write to a foreign-owned run cannot be sent as this backend's intent.
    b.sqlite.exec("UPDATE runs SET title='accidental' WHERE id='r'"); expect(b.engine.pending()).toEqual([]);
  });
});

describe("Bridge parking, deterministic merges and durable recovery", () => {
  it.each([true, false])("parks a new secondary register across batches until its primary arrives (secondary first: %s)", async (secondaryFirst) => {
    const staging = await createBridgeTestHub(), a = await node(staging, "A"); item(a, "i"); a.sqlite.exec("UPDATE atlas_items SET is_favorite=1 WHERE id='i'"); await drain(a);
    const hub = await createBridgeTestHub(), b = await node(hub, "B"); await drain(b);
    const records = (await staging.inspect("account")).map((record) => record.envelope).filter((envelope) => bodyOf(envelope).table === "atlas_items");
    records.sort((left) => (bodyOf(left) as BridgeUpsertBody).register === "metadata" ? (secondaryFirst ? -1 : 1) : (secondaryFirst ? 1 : -1));
    await hub.connect("A").push("account", [records[0]]); await b.engine.pull();
    if (secondaryFirst) expect(b.sqlite.prepare("SELECT reason FROM bridge_parked").get()).toEqual({ reason: "primary" });
    await hub.connect("A").push("account", [records[1]]); await b.engine.pull();
    expect(row(b, "atlas_items", "i")).toMatchObject({ title: "i", is_favorite: 1 });
    expect(b.sqlite.prepare("SELECT count(*) AS n FROM bridge_parked").get()).toEqual({ n: 0 }); expect(b.engine.pending()).toEqual([]);
  });

  it("parks missing required and seeded parents across batches and engine restarts", async () => {
    const staging = await createBridgeTestHub(), a = await node(staging, "A");
    a.sqlite.exec("INSERT INTO projects(id,owner_backend_id,account_id,name,root_path) VALUES('p','A','default','P','/repo'); INSERT INTO workspaces(id,owner_backend_id,account_id,project_id,name,root_path) VALUES('w','A','default','p','W','/repo');");
    space(a, "s"); run(a, "r", "w", "s"); a.sqlite.exec("INSERT INTO run_turns(run_id,turn_index) VALUES('r',0)"); await drain(a);
    const hub = await createBridgeTestHub(), b = await node(hub, "B"); await drain(b); b.sqlite.exec("DELETE FROM providers");
    const envelopes = (await staging.inspect("account")).map((record) => record.envelope);
    await hub.connect("A").push("account", envelopes.filter((e) => bodyOf(e).table === "runs"));
    await hub.connect("A").push("run:r", (await staging.inspect("run:r")).map((r) => r.envelope));
    await b.engine.pull(); await b.engine.pull("run:r"); expect(row(b, "runs", "r")).toBeUndefined();
    await b.engine.stop();
    b.engine = createBridgeEngine({ sqlite: b.sqlite, backendId: "B", recordKey: key, codec: bridgeTestCodec, transport: hub.connect("B"), experimentalAtlas: true });
    await hub.connect("A").push("account", envelopes.filter((e) => bodyOf(e).table !== "runs")); await b.engine.pull();
    expect(row(b, "workspaces", "w")).toBeTruthy(); expect(row(b, "runs", "r")).toBeUndefined();
    b.sqlite.exec("INSERT INTO providers(id,kind,display_name) VALUES('claude_code','agent_runtime','Claude')"); await b.engine.retryParked();
    expect(row(b, "runs", "r")).toMatchObject({ workspace_id: "w", space_id: "s" }); expect(rows(b, "run_turns")).toHaveLength(1);
    expect(b.sqlite.prepare("SELECT * FROM bridge_parked").all()).toEqual([]); expect(b.engine.pending()).toEqual([]);
  });

  it("retains records from a newer schema until the receiving backend upgrades", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A", { schemaVersion: 3 }), b = await node(hub, "B");
    space(a, "new-schema"); await drain(a); await b.engine.pull();
    expect(row(b, "spaces", "new-schema")).toBeUndefined(); expect(b.sqlite.prepare("SELECT reason FROM bridge_parked WHERE reason='schema'").get()).toBeTruthy();
    await b.engine.stop(); b.engine = createBridgeEngine({ sqlite: b.sqlite, backendId: "B", recordKey: key, codec: bridgeTestCodec, transport: hub.connect("B"), schemaVersion: 3, experimentalAtlas: true });
    await b.engine.retryParked(); expect(row(b, "spaces", "new-schema")).toBeTruthy(); expect(b.sqlite.prepare("SELECT * FROM bridge_parked").all()).toEqual([]);
  });

  it("resolves equal HLCs by origin regardless of push order", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B"); space(a, "s"); await settle(a, b);
    const future = Date.now() + 100_000;
    for (const n of [a, b]) { n.sqlite.prepare("UPDATE bridge_clock SET physical_ms=?,counter=0").run(future); n.sqlite.prepare("UPDATE spaces SET name=? WHERE id='s'").run(n.id); }
    await drain(b); await drain(a); await pullAll(a); await pullAll(b);
    expect(row(a, "spaces", "s")?.name).toBe("B"); expect(row(b, "spaces", "s")?.name).toBe("B");
    await hub.compact(); expect((await hub.inspect("account")).filter((r) => bodyOf(r.envelope).table === "spaces")).toHaveLength(1);
  });

  const orders = [[0,1,2], [0,2,1], [1,0,2], [1,2,0], [2,0,1], [2,1,0]];
  it.each(orders)("allows all three same-named Spaces in arrival order %s %s %s", async (...order) => {
    const hub = await createBridgeTestHub(), target = await node(hub, "T"); await drain(target);
    for (const index of order) {
      const n = await node(await createBridgeTestHub(), `N${index}`); space(n, `s${index}`, "Same name"); await drain(n);
      const record = (await n.hub.inspect("account")).find((entry) => bodyOf(entry.envelope).table === "spaces")!;
      await hub.connect(n.id).push("account", [record.envelope]); await target.engine.pull();
    }
    expect(rows(target, "spaces").map((s) => [s.id, s.name, s.slug])).toEqual([0,1,2].map((i) => [`s${i}`, "Same name", "Same name"]));
  });

  it.each(orders)("merges equal content into the same survivor in arrival order %s %s %s", async (...order) => {
    const hub = await createBridgeTestHub(), target = await node(hub, "T"); collection(target, "c"); await drain(target);
    const records: BridgeEnvelope[] = [];
    for (let index = 0; index < 3; index++) {
      const n = await node(await createBridgeTestHub(), `N${index}`); collection(n, "c");
      n.sqlite.prepare("UPDATE bridge_clock SET physical_ms=?,counter=0").run(2_000_000_000_000 + index);
      source(n, ["c-src", "b-src", "a-src"][index], "c"); await drain(n);
      records.push((await n.hub.inspect("account")).find((entry) => bodyOf(entry.envelope).table === "collection_sources")!.envelope);
    }
    for (const index of order) { await hub.connect(`N${index}`).push("account", [records[index]]); await target.engine.pull(); }
    expect(rows(target, "collection_sources").map((s) => [s.id, s.name])).toEqual([["a-src", "a-src"]]);
    expect(target.sqlite.prepare("SELECT alias_pk,canonical_pk FROM bridge_aliases ORDER BY alias_pk").all()).toEqual([{ alias_pk: "b-src", canonical_pk: "a-src" }, { alias_pk: "c-src", canonical_pk: "a-src" }]);
    expect(target.engine.pending()).toEqual([]);
  });

  it("retargets a losing row's pending favourite, then deletes every transitive alias before a fresh third backend pulls", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B");
    item(a, "b-id", null, "run-output"); item(b, "c-id", null, "run-output"); await drain(a); await drain(b);
    const staging = await createBridgeTestHub(), other = await node(staging, "O"); item(other, "a-id", null, "run-output"); await drain(other);
    b.sqlite.exec("UPDATE bridge_clock SET physical_ms=physical_ms+1000");
    b.sqlite.exec("UPDATE atlas_items SET is_favorite=1 WHERE id='c-id'"); await b.engine.pull();
    expect(rows(b, "atlas_items").map((r) => r.id)).toEqual(["b-id"]);
    expect(b.engine.pending().filter((entry) => entry.table_name === "atlas_items")).toMatchObject([{ pk: "b-id", register: "metadata" }]);
    await settle(b, a); expect(row(a, "atlas_items", "b-id")?.is_favorite).toBe(1);
    await hub.connect("O").push("account", (await staging.inspect("account")).filter((r) => bodyOf(r.envelope).table === "atlas_items").map((r) => r.envelope));
    await b.engine.pull(); expect(rows(b, "atlas_items").map((r) => r.id)).toEqual(["a-id"]);
    expect(row(b, "atlas_items", "a-id")?.is_favorite).toBe(1);
    b.sqlite.exec("DELETE FROM atlas_items WHERE id='a-id'");
    expect(b.engine.pending().filter((entry) => entry.op === "delete").map((entry) => entry.pk).sort()).toEqual(["a-id", "b-id", "c-id"]);
    await drain(b); await hub.compact(); const c = await node(hub, "C");
    expect(rows(c, "atlas_items")).toEqual([]); expect(c.sqlite.prepare("SELECT pk FROM bridge_tombstones WHERE table_name='atlas_items' ORDER BY pk").all()).toEqual([{ pk: "a-id" }, { pk: "b-id" }, { pk: "c-id" }]);
    item(c, "fresh", null, "run-output"); await settle(c, b); expect(row(b, "atlas_items", "fresh")).toBeTruthy();
  });

  it.each([true, false])("keeps changed outputs as separate files with deterministic source-key ownership (reverse: %s)", async (reverse) => {
    const staging = await createBridgeTestHub(), a = await node(staging, "A"), b = await node(staging, "B");
    item(a, "a", null, "output", "bytes-one"); item(b, "b", null, "output", "bytes-two"); await drain(a); await drain(b);
    const hub = await createBridgeTestHub(), target = await node(hub, "T");
    const records = (await staging.inspect("account")).filter((r) => bodyOf(r.envelope).table === "atlas_items"); if (reverse) records.reverse();
    for (const record of records) { await hub.connect(record.envelope.header.origin).push("account", [record.envelope]); await target.engine.pull(); }
    expect(rows(target, "atlas_items").map((r) => [r.id, r.source_key, r.content_hash])).toEqual([["a", "output", "bytes-one"], ["b", null, "bytes-two"]]);
  });

  it("closes a deleted run's stream, preserves its whole root tombstone, and blocks a second writer", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B");
    run(a, "r"); a.sqlite.exec("INSERT INTO run_turns(run_id,turn_index) VALUES('r',0)"); await settle(a, b);
    const turn = (await hub.inspect("run:r"))[0].envelope;
    const forged = structuredClone(turn); forged.header.origin = "B"; forged.header.owner = "B";
    expect(await hub.connect("B").push("run:r", [forged])).toEqual([{ error: "notOwner" }]);
    a.sqlite.exec("DELETE FROM runs WHERE id='r'"); await drain(a);
    const tombstone = (await hub.inspect("account")).find((r) => r.envelope.header.op === "delete")!;
    await hub.compact(); expect((await hub.inspect("run:r"))).toEqual([]); expect((await hub.inspect("account"))).toContainEqual(tombstone);
    await b.engine.pull(); expect(row(b, "runs", "r")).toBeUndefined(); expect(rows(b, "run_turns")).toEqual([]);
    expect(await hub.connect("A").push("run:r", [turn])).toEqual([{ deleted: tombstone.envelope }]);
    const c = await node(hub, "C"); expect(row(c, "runs", "r")).toBeUndefined();
  });

  it("protects fixed identities and supports explicitly disabling Atlas capture", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A", { experimentalAtlas: false }); space(a, "claude");
    expect(() => a.sqlite.exec("DELETE FROM spaces WHERE id='claude'")).toThrow(/archived/);
    expect(() => a.sqlite.exec("DELETE FROM accounts WHERE id='default'")).toThrow(/archived/);
    item(a, "not-yet-enabled"); expect(a.engine.pending().some((entry) => entry.table_name === "atlas_items")).toBe(false);
    await drain(a); await a.engine.stop();
    a.engine = createBridgeEngine({ sqlite: a.sqlite, backendId: "A", recordKey: key, codec: bridgeTestCodec, transport: hub.connect("A"), experimentalAtlas: true });
    item(a, "pending-atlas"); await a.engine.stop();
    a.engine = createBridgeEngine({ sqlite: a.sqlite, backendId: "A", recordKey: key, codec: bridgeTestCodec, transport: hub.connect("A"), experimentalAtlas: false });
    expect(await a.engine.push()).toBe(0);
    expect(a.engine.pending().filter((entry) => entry.pk === "pending-atlas")).toHaveLength(2);
    expect((await hub.inspect("account")).some((record) => bodyOf(record.envelope).table === "atlas_items")).toBe(false);
  });

  it("resumes a durable backfill and captures writes from a second SQLite connection while the engine is stopped", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"); space(a, "s"); await drain(a);
    const dir = mkdtempSync(join(tmpdir(), "mains-bridge-b2-")); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "db.sqlite"); await a.sqlite.backup(path); await a.engine.stop();
    const db = new Database(path); cleanups.push(() => db.close()); db.pragma("foreign_keys=ON");
    db.exec("UPDATE spaces SET name='while stopped' WHERE id='s'");
    // No connection-specific UDF registration was needed to execute the capture triggers.
    const firstGeneration = (db.prepare("SELECT generation FROM bridge_outbox WHERE pk='s'").get() as { generation: number }).generation;
    db.exec("UPDATE bridge_config SET backfill_done=0,backfill_table='spaces',backfill_pk=NULL");
    const engine = createBridgeEngine({ sqlite: db, backendId: "A", recordKey: key, codec: bridgeTestCodec, transport: hub.connect("A"), experimentalAtlas: true });
    expect((await engine.backfill(1)).done).toBe(false);
    await engine.stop();
    const restarted = createBridgeEngine({ sqlite: db, backendId: "A", recordKey: key, codec: bridgeTestCodec, transport: hub.connect("A"), experimentalAtlas: true });
    while (!(await restarted.backfill(2)).done) { /* Resume after the durable cursor. */ }
    expect(restarted.pending().find((entry) => entry.pk === "s")?.generation).toBe(firstGeneration);
    await restarted.push(); const b = await node(hub, "B"); expect(row(b, "spaces", "s")?.name).toBe("while stopped");
    const writer = new Database(path); cleanups.push(() => writer.close()); writer.pragma("foreign_keys=ON"); writer.exec("UPDATE spaces SET name='other connection' WHERE id='s'");
    expect(restarted.pending().find((entry) => entry.pk === "s")!.generation).toBeGreaterThan(firstGeneration);
    await restarted.push(); await b.engine.pull(); expect(row(b, "spaces", "s")?.name).toBe("other connection");
  });
});

describe("Bridge verification and interrupted transfers", () => {
  it.each(["different row", "upsert", "stripped body", "changed routing key"])("rejects a bogus deleted ACK (%s) without losing the local row or outbox", async (variant) => {
    const hub = await createBridgeTestHub(), raw = hub.connect("B"); let forged: BridgeEnvelope | undefined;
    const transport: BridgeTransport = { ...raw, async push(stream, records) { return forged ? records.map(() => ({ deleted: forged! })) : raw.push(stream, records); } };
    const a = await node(hub, "A"), b = await node(hub, "B", { transport }); collection(a, "c"); collection(a, "other"); await settle(a, b);
    const oldUpsert = (await hub.inspect("account")).find((r) => bodyOf(r.envelope).pk === "c")!.envelope;
    a.sqlite.exec("DELETE FROM collections WHERE id='c'; DELETE FROM collections WHERE id='other'"); await drain(a);
    const tombstone = (await hub.inspect("account")).find((r) => r.envelope.header.op === "delete" && bodyOf(r.envelope).pk === "c")!.envelope;
    forged = structuredClone(tombstone);
    if (variant === "different row") forged = (await hub.inspect("account")).find((r) => r.envelope.header.op === "delete" && bodyOf(r.envelope).pk === "other")!.envelope;
    if (variant === "upsert") forged = oldUpsert;
    if (variant === "stripped body") forged.body.payload = "{}";
    if (variant === "changed routing key") forged.header.rowKey = "tampered";
    b.sqlite.exec("UPDATE collections SET name='offline draft' WHERE id='c'");
    await expect(b.engine.push()).rejects.toThrow(/Bridge/);
    expect(row(b, "collections", "c")?.name).toBe("offline draft"); expect(b.engine.pending().some((entry) => entry.pk === "c")).toBe(true);
    expect(b.sqlite.prepare("SELECT applying FROM bridge_state").get()).toEqual({ applying: 0 });
    forged = undefined; await drain(b); expect(row(b, "collections", "c")).toBeUndefined();
  });

  it("passes every remote deletion through the supplied codec before any mutation", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"); let rejectDelete = false;
    const open = vi.fn((envelope: BridgeEnvelope) => { if (rejectDelete && envelope.header.op === "delete") throw new Error("authentication failed"); return bridgeTestCodec.open(envelope); });
    const b = await node(hub, "B", { codec: { ...bridgeTestCodec, open } }); collection(a, "c"); await settle(a, b);
    a.sqlite.exec("DELETE FROM collections WHERE id='c'"); await drain(a);
    const before = b.sqlite.prepare("SELECT * FROM bridge_cursors").all(); rejectDelete = true;
    await expect(b.engine.pull()).rejects.toThrow("authentication failed"); expect(row(b, "collections", "c")).toBeTruthy(); expect(b.sqlite.prepare("SELECT * FROM bridge_cursors").all()).toEqual(before);
    rejectDelete = false; await b.engine.pull(); expect(row(b, "collections", "c")).toBeUndefined();
    expect(open.mock.calls.filter(([e]) => e.header.op === "delete").length).toBeGreaterThan(1);
  });

  it("rolls back the whole incoming batch if recovery fails and retries it at the old cursor", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"); let fail = true;
    const b = await node(hub, "B", { recover: () => { if (fail) throw new Error("recovery failed"); } });
    collection(a, "c"); source(a, "src", "c"); await settle(a, b);
    const cursor = b.sqlite.prepare("SELECT * FROM bridge_cursors").all(); a.sqlite.exec("DELETE FROM collections WHERE id='c'"); await drain(a);
    await expect(b.engine.pull()).rejects.toThrow("recovery failed"); expect(row(b, "collections", "c")).toBeTruthy(); expect(row(b, "collection_sources", "src")).toBeTruthy();
    expect(b.sqlite.prepare("SELECT * FROM bridge_cursors").all()).toEqual(cursor); expect(b.sqlite.prepare("SELECT applying FROM bridge_state").get()).toEqual({ applying: 0 });
    fail = false; await b.engine.pull(); expect(row(b, "collections", "c")).toBeUndefined();
  });

  it("drains a push in flight before starting a full pull", async () => {
    const hub = await createBridgeTestHub(), raw = hub.connect("A"), gate = deferred<void>(), entered = deferred<void>(); let delay = false; const calls: string[] = [];
    const transport: BridgeTransport = { async push(stream, records) { calls.push("push"); const result = await raw.push(stream, records); if (delay) { entered.resolve(); await gate.promise; } calls.push("ack"); return result; },
      async pull(stream, after, limit) { calls.push("pull"); return raw.pull(stream, after, limit); } };
    const a = await node(hub, "A", { transport }); await drain(a); calls.length = 0; delay = true; space(a, "s");
    const pushing = a.engine.push(); await entered.promise; const pulling = a.engine.fullPull();
    await Promise.resolve(); expect(calls).toEqual(["push"]); gate.resolve(); await pushing; await pulling; expect(calls).toEqual(["push", "ack", "pull"]);
    expect(a.engine.pending()).toEqual([]);
  });

  it("gives a reused attachment to each lazy run stream, including after the original run is deleted", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B");
    await drain(b);
    run(a, "original"); a.sqlite.exec("INSERT INTO run_attachments(id,name,type,mime_type,storage_key,byte_size,content_hash) VALUES('att','x.png','image','image/png','attachments/x',3,'hash'); INSERT INTO run_attachment_refs(run_id,attachment_id,input_key,ordinal) VALUES('original','att','input',0)"); await drain(a);
    run(a, "fork"); a.sqlite.exec("INSERT INTO run_attachment_refs(run_id,attachment_id,input_key,ordinal) VALUES('fork','att','input',0)"); await drain(a);
    a.sqlite.exec("DELETE FROM runs WHERE id='original'"); await drain(a); await hub.compact();
    await b.engine.pull(); await b.engine.pull("run:fork"); expect(row(b, "run_attachments", "att")).toBeTruthy();
    expect(b.sqlite.prepare("SELECT run_id,attachment_id FROM run_attachment_refs").all()).toEqual([{ run_id: "fork", attachment_id: "att" }]);
    expect(b.sqlite.prepare("SELECT * FROM bridge_parked").all()).toEqual([]); expect(b.engine.pending()).toEqual([]);
  });

  it("uses remote fixed-id configuration before backfilling an existing backend, while preserving its new local rows", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"); space(a, "claude", "Custom Claude"); collection(a, "remote"); await drain(a);
    const fixture = createTestDb(); cleanups.push(fixture.cleanup); const sqlite = fixture.sqlite;
    sqlite.exec("INSERT INTO accounts(id) VALUES('default'); INSERT INTO app_settings(id,account_id,backend_id) VALUES('default','default','B'); INSERT INTO spaces(id,account_id,name,slug) VALUES('claude','default','Installation default','claude'); INSERT INTO collections(id,account_id,name) VALUES('local','default','Local collection')");
    const engine = createBridgeEngine({ sqlite, backendId: "B", recordKey: key, codec: bridgeTestCodec, transport: hub.connect("B") }); await engine.bootstrap(1);
    expect(sqlite.prepare("SELECT name FROM spaces WHERE id='claude'").get()).toEqual({ name: "Custom Claude" });
    expect(engine.pending().map((entry) => [entry.table_name, entry.pk])).toEqual([["collections", "local"]]);
    await engine.push(); await a.engine.pull(); expect(row(a, "collections", "local")?.name).toBe("Local collection");
  });
});

describe("Bridge scope and projection repair", () => {
  it("keeps a Local only project's runs and their required children out of transfer, without blocking an optional Atlas source", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B");
    a.sqlite.exec("INSERT INTO projects(id,owner_backend_id,account_id,name,root_path) VALUES('p','A','default','Private','/private'); INSERT INTO workspaces(id,owner_backend_id,account_id,project_id,name,root_path) VALUES('w','A','default','p','Private','/private'); INSERT INTO bridge_exclusions(table_name,pk) VALUES('projects','p')");
    run(a, "private", "w"); a.sqlite.exec("INSERT INTO run_turns(run_id,turn_index) VALUES('private',0)"); item(a, "i", "private");
    await settle(a, b);
    expect(row(b, "projects", "p")).toBeUndefined(); expect(row(b, "workspaces", "w")).toBeUndefined(); expect(row(b, "runs", "private")).toBeUndefined(); expect(rows(b, "run_turns")).toEqual([]);
    expect(row(b, "atlas_items", "i")?.source_run_id).toBeNull(); expect(b.sqlite.prepare("SELECT * FROM bridge_pending_links").all()).toEqual([]);
  });

  it("repairs a missing physical projection from a full pull even when its register clock already exists", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B"); space(a, "s"); await settle(a, b);
    b.sqlite.exec("UPDATE bridge_state SET applying=1; DELETE FROM spaces WHERE id='s'; UPDATE bridge_state SET applying=0");
    expect(b.sqlite.prepare("SELECT * FROM bridge_row_clock WHERE table_name='spaces' AND pk='s'").get()).toBeTruthy();
    await b.engine.fullPull( "account", 1); expect(row(b, "spaces", "s")).toBeTruthy(); expect(b.engine.pending()).toEqual([]);
  });

  it("parks Atlas deletes too until Atlas replication is explicitly enabled", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B", { experimentalAtlas: false }); item(a, "i");
    item(b, "i"); await drain(a); a.sqlite.exec("DELETE FROM atlas_items WHERE id='i'"); await drain(a); await hub.compact();
    await b.engine.pull(); expect(row(b, "atlas_items", "i")).toBeTruthy(); expect(b.sqlite.prepare("SELECT reason FROM bridge_parked").get()).toEqual({ reason: "disabled" });
    await b.engine.stop(); b.engine = createBridgeEngine({ sqlite: b.sqlite, backendId: "B", recordKey: key, codec: bridgeTestCodec, transport: hub.connect("B"), experimentalAtlas: true });
    await b.engine.retryParked(); expect(row(b, "atlas_items", "i")).toBeUndefined();
  });
});

describe("Bridge delayed publication and integer repair", () => {
  it("keeps the newer register on the hub when an offline older edit is pushed later", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B"); space(a, "s"); await settle(a, b);
    a.sqlite.exec("UPDATE spaces SET name='older pending' WHERE id='s'");
    b.sqlite.exec("UPDATE bridge_clock SET physical_ms=physical_ms+1000; UPDATE spaces SET name='newer published' WHERE id='s'");
    await drain(b); await drain(a); await hub.compact(); await a.engine.pull(); await b.engine.pull();
    expect(row(a, "spaces", "s")?.name).toBe("newer published"); expect(row(b, "spaces", "s")?.name).toBe("newer published");
    const wire = (await hub.inspect("account")).find((record) => bodyOf(record.envelope).table === "spaces")!;
    expect((bodyOf(wire.envelope) as BridgeUpsertBody).values.name).toBe("newer published");
  });

  it("repairs integer projections and their FK mappings after corruption without changing their wire identity", async () => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B"); run(a, "r");
    a.sqlite.exec("INSERT INTO run_turns(run_id,turn_index,response_content) VALUES('r',0,'answer'); INSERT INTO run_turn_changes(id,run_id,turn_id,diff_text,files_json) VALUES('patch','r',1,'diff','[]')"); await settle(a, b);
    for (const n of [a, b]) {
      const old = rows(n, "run_turns")[0];
      n.sqlite.exec("UPDATE bridge_state SET applying=1; DELETE FROM run_turns; UPDATE bridge_state SET applying=0");
      await n.engine.fullPull("run:r");
      const repaired = rows(n, "run_turns")[0]; expect(repaired.response_content).toBe("answer"); expect(repaired.id).not.toBe(old.id);
      expect(row(n, "run_turn_changes", "patch")?.turn_id).toBe(repaired.id); expect(n.sqlite.pragma("foreign_key_check")).toEqual([]);
    }
    a.sqlite.exec("UPDATE run_turns SET response_content='edited after repair' WHERE run_id='r'");
    expect(a.engine.pending().map((entry) => entry.pk)).toEqual(["r:1"]);
    await drain(a); await b.engine.pull("run:r"); expect(rows(b, "run_turns")[0].response_content).toBe("edited after repair"); expect(rows(b, "run_turns")).toHaveLength(1);
  });
});

describe("Bridge references into natural-key aliases", () => {
  it.each([true, false])("rewrites and deduplicates composite references, including their pending edits and later delete (loser published: %s)", async (publishLoser) => {
    const hub = await createBridgeTestHub(), a = await node(hub, "A"), b = await node(hub, "B");
    a.sqlite.exec("INSERT INTO atlas_items(id,account_id,kind,title) VALUES('page','default','page','Page'); INSERT INTO atlas_page_revisions(id,item_id,version,title,blocks_json,markdown,actor) VALUES('rev','page',1,'Page','[]','','user')"); await settle(a, b);
    item(a, "a-file", null, "output"); item(b, "b-file", null, "output");
    a.sqlite.exec("INSERT INTO atlas_page_file_refs(revision_id,file_id) VALUES('rev','a-file')");
    b.sqlite.exec("INSERT INTO atlas_page_file_refs(revision_id,file_id) VALUES('rev','b-file')");
    await drain(a); if (publishLoser) await drain(b);
    await b.engine.pull(); await settle(b, a);
    for (const n of [a, b]) {
      expect(n.sqlite.prepare("SELECT * FROM atlas_page_file_refs").all()).toEqual([{ revision_id: "rev", file_id: "a-file" }]);
      expect(n.sqlite.prepare("SELECT * FROM bridge_parked").all()).toEqual([]); expect(n.sqlite.pragma("foreign_key_check")).toEqual([]);
      await n.engine.fullPull();
    }
    const deleting = publishLoser ? a : b;
    deleting.sqlite.exec("DELETE FROM atlas_page_file_refs WHERE revision_id='rev' AND file_id='a-file'");
    expect(deleting.engine.pending().filter((entry) => entry.op === "delete").map((entry) => entry.pk).sort()).toEqual(['["rev","a-file"]', '["rev","b-file"]']);
    await drain(deleting); await hub.compact(); const c = await node(hub, "C");
    expect(c.sqlite.prepare("SELECT * FROM atlas_page_file_refs").all()).toEqual([]); expect(c.sqlite.prepare("SELECT * FROM bridge_parked").all()).toEqual([]);
  });
});
