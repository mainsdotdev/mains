import { afterAll, afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb } from "../../../test/setup-db";
import { disposeBridgeTestHub, getLocalBridgeTestWorker, networkMode } from "../../../test/bridge-hub";
import { createBridgeReplicator, type BridgeReplicatorOptions } from "./bridge.replicator";
import { parseBridgeDevConfig } from "./bridge.config";
import { toBase64Url } from "./bridge.encoding";

const key = new Uint8Array(32).fill(51);
const config = { version: 1, backendId: "A", url: "ws://127.0.0.1:8790/v1/log", token: "test-token", accountKey: toBase64Url(key), label: "MacBook" };
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
afterAll(disposeBridgeTestHub);
async function node(account: string, backendId: string, extra: Partial<BridgeReplicatorOptions> = {}) {
  const hub = await getLocalBridgeTestWorker(), fixture = createTestDb(); cleanups.push(fixture.cleanup);
  fixture.sqlite.prepare("INSERT INTO accounts(id) VALUES('default')").run();
  fixture.sqlite.prepare("INSERT INTO app_settings(id,account_id,backend_id) VALUES('default','default',?)").run(backendId);
  fixture.sqlite.exec("INSERT INTO providers(id,kind,display_name) VALUES('claude_code','agent_runtime','Claude')");
  const options: BridgeReplicatorOptions = { sqlite: fixture.sqlite, backendId, autoStart: false, config: {
    url: hub.wsUrl, token: await hub.token(account, backendId), accountKey: key, backendId, label: `Computer ${backendId}`,
  }, ...extra };
  const replicator = createBridgeReplicator(options); cleanups.push(() => replicator.stop());
  return { sqlite: fixture.sqlite, replicator, options };
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 20)); }
  expect(predicate()).toBe(true);
}
function run(n: Awaited<ReturnType<typeof node>>, id = "r") {
  n.sqlite.prepare("INSERT INTO runs(id,account_id,owner_backend_id,provider_id,title,status) VALUES(?,'default',?,'claude_code','Synced chat','running')").run(id, n.options.backendId);
}

describe("Bridge development configuration", () => {
  it("requires an explicit complete config, keeps dev keys private, and permits disabling it", () => {
    expect(parseBridgeDevConfig(config)).toMatchObject({ backendId: "A", label: "MacBook", accountKey: key });
    expect(parseBridgeDevConfig({ enabled: false })).toBeNull();
  });
  it.each([{ url: "ws://example.com/v1/log" }, { url: "wss://example.com/v1/log?token=x" }, { accountKey: "secret-marker" }, { backendId: "../A" }, { label: " " }, { token: "" }])("rejects unsafe or malformed configuration without echoing credentials (%j)", (change) => {
    expect(() => parseBridgeDevConfig({ ...config, ...change })).toThrow();
    try { parseBridgeDevConfig({ ...config, ...change }); } catch (error) { expect(String(error)).not.toContain("secret-marker"); }
  });
});

describe.skipIf(!networkMode)("Bridge background replication for desktop/server viewers", () => {
  it("replicates account roots first, lazily loads a watched conversation, and retains its offline copy", async () => {
    const account = randomUUID(), a = await node(account, "A"), b = await node(account, "B");
    await a.replicator.syncNow(); await b.replicator.syncNow(); run(a);
    a.sqlite.exec("INSERT INTO run_turns(run_id,turn_index,response_content) VALUES('r',0,'Hello from A'); INSERT INTO run_artifacts(run_id,kind,content,metadata) VALUES('r','report','Hello from A','{}')");
    await a.replicator.syncNow(); await b.replicator.syncNow();
    expect(b.sqlite.prepare("SELECT owner_backend_id FROM runs WHERE id='r'").get()).toEqual({ owner_backend_id: "A" });
    expect(b.sqlite.prepare("SELECT * FROM run_turns").all()).toEqual([]);
    b.replicator.watchRun("r", "browser-one"); await b.replicator.syncNow();
    expect(b.sqlite.prepare("SELECT response_content FROM run_turns WHERE run_id='r'").get()).toEqual({ response_content: "Hello from A" });
    expect(b.replicator.getStatus().runs).toContainEqual({ runId: "r", ready: true, error: null });
    await a.replicator.stop(); await until(() => b.replicator.getStatus().backends.some((peer) => peer.backendId === "A" && peer.online === false));
    expect(b.replicator.getStatus().backends.find((peer) => peer.backendId === "A")).toMatchObject({ label: "Computer A", online: false });
    expect(b.sqlite.prepare("SELECT content FROM run_artifacts WHERE run_id='r'").get()).toEqual({ content: "Hello from A" });
  });
  it("automatically transfers newly persisted live content without a UI manually pumping either engine", async () => {
    const account = randomUUID(), timing = { autoStart: true, activeIntervalMs: 20, idleIntervalMs: 30 };
    const a = await node(account, "A", timing), b = await node(account, "B", timing);
    run(a);
    await until(() => !!b.sqlite.prepare("SELECT 1 FROM runs WHERE id='r'").get());
    b.replicator.watchRun("r", "ipad-web");
    a.sqlite.exec("INSERT INTO run_turns(run_id,turn_index,response_content) VALUES('r',0,'First'); INSERT INTO run_artifacts(run_id,kind,content) VALUES('r','report','First')");
    await until(() => !!b.sqlite.prepare("SELECT 1 FROM run_artifacts WHERE content='First'").get());
    a.sqlite.exec("UPDATE run_turns SET response_content='Second' WHERE run_id='r'; UPDATE run_artifacts SET content='Second' WHERE run_id='r'");
    await until(() => !!b.sqlite.prepare("SELECT 1 FROM run_artifacts WHERE content='Second'").get());
    expect(b.sqlite.prepare("SELECT response_content FROM run_turns WHERE run_id='r'").get()).toEqual({ response_content: "Second" });
    expect(b.sqlite.prepare("SELECT * FROM bridge_outbox").all()).toEqual([]);
  });
  it("shares one run subscription between viewers and releases only the departing view", async () => {
    const account = randomUUID(), a = await node(account, "A"), b = await node(account, "B");
    run(a); await a.replicator.syncNow(); await b.replicator.syncNow();
    b.replicator.watchRun("r", "ipad"); b.replicator.watchRun("r", "desktop"); await b.replicator.syncNow();
    b.replicator.unwatchRun("ipad"); expect(b.replicator.getStatus().runs).toHaveLength(1);
    b.replicator.unwatchRun("desktop"); expect(b.replicator.getStatus().runs).toHaveLength(0);
    expect(() => b.replicator.watchRun("missing", "view")).toThrow("Run not found");
  });
  it("keeps local writes/outbox usable during a hub outage and refuses account-key or backend-identity changes", async () => {
    const n = await node(randomUUID(), "A", { requestTimeoutMs: 100 }); await n.replicator.stop();
    const offline = createBridgeReplicator({ ...n.options, config: { ...n.options.config, url: "ws://127.0.0.1:1/v1/log" }, requestTimeoutMs: 100 });
    cleanups.push(() => offline.stop());
    run(n); await expect(offline.syncNow()).rejects.toThrow(/connection/i);
    expect(offline.getStatus()).toMatchObject({ state: "offline", pendingRecords: 1 });
    expect(n.sqlite.prepare("SELECT title FROM runs WHERE id='r'").get()).toEqual({ title: "Synced chat" });
    await offline.stop();
    expect(() => createBridgeReplicator({ ...n.options, config: { ...n.options.config, accountKey: new Uint8Array(32).fill(52) } })).toThrow(/another Bridge account key/);
    expect(() => createBridgeReplicator({ ...n.options, config: { ...n.options.config, backendId: "B" } })).toThrow(/another backend/);
  });
});
