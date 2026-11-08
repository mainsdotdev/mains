import { afterEach, describe, expect, it, vi } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bridgeBase64 } from "@mains/contracts/bridge-auth";
import { verifyBridgeMembershipLog } from "@mains/contracts/bridge-membership";
import { createTestDb } from "../../../test/setup-db";
import { fixtureSigningKey } from "../../../test/bridge-signing";
import { bridgeAccountKeyCommitment, generateBridgeDeviceKeyPair } from "./bridge.keys";
import { createBridgeMembershipView, deviceSigner, signBridgeMembershipEntry, verifyBridgeSignature } from "./bridge.membership";
import { createMemoryBridgeHub } from "./bridge.transport";
import { createBridgeReplicator, type BridgeReplicatorOptions } from "./bridge.replicator";
import { createBridgeEngine } from "./bridge.engine";
import { createBridgeSealingCodec } from "./bridge.crypto";
import { createBridgeSigningCodec } from "./bridge.signing";
import { deriveBridgeKeys } from "./bridge.keys";
import * as websocket from "./bridge.websocket";

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

/** Real capture/SQLite/codec/engine; only the hub's network boundary is replaced. */
async function fixture(extra: Partial<BridgeReplicatorOptions> = {}) {
  const db = createTestDb(); cleanup.push(db.cleanup);
  const sqlite = db.sqlite, hub = createMemoryBridgeHub(), raw = hub.connect("A");
  sqlite.exec("INSERT INTO accounts(id) VALUES('default'); INSERT INTO app_settings(id,account_id,backend_id) VALUES('default','default','A')");
  const accountKey = new Uint8Array(32).fill(19), secret = fixtureSigningKey("account", "A");
  const member = { backendId: "A", publicKey: bridgeBase64(generateBridgeDeviceKeyPair().publicKey), signingPublicKey: bridgeBase64(ed25519.getPublicKey(secret)) };
  const genesis = signBridgeMembershipEntry({ accountId: "account", seq: -1, head: null }, { kind: "genesis", body: {
    member, recoverySigningPublicKey: bridgeBase64(ed25519.getPublicKey(fixtureSigningKey("account", "recovery"))), accountKeyCommitment: bridgeAccountKeyCommitment(accountKey),
  } }, deviceSigner(member), secret);
  const first = await verifyBridgeMembershipLog([genesis], verifyBridgeSignature), peerSecret = fixtureSigningKey("account", "B");
  const admission = signBridgeMembershipEntry(first, { kind: "add", body: { via: "approval", member: { backendId: "B",
    publicKey: bridgeBase64(generateBridgeDeviceKeyPair().publicKey), signingPublicKey: bridgeBase64(ed25519.getPublicKey(peerSecret)),
  } } }, deviceSigner(member), secret);
  const entries = [genesis, admission], state = await verifyBridgeMembershipLog(entries, verifyBridgeSignature);
  const membership = createBridgeMembershipView({ hubUrl: "http://localhost", token: async () => "test", accountId: "account",
    accountKeyCommitment: state.accountKeyCommitment, initial: { state, entries } });
  const remote = { offline: false, canUpload: true };
  let callbacks!: websocket.BridgeWebSocketOptions;
  const check = () => { if (remote.offline) throw new Error("Bridge connection closed"); };
  const gateway = {
    subscribe: vi.fn(async () => { callbacks.onStatusChange?.("connecting"); check(); callbacks.onStatusChange?.("connected"); }),
    push: vi.fn<typeof raw.push>(async (...args) => { check(); return raw.push(...args); }),
    pull: vi.fn<typeof raw.pull>(async (...args) => { check(); return raw.pull(...args); }),
    compact: vi.fn(async () => {}), disconnect: vi.fn(() => callbacks.onStatusChange?.("offline")), close: vi.fn(),
  };
  vi.spyOn(websocket, "createBridgeWebSocketTransport").mockImplementation((options) => { callbacks = options; return gateway; });
  vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
    if (url.pathname === "/v1/membership") return Response.json({ entries: entries.filter((entry) => entry.seq > Number(url.searchParams.get("after"))) });
    if (url.pathname === "/v1/quota") return Response.json({ plan: "test", limitBytes: 1000000, usedBytes: 0, recordBytes: 0, blobBytes: 0,
      reservedBytes: 0, fileLimitBytes: 1000000, writesPerMinute: 600,
      subscription: { status: remote.canUpload ? "active" : "expired", canUpload: remote.canUpload, planId: "standard", billingInterval: "monthly", startsAt: null, expiresAt: null } });
    throw new Error(`Unexpected hub request ${url.pathname}`);
  }));
  const replicator = createBridgeReplicator({ sqlite, backendId: "A", autoStart: false,
    config: { url: "ws://localhost/v1/log", token: "test", accountId: "account", backendId: "A", label: "A", accountKey, signingPrivateKey: secret, membership }, ...extra });
  cleanup.push(() => replicator.stop());
  async function peer() {
    const db = createTestDb(); cleanup.push(db.cleanup);
    db.sqlite.exec("INSERT INTO accounts(id) VALUES('default'); INSERT INTO app_settings(id,account_id,backend_id) VALUES('default','default','B')");
    const engine = createBridgeEngine({ sqlite: db.sqlite, backendId: "B", recordKey: deriveBridgeKeys(accountKey).recordKey, transport: hub.connect("B"),
      codec: createBridgeSigningCodec(createBridgeSealingCodec(accountKey), { accountId: "account", backendId: "B", signingPrivateKey: peerSecret }, membership) });
    cleanup.push(() => engine.stop()); await engine.bootstrap();
    return { sqlite: db.sqlite, engine };
  }
  return { sqlite, hub, raw, remote, gateway, replicator, peer, hints: () => callbacks };
}

describe("Bridge sync ownership", () => {
  it("keeps normal writes queued while read-only, but applies remote changes and publishes tombstones", async () => {
    const f = await fixture(); await f.replicator.syncNow();
    f.sqlite.exec("INSERT INTO collections(id,account_id,name) VALUES('remove','default','Remove')"); await f.replicator.syncNow();
    f.remote.canUpload = false; await f.replicator.syncNow(true);
    const peer = await f.peer();
    peer.sqlite.exec("INSERT INTO collections(id,account_id,name) VALUES('incoming','default','From B')"); await peer.engine.push();
    f.sqlite.exec("INSERT INTO collections(id,account_id,name) VALUES('queued','default','Unsent'); DELETE FROM collections WHERE id='remove'");
    f.gateway.push.mockClear();
    await f.replicator.syncNow();
    expect(f.replicator.getStatus()).toMatchObject({ state: "read-only", pendingRecords: 1, error: null });
    expect(f.sqlite.prepare("SELECT name FROM collections WHERE id='incoming'").get()).toEqual({ name: "From B" });
    expect(f.gateway.push).toHaveBeenCalled();
    expect(f.gateway.push.mock.calls.flatMap(([, records]) => records).every((record) => record.header.op === "delete")).toBe(true);
    await peer.engine.pull();
    expect(peer.sqlite.prepare("SELECT id FROM collections WHERE id IN ('remove','queued')").all()).toEqual([]);
    f.remote.canUpload = true; await f.replicator.syncNow(true);
    expect(f.replicator.getStatus()).toMatchObject({ state: "connected", pendingRecords: 0 });
  });

  it("ignores retired presence and approval callbacks after stop", async () => {
    const changed = vi.fn(), approval = vi.fn(), access = vi.fn();
    const f = await fixture({ onStatus: changed, onApproval: approval, onAccessChanged: access });
    await f.replicator.syncNow(); await f.replicator.stop(); vi.clearAllMocks();
    f.hints().onPresence?.({ type: "presence", backendId: "late-peer", online: true, lastSeen: new Date().toISOString() });
    f.hints().onApproval?.({ requestId: "late-approval", backendId: "late-peer", label: "Late peer", platform: "test",
      publicKey: bridgeBase64(new Uint8Array(32).fill(1)), signingPublicKey: bridgeBase64(new Uint8Array(32).fill(2)),
      code: "ABCD-EFGH-JKLM", expiresAt: new Date(Date.now() + 60_000).toISOString() });
    f.hints().onAccessChanged?.();
    expect(f.replicator.getStatus().backends.some((peer) => peer.backendId === "late-peer")).toBe(false);
    expect(changed).not.toHaveBeenCalled(); expect(approval).not.toHaveBeenCalled(); expect(access).not.toHaveBeenCalled();
    f.sqlite.close();
    await expect(f.replicator.syncNow()).rejects.toThrow(/stopped/);
  });

  it("retires the old batch drain when pause is followed by resume during its ACK", async () => {
    const f = await fixture(); await f.replicator.syncNow(); vi.clearAllMocks();
    for (let i = 0; i < 101; i++) f.sqlite.prepare("INSERT INTO collections(id,account_id,name) VALUES(?,'default',?)").run(`item-${i}`, `Item ${i}`);
    let entered!: () => void, release!: () => void;
    const entering = new Promise<void>((resolve) => { entered = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    f.gateway.push.mockImplementationOnce(async (...args) => { const ack = await f.raw.push(...args); entered(); await blocked; return ack; });
    const syncing = f.replicator.syncNow(); await entering;
    const pausing = f.replicator.pause(); f.replicator.resume(); release();
    await syncing; await pausing;
    expect(f.gateway.push).toHaveBeenCalledOnce();
    expect(f.replicator.getStatus().pendingRecords).toBe(1);
    await f.replicator.syncNow();
    expect(f.replicator.getStatus().pendingRecords).toBe(0);
  });

  it("claims a cycle before status listeners can request another sync", async () => {
    let nested: Promise<void> | undefined, reentered = false;
    const f = await fixture({ onStatus() {
      if (!reentered) { reentered = true; nested = f.replicator.syncNow(); }
    } });
    await f.replicator.syncNow(); await nested;
    expect(f.gateway.subscribe).toHaveBeenCalledOnce();
    expect(f.replicator.getStatus()).toMatchObject({ state: "connected", error: null, pendingRecords: 0 });
  });

  it("keeps connection backoff despite repeated local wake requests", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const f = await fixture({ autoStart: true }); await f.replicator.syncNow();
    f.remote.offline = true;
    await expect(f.replicator.syncNow()).rejects.toThrow(/connection/);
    vi.clearAllMocks();
    for (let i = 0; i < 9; i++) { f.replicator.wake(); await vi.advanceTimersByTimeAsync(100); }
    expect(f.gateway.subscribe).not.toHaveBeenCalled(); expect(f.gateway.pull).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(f.gateway.subscribe).toHaveBeenCalledOnce();
    for (let i = 0; i < 19; i++) { f.replicator.wake(); await vi.advanceTimersByTimeAsync(100); }
    expect(f.gateway.subscribe).toHaveBeenCalledOnce();
  });
});
