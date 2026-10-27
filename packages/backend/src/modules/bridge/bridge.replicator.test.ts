import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb } from "../../../test/setup-db";
import { disposeBridgeTestHub, getLocalBridgeTestWorker, networkMode } from "../../../test/bridge-hub";
import { createBridgeReplicator, type BridgeReplicatorOptions } from "./bridge.replicator";
import { parseBridgeDevConfig } from "./bridge.config";
import { fixtureHead, fixtureMembership, fixtureSigningKey, signFixtureEnvelope } from "../../../test/bridge-signing";
import { bridgeBase64 } from "@mains/contracts/bridge-auth";
import { BRIDGE_MEMBERSHIP_HEARTBEAT_MS, BRIDGE_REPLAY_HORIZON_MS } from "@mains/contracts/bridge-membership";
import type { BridgeEnvelope } from "@mains/contracts/bridge-protocol";
import type { BridgeMembershipEntry } from "@mains/contracts/bridge-membership";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bridgeRecordKeys, createBridgeSealingCodec } from "./bridge.crypto";
import { deriveBridgeKeys } from "./bridge.keys";
import { deviceSigner, pullBridgeAccountFence, signBridgeMembershipEntry } from "./bridge.membership";
import { toBase64Url } from "./bridge.encoding";
import * as websocket from "./bridge.websocket";
import * as engine from "./bridge.engine";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as blobRecords from "./bridge.blob-records";

const key = new Uint8Array(32).fill(51);
const config = { version: 1, accountId: "account", signingPrivateKey: toBase64Url(fixtureSigningKey("account", "A")), backendId: "A", url: "ws://127.0.0.1:8790/v1/log", token: "test-token", accountKey: toBase64Url(key), label: "MacBook" };
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  try { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); }
  finally { vi.useRealTimers(); vi.restoreAllMocks(); }
});
afterAll(disposeBridgeTestHub);
async function node(account: string, backendId: string, extra: Partial<BridgeReplicatorOptions> = {}) {
  const hub = await getLocalBridgeTestWorker(), fixture = createTestDb(); cleanups.push(fixture.cleanup);
  // The first backend's genesis commits to this test's account key, which replication verifies.
  await hub.admit(account, backendId, key);
  fixture.sqlite.prepare("INSERT INTO accounts(id) VALUES('default')").run();
  fixture.sqlite.prepare("INSERT INTO app_settings(id,account_id,backend_id) VALUES('default','default',?)").run(backendId);
  fixture.sqlite.exec("INSERT INTO providers(id,kind,display_name) VALUES('claude_code','agent_runtime','Claude')");
  // Fake time runs ahead of hub replies on the real socket, so a slow reply must not reach the
  // 15 s request timeout before it lands. Offline tests pass their own short timeout.
  const options: BridgeReplicatorOptions = { sqlite: fixture.sqlite, backendId, autoStart: false, requestTimeoutMs: 3_600_000, config: {
    url: hub.wsUrl, token: await hub.token(account, backendId), accountKey: key, backendId, label: `Computer ${backendId}`, accountId: account, signingPrivateKey: fixtureSigningKey(account, backendId),
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
async function flushBackground(predicate: () => boolean) {
  // Bounded by real time, not turns: hub replies arrive over a real socket at the machine's pace.
  for (const deadline = performance.now() + 10_000; performance.now() < deadline;) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(0);
    if (predicate()) return;
  }
  expect(predicate()).toBe(true);
}
/** Awaits work that makes real HTTP requests while fake timers are installed: the fetch client only
 * completes promptly while fake time keeps moving. */
async function settle<T>(work: Promise<T>): Promise<T> {
  let done = false; const result = work.finally(() => { done = true; });
  while (!done) { await vi.advanceTimersByTimeAsync(25); await new Promise<void>((resolve) => setImmediate(resolve)); }
  return result;
}
async function scheduledPair() {
  const account = randomUUID(), a = await node(account, "A"); run(a); await a.replicator.syncNow();
  const createTransport = websocket.createBridgeWebSocketTransport;
  const hints = vi.fn();
  let receiver!: ReturnType<typeof createTransport>, dropHints = false;
  vi.spyOn(websocket, "createBridgeWebSocketTransport").mockImplementation((options) => {
    const transport = createTransport({ ...options, heartbeatIntervalMs: 3_600_000, onChanged: (stream) => {
      if (options.metadata?.label === "Computer B") hints(stream);
      if (!dropHints) options.onChanged?.(stream);
    } });
    if (options.metadata?.label === "Computer B") receiver = transport;
    return transport;
  });
  // Admit B on real timers: the fixture's HTTP round trips are not what these tests measure.
  await (await getLocalBridgeTestWorker()).admit(account, "B", key);
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const b = await node(account, "B", { autoStart: true });
  await b.replicator.syncNow(); b.replicator.watchRun("r", "view"); await b.replicator.syncNow();
  await flushBackground(() => b.replicator.getStatus().runs.some((run) => run.runId === "r" && run.ready));
  await b.replicator.syncNow();
  const pulls = vi.spyOn(receiver, "pull");
  hints.mockClear();
  return { a, b, pulls, hints, dropHints() { dropHints = true; }, disconnect() { receiver.disconnect(); } };
}

describe("Bridge development configuration", () => {
  it("requires an explicit complete config, keeps dev keys private, and permits disabling it", () => {
    expect(parseBridgeDevConfig(config)).toMatchObject({ backendId: "A", label: "MacBook", accountKey: key });
    expect(parseBridgeDevConfig({ enabled: false })).toBeNull();
    // Membership is verified from the hub's log, never read from the file.
    expect(parseBridgeDevConfig({ ...config, membership: { current: () => null } })).not.toHaveProperty("membership");
  });
  it.each([{ url: "ws://example.com/v1/log" }, { url: "wss://example.com/v1/log?token=x" }, { accountKey: "secret-marker" }, { backendId: "../A" }, { label: " " }, { token: "" }])("rejects unsafe or malformed configuration without echoing credentials (%j)", (change) => {
    expect(() => parseBridgeDevConfig({ ...config, ...change })).toThrow();
    try { parseBridgeDevConfig({ ...config, ...change }); } catch (error) { expect(String(error)).not.toContain("secret-marker"); }
  });
});

describe.skipIf(!networkMode)("Bridge background replication for desktop/server viewers", () => {
  it("keeps unrelated account/run writes and watched pulls live while one account file is damaged", async () => {
    const account = randomUUID(), dataDir = await fs.mkdtemp(join(tmpdir(), "bridge-isolation-"));
    cleanups.push(() => fs.rm(dataDir, { recursive: true, force: true }));
    const a = await node(account, "A"), b = await node(account, "B", { dataDir });
    run(a, "remote"); await a.replicator.syncNow(); await b.replicator.syncNow();
    b.replicator.watchRun("remote", "view"); await b.replicator.syncNow();
    await fs.mkdir(join(dataDir, "atlas/files/damaged"), { recursive: true });
    await fs.writeFile(join(dataDir, "atlas/files/damaged/file.txt"), "wrong bytes");
    b.sqlite.exec("INSERT INTO atlas_items(id,account_id,kind,title,storage_key,content_hash) VALUES('damaged','default','file','Damaged','damaged/file.txt','wrong-hash')");
    run(b, "local"); b.sqlite.exec("INSERT INTO run_artifacts(run_id,kind,content) VALUES('local','report','Healthy local child')");
    a.sqlite.exec("INSERT INTO run_artifacts(run_id,kind,content) VALUES('remote','report','Fresh remote content')"); await a.replicator.syncNow();
    await expect(b.replicator.syncNow()).resolves.toBeUndefined(); await a.replicator.syncNow();
    expect(a.sqlite.prepare("SELECT title FROM runs WHERE id='local'").get()).toEqual({ title: "Synced chat" });
    expect(b.sqlite.prepare("SELECT content FROM run_artifacts WHERE run_id='remote'").get()).toEqual({ content: "Fresh remote content" });
    expect(b.sqlite.prepare("SELECT count(*) n FROM bridge_outbox WHERE stream='run:local'").get()).toEqual({ n: 0 });
    expect(b.replicator.getStatus()).toMatchObject({ error: null, blockedRecordCount: 1,
      blockedRecords: [expect.objectContaining({ table: "atlas_items", pk: "damaged", register: "content", error: expect.stringMatching(/integrity/) })],
      runs: [expect.objectContaining({ runId: "remote", ready: true, error: null })] });
  });
  it("waits for a run's own unpublished root while other run streams advance", async () => {
    const account = randomUUID(), dataDir = await fs.mkdtemp(join(tmpdir(), "bridge-parent-"));
    cleanups.push(() => fs.rm(dataDir, { recursive: true, force: true }));
    const original = blobRecords.createBridgeBlobRecords;
    vi.spyOn(blobRecords, "createBridgeBlobRecords").mockImplementation((options) => {
      const records = original(options), prepare = records.values.prepare;
      records.values.prepare = async (store, entry) => {
        if (entry.table_name === "runs" && entry.pk === "blocked" || entry.table_name === "collections" && entry.pk === "blocked-parent")
          throw new Error("Missing captured parent value");
        return prepare(store, entry);
      };
      return records;
    });
    const a = await node(account, "A", { dataDir });
    run(a, "blocked"); run(a, "ready");
    a.sqlite.exec("INSERT INTO collections(id,account_id,name) VALUES('blocked-parent','default','Parent')");
    run(a, "with-parent"); a.sqlite.exec("UPDATE runs SET collection_id='blocked-parent' WHERE id='with-parent'");
    a.sqlite.exec("INSERT INTO run_artifacts(run_id,kind,content) VALUES('blocked','report','Wait'),('ready','report','Send'),('with-parent','report','Wait for parent')");
    await a.replicator.syncNow();
    expect(a.sqlite.prepare("SELECT synced_seq FROM bridge_row_clock WHERE table_name='runs' AND pk='with-parent'").get()).toEqual({ synced_seq: expect.any(Number) });
    expect(a.sqlite.prepare("SELECT DISTINCT stream FROM bridge_outbox ORDER BY stream").all()).toEqual([{ stream: "account" }, { stream: "run:blocked" }, { stream: "run:with-parent" }]);
  });
  it("paces rate-limited uploads without reporting an error or stopping watched reads", async () => {
    const account = randomUUID(), a = await node(account, "A"), b = await node(account, "B"), hub = await getLocalBridgeTestWorker();
    run(b, "remote"); await b.replicator.syncNow(); await a.replicator.syncNow();
    a.replicator.watchRun("remote", "view"); await a.replicator.syncNow();
    await hub.quotaSql(account, `INSERT INTO write_rate VALUES('A',${Math.floor(Date.now() / 60_000)},600) ON CONFLICT(backend_id) DO UPDATE SET window=excluded.window,count=600`);
    run(a, "queued"); await expect(a.replicator.syncNow()).resolves.toBeUndefined();
    expect(a.replicator.getStatus()).toMatchObject({ state: "syncing", error: null, writeRetryAt: expect.any(String), pendingRecords: 1 });
    b.sqlite.exec("INSERT INTO run_artifacts(run_id,kind,content) VALUES('remote','report','Read while paced')"); await b.replicator.syncNow();
    await a.replicator.syncNow();
    expect(a.sqlite.prepare("SELECT content FROM run_artifacts WHERE run_id='remote'").get()).toEqual({ content: "Read while paced" });
    expect(a.replicator.getStatus().runs).toEqual([{ runId: "remote", ready: true, error: null }]);
  });
  it("applies a removed writer's fenced account records and refuses one a hub inserts after its removal", async () => {
    const account = randomUUID(), hub = await getLocalBridgeTestWorker();
    const a = await node(account, "A"), b = await node(account, "B"), c = await node(account, "C");
    c.sqlite.prepare("INSERT INTO collections(id,account_id,name) VALUES('fenced','default','Before removal')").run();
    await c.replicator.syncNow(); await b.replicator.syncNow();
    expect(b.sqlite.prepare("SELECT name FROM collections WHERE id='fenced'").get()).toEqual({ name: "Before removal" });
    // A removes C with the fence of what its own full read of the account stream returns.
    const view = await fixtureMembership(hub, account, ["A"], key), before = fixtureHead(view), token = await hub.token(account, "A");
    const fence = await pullBridgeAccountFence(hub.wsUrl, token, "C");
    expect(fence.signatures.length).toBeGreaterThan(0);
    const remover = { backendId: "A", signingPublicKey: bridgeBase64(ed25519.getPublicKey(fixtureSigningKey(account, "A"))) };
    const entry = signBridgeMembershipEntry(view.current()!, { kind: "remove", body: { backendId: "C", account: fence.account } }, deviceSigner(remover), fixtureSigningKey(account, "A"));
    const removed = await fetch(new URL("/v1/membership", hub.url), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ entry }) });
    expect(removed.status).toBe(200);
    // A hostile hub stores a record C signed afterwards with its old key, bound to a head before its removal.
    const sealing = createBridgeSealingCodec(key), stored = (await hub.inspect(account) as { envelope: string }[]).map((row) => JSON.parse(row.envelope) as BridgeEnvelope);
    const original = stored.find((record) => record.header.origin === "C" && sealing.open(record).body.table === "collections")!;
    const opened = sealing.open(original).body as { values: Record<string, unknown> }, routing = bridgeRecordKeys(deriveBridgeKeys(key).recordKey, "collections", "injected", "row");
    const injected = signFixtureEnvelope(account, sealing.seal({ ...original.header, rowKey: routing.rowKey, registerKey: routing.registerKey!, hlc: { physicalMs: Date.now(), counter: 0 } } as BridgeEnvelope["header"],
      { ...opened, pk: "injected", values: { ...opened.values, id: "injected", name: "After removal" } } as never), before);
    const [{ seq }] = await hub.quotaSql(account, "SELECT seq FROM streams WHERE stream='account'") as { seq: number }[];
    await hub.quotaSql(account, `INSERT INTO log(stream,seq,row_key,register_key,op,envelope) VALUES('account',${seq + 1},'${routing.rowKey}','${routing.registerKey}','upsert','${JSON.stringify(injected)}')`);
    await hub.quotaSql(account, `UPDATE streams SET seq=${seq + 1} WHERE stream='account'`);
    // A device that never saw C's records gets exactly what the fence admits.
    const d = await node(account, "D"); await d.replicator.syncNow();
    expect(d.sqlite.prepare("SELECT id FROM collections WHERE id IN ('fenced','injected')").all()).toEqual([{ id: "fenced" }]);
    expect(d.replicator.getStatus().error).toBeNull();
    // B learns of the removal from the first record bound after it, before applying anything on that page.
    a.sqlite.prepare("INSERT INTO collections(id,account_id,name) VALUES('after','default','Bound after removal')").run();
    await a.replicator.syncNow(); await b.replicator.syncNow();
    expect(b.sqlite.prepare("SELECT id FROM collections WHERE id IN ('after','injected') ORDER BY id").all()).toEqual([{ id: "after" }]);
  });
  it("signs a journaled write again on the current head once the replay horizon passes the head it bound", async () => {
    const account = randomUUID(), hub = await getLocalBridgeTestWorker(), createTransport = websocket.createBridgeWebSocketTransport;
    let offline = true;
    vi.spyOn(websocket, "createBridgeWebSocketTransport").mockImplementation((options) => {
      const transport = createTransport(options), push = transport.push;
      if (options.metadata?.label === "Computer A") transport.push = async (...args) => { if (offline) throw new Error("Bridge connection closed"); return push(...args); };
      return transport;
    });
    const a = await node(account, "A"), b = await node(account, "B");
    a.sqlite.prepare("INSERT INTO collections(id,account_id,name) VALUES('queued','default','Written offline')").run();
    await expect(a.replicator.syncNow()).rejects.toThrow(/connection/);
    const journaled = a.sqlite.prepare("SELECT envelope FROM bridge_publications WHERE table_name='collections'").get() as { envelope: string };
    const bound = (JSON.parse(journaled.envelope) as BridgeEnvelope).auth!.membership.seq;
    // A long time offline: membership moved on, and the head the write bound is now below the horizon.
    await hub.admit(account, "C");
    await hub.quotaSql(account, `UPDATE membership SET appended_at=appended_at-${BRIDGE_REPLAY_HORIZON_MS + 60_000}`);
    offline = false; await a.replicator.syncNow(); await b.replicator.syncNow();
    expect(b.sqlite.prepare("SELECT name FROM collections WHERE id='queued'").get()).toEqual({ name: "Written offline" });
    expect(a.replicator.getStatus()).toMatchObject({ error: null, pendingRecords: 0 });
    const stored = (await hub.inspect(account) as { envelope: string }[]).map((row) => JSON.parse(row.envelope) as BridgeEnvelope).filter((record) => record.header.origin === "A");
    expect(Math.min(...stored.map((record) => record.auth!.membership.seq))).toBeGreaterThan(bound);
  });
  it("appends one horizon checkpoint once membership has been quiet for a week", async () => {
    const account = randomUUID(), hub = await getLocalBridgeTestWorker(), a = await node(account, "A"), b = await node(account, "B");
    const log = async () => (await (await fetch(new URL("/v1/membership?after=-1", hub.url), { headers: { Authorization: `Bearer ${await hub.token(account, "A")}` } })).json()).entries as BridgeMembershipEntry[];
    await b.replicator.syncNow();
    expect((await log()).map((entry) => entry.kind)).toEqual(["genesis", "add"]);
    await hub.quotaSql(account, `UPDATE membership SET appended_at=appended_at-${BRIDGE_MEMBERSHIP_HEARTBEAT_MS + 60_000}`);
    await a.replicator.syncNow();
    // B then sees a fresh head and has nothing to add.
    await b.replicator.syncNow(); await new Promise<void>((resolve) => setTimeout(resolve, 100));
    const entries = await log();
    expect(entries.map((entry) => entry.kind)).toEqual(["genesis", "add", "checkpoint"]);
    expect(entries[2].signer).toMatchObject({ kind: "device", backendId: "A" });
  });
  it("stops before applying a page whose records bind another membership history", async () => {
    const account = randomUUID(), a = await node(account, "A"); run(a, "forked"); await a.replicator.syncNow();
    const b = await node(account, "B"), hub = await getLocalBridgeTestWorker(), other = "A".repeat(43);
    for (const table of ["log", "latest"]) await hub.quotaSql(account, `UPDATE ${table} SET envelope=json_set(envelope,'$.auth.membership.hash','${other}')`);
    await expect(b.replicator.syncNow()).rejects.toThrow(/membership conflict/);
    expect(b.sqlite.prepare("SELECT 1 FROM runs WHERE id='forked'").get()).toBeUndefined();
    expect(b.replicator.getStatus().error).toMatch(/membership conflict/);
  });
  it("reuses verified membership for live change hints and refreshes it for a writer admitted later", async () => {
    const f = await scheduledPair(), fetches = vi.spyOn(globalThis, "fetch");
    const membershipCalls = () => fetches.mock.calls.filter(([url, options]) => new URL(String(url)).pathname === "/v1/membership" &&
      new Headers(options?.headers).get("Authorization") === `Bearer ${f.b.options.config.token}`).length;
    for (let i = 0; i < 3; i++) {
      f.a.sqlite.prepare("INSERT INTO run_artifacts(run_id,kind,content) VALUES('r','report',?)").run(`Live ${i}`);
      await f.a.replicator.syncNow();
      await flushBackground(() => !!f.b.sqlite.prepare("SELECT 1 FROM run_artifacts WHERE content=?").get(`Live ${i}`));
    }
    expect(membershipCalls()).toBe(0);
    // C's admission is announced to open sockets, and its records bind the head that admitted it.
    const c = await settle(node(f.a.options.config.accountId, "C")); run(c, "new-writer"); await settle(c.replicator.syncNow());
    await flushBackground(() => !!f.b.sqlite.prepare("SELECT 1 FROM runs WHERE id='new-writer'").get());
    expect(membershipCalls()).toBeGreaterThanOrEqual(1); expect(membershipCalls()).toBeLessThanOrEqual(2);
    expect(f.b.replicator.getStatus().error).toBeNull();
  });
  it("publishes local writes without re-pulling watched streams or notifying its own socket", async () => {
    const f = await scheduledPair();
    run(f.a, "r2"); await f.a.replicator.syncNow();
    await flushBackground(() => !!f.b.sqlite.prepare("SELECT 1 FROM runs WHERE id='r2'").get());
    f.b.replicator.watchRun("r2", "second-view"); await f.b.replicator.syncNow();
    f.pulls.mockClear(); f.hints.mockClear();
    run(f.b, "local-write"); f.b.replicator.wake();
    await vi.advanceTimersByTimeAsync(1);
    await flushBackground(() => f.b.replicator.getStatus().pendingRecords === 0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.pulls).not.toHaveBeenCalled(); expect(f.hints).not.toHaveBeenCalled();
    f.a.sqlite.exec("INSERT INTO run_artifacts(run_id,kind,content) VALUES('r','report','One changed stream')");
    await f.a.replicator.syncNow();
    await flushBackground(() => !!f.b.sqlite.prepare("SELECT 1 FROM run_artifacts WHERE content='One changed stream'").get());
    expect(f.pulls.mock.calls.map(([stream]) => stream)).toEqual(["account", "run:r"]);
  });
  it("does not postpone a lost-hint safety read while continuously publishing local changes", async () => {
    const f = await scheduledPair(); f.dropHints();
    f.a.sqlite.exec("INSERT INTO run_artifacts(run_id,kind,content) VALUES('r','report','Missed while publishing')");
    await f.a.replicator.syncNow();
    for (let i = 1; i <= 9; i++) {
      await vi.advanceTimersByTimeAsync(30_000); f.b.replicator.watchRun("r", "view");
      run(f.b, `local-${i}`); f.b.replicator.wake(); await vi.advanceTimersByTimeAsync(0);
      await flushBackground(() => f.b.replicator.getStatus().pendingRecords === 0 && f.b.replicator.getStatus().lastSyncedAt === new Date().toISOString());
    }
    await vi.advanceTimersByTimeAsync(29_999); expect(f.pulls).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await flushBackground(() => !!f.b.sqlite.prepare("SELECT 1 FROM run_artifacts WHERE content='Missed while publishing'").get());
    expect(f.pulls).toHaveBeenCalled();
  });
  it("keeps idle and watched streams quiet for five minutes, including lease renewal, and applies change hints immediately", async () => {
    const { a, b, pulls } = await scheduledPair();
    for (let i = 0; i < 9; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
      b.replicator.watchRun("r", "view"); // Renewing a UI lease must not poll the hub.
    }
    await vi.advanceTimersByTimeAsync(29_999);
    expect(pulls).not.toHaveBeenCalled();
    a.sqlite.exec("INSERT INTO run_artifacts(run_id,kind,content) VALUES('r','report','Hint-driven content')");
    await a.replicator.syncNow();
    await flushBackground(() => !!b.sqlite.prepare("SELECT 1 FROM run_artifacts WHERE content='Hint-driven content'").get());
    expect(pulls).toHaveBeenCalled();
  });
  it("recovers a missed hint at five minutes and discovers local writes with no pull", async () => {
    const f = await scheduledPair(); f.dropHints();
    f.a.sqlite.exec("INSERT INTO run_artifacts(run_id,kind,content) VALUES('r','report','Missed hint')");
    await settle(f.a.replicator.syncNow());
    for (let i = 0; i < 9; i++) { await vi.advanceTimersByTimeAsync(30_000); f.b.replicator.watchRun("r", "view"); }
    await vi.advanceTimersByTimeAsync(29_999);
    expect(f.pulls).not.toHaveBeenCalled();
    expect(f.b.sqlite.prepare("SELECT 1 FROM run_artifacts WHERE content='Missed hint'").get()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await flushBackground(() => !!f.b.sqlite.prepare("SELECT 1 FROM run_artifacts WHERE content='Missed hint'").get());
    await settle(f.b.replicator.syncNow()); // Let the fallback cycle finish before the next local write.
    // Direct SQLite writers need no renderer event to enter the durable outbox.
    run(f.b, "local-write"); f.pulls.mockClear();
    await vi.advanceTimersByTimeAsync(1000);
    await flushBackground(() => f.b.replicator.getStatus().pendingRecords === 0);
    expect(f.pulls).not.toHaveBeenCalled();
    await settle(f.a.replicator.syncNow());
    expect(f.a.sqlite.prepare("SELECT owner_backend_id FROM runs WHERE id='local-write'").get()).toEqual({ owner_backend_id: "B" });
  });
  it("reconnects promptly after an idle socket closes instead of waiting for the safety poll", async () => {
    const f = await scheduledPair(); f.disconnect();
    expect(f.b.replicator.getStatus().state).toBe("offline");
    f.a.sqlite.exec("INSERT INTO run_artifacts(run_id,kind,content) VALUES('r','report','During disconnect')");
    await f.a.replicator.syncNow();
    await vi.advanceTimersByTimeAsync(999); expect(f.pulls).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await flushBackground(() => !!f.b.sqlite.prepare("SELECT 1 FROM run_artifacts WHERE content='During disconnect'").get());
    expect(f.pulls).toHaveBeenCalled();
  });
  it("retains exponential failure backoff despite the one-second local outbox check", async () => {
    const n = await node(randomUUID(), "A"); await n.replicator.stop(); run(n);
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const token = vi.fn().mockResolvedValue("test-token");
    const offline = createBridgeReplicator({ ...n.options, autoStart: true, token,
      config: { ...n.options.config, url: "ws://127.0.0.1:1/v1/log" }, requestTimeoutMs: 100 });
    cleanups.push(() => offline.stop());
    await expect(offline.syncNow()).rejects.toThrow(/connection/i);
    let attempts = 1;
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      await vi.advanceTimersByTimeAsync(delay - 1); expect(token).toHaveBeenCalledTimes(attempts);
      await vi.advanceTimersByTimeAsync(1); attempts++;
      await flushBackground(() => token.mock.calls.length === attempts && offline.getStatus().state === "offline");
    }
    expect(offline.getStatus().pendingRecords).toBeGreaterThan(0);
  });
  it("backs off a queued change that sends nothing, yet publishes a new local write within a second", async () => {
    const createEngine = engine.createBridgeEngine, createTransport = websocket.createBridgeWebSocketTransport, attempts = vi.fn();
    vi.spyOn(websocket, "createBridgeWebSocketTransport").mockImplementation((options) => createTransport({ ...options, heartbeatIntervalMs: 3_600_000 }));
    vi.spyOn(engine, "createBridgeEngine").mockImplementation((options) => {
      const real = createEngine(options);
      // Like a change whose files can never be prepared: no error and no progress.
      return { ...real, push: (stream = "account", limit = 100, deletesOnly = false) =>
        stream === "run:stuck" ? (attempts(), Promise.resolve(0)) : real.push(stream, limit, deletesOnly) };
    });
    const n = await node(randomUUID(), "A"); await n.replicator.stop();
    run(n, "stuck"); n.sqlite.exec("INSERT INTO run_artifacts(run_id,kind,content) VALUES('stuck','report','Never sendable')");
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const replicator = createBridgeReplicator({ ...n.options, autoStart: true }); cleanups.push(() => replicator.stop());
    await replicator.syncNow(); expect(attempts).toHaveBeenCalledTimes(1);
    let count = 1;
    for (const delay of [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]) {
      await vi.advanceTimersByTimeAsync(delay - 1); expect(attempts).toHaveBeenCalledTimes(count);
      await vi.advanceTimersByTimeAsync(1); count++;
      await flushBackground(() => attempts.mock.calls.length === count && replicator.getStatus().lastSyncedAt === new Date().toISOString());
    }
    run(n, "fresh");
    await vi.advanceTimersByTimeAsync(1000);
    await flushBackground(() => !n.sqlite.prepare("SELECT 1 FROM bridge_outbox WHERE stream='account'").get());
    expect(replicator.getStatus()).toMatchObject({ error: null, pendingRecords: 1 });
  });
  it("leaves inactive changes queued without repeated uploads or quota queries and resumes after the renewal refresh", async () => {
    const original = globalThis.fetch, now = Date.now(), clock = vi.spyOn(Date, "now").mockReturnValue(now);
    let active = false;
    const fetches = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
      const response = await original(url, options);
      if (new URL(String(url)).pathname !== "/v1/quota") return response;
      return Response.json({ ...await response.json(), subscription: { status: active ? "active" : "expired", canUpload: active, planId: "standard", billingInterval: "monthly",
        startsAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(active ? now + 120_000 : now - 1).toISOString() } });
    });
    const quotaRequests = () => fetches.mock.calls.filter(([url]) => new URL(String(url)).pathname === "/v1/quota").length;
    const account = randomUUID(), a = await node(account, "A");
    await a.replicator.syncNow(); expect(a.replicator.getStatus().state).toBe("read-only");
    run(a);
    for (let i = 0; i < 20; i++) await a.replicator.syncNow();
    expect(quotaRequests()).toBe(1);
    expect(a.replicator.getStatus()).toMatchObject({ state: "read-only", pendingRecords: 1, error: null });
    active = true; clock.mockReturnValue(now + 60_001);
    await a.replicator.syncNow();
    expect(quotaRequests()).toBe(2);
    expect(a.replicator.getStatus()).toMatchObject({ state: "connected", pendingRecords: 0, error: null });
    const b = await node(account, "B"); await b.replicator.syncNow();
    expect(b.sqlite.prepare("SELECT title FROM runs WHERE id='r'").get()).toEqual({ title: "Synced chat" });
    // Even a previously active local cache cannot display upload access past its period.
    clock.mockReturnValue(now + 120_001);
    expect(a.replicator.getStatus()).toMatchObject({ state: "read-only", quota: { subscription: { status: "expired", canUpload: false } } });
  });
  it("samples quota after writes, skips idle polling and coalesces live updates to one request per minute", async () => {
    const fetches = vi.spyOn(globalThis, "fetch"), now = Date.now(), clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const quotaRequests = () => fetches.mock.calls.filter(([url]) => new URL(String(url)).pathname === "/v1/quota").length;
    const a = await node(randomUUID(), "A");
    await a.replicator.syncNow(); await a.replicator.syncNow();
    expect(quotaRequests()).toBe(1);
    expect(a.replicator.getStatus().quota!.recordBytes).toBeGreaterThan(0);
    for (let i = 1; i <= 10; i++) { clock.mockReturnValue(now + i * 60_000); await a.replicator.syncNow(); }
    expect(quotaRequests()).toBe(1);
    run(a); await a.replicator.syncNow();
    expect(quotaRequests()).toBe(2);
    const sampled = a.replicator.getStatus().quota!.usedBytes;
    for (let i = 0; i < 5; i++) {
      a.sqlite.prepare("UPDATE runs SET title=? WHERE id='r'").run(`Change ${i} ${"x".repeat(200)}`);
      await a.replicator.syncNow();
    }
    expect(quotaRequests()).toBe(2);
    clock.mockReturnValue(now + 11 * 60_000); await a.replicator.syncNow();
    expect(quotaRequests()).toBe(3);
    expect(a.replicator.getStatus().quota!.usedBytes).toBeGreaterThan(sampled);
  });
  it("keeps replication working and backs off optional quota sampling when that endpoint fails", async () => {
    const original = globalThis.fetch;
    const fetches = vi.spyOn(globalThis, "fetch").mockImplementation((url, options) =>
      new URL(String(url)).pathname === "/v1/quota" ? Promise.resolve(new Response("Unavailable", { status: 503 })) : original(url, options));
    const a = await node(randomUUID(), "A");
    run(a); await a.replicator.syncNow();
    for (let i = 0; i < 5; i++) await a.replicator.syncNow();
    expect(a.replicator.getStatus()).toMatchObject({ state: "connected", pendingRecords: 0, quota: null });
    expect(fetches.mock.calls.filter(([url]) => new URL(String(url)).pathname === "/v1/quota")).toHaveLength(1);
  });
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
