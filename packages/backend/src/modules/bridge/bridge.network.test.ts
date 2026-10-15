import { afterAll, afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { BridgeHeader } from "@mains/contracts/bridge-protocol";
import { createTestDb } from "../../../test/setup-db";
import { getLocalBridgeTestWorker, networkMode, disposeBridgeTestHub } from "../../../test/bridge-hub";
import { createBridgeEngine } from "./bridge.engine";
import { createBridgeWebSocketTransport, type BridgeWebSocketOptions } from "./bridge.websocket";
import { bridgeRecordKeys, createBridgeSealingCodec } from "./bridge.crypto";
import { deriveBridgeKeys } from "./bridge.keys";

const accountKey = new Uint8Array(32).fill(31), keys = deriveBridgeKeys(accountKey), codec = createBridgeSealingCodec(accountKey);
const clients: ReturnType<typeof createBridgeWebSocketTransport>[] = [], cleanup: (() => void)[] = [];
afterEach(() => { for (const client of clients.splice(0)) client.close(); for (const fn of cleanup.splice(0)) fn(); });
afterAll(disposeBridgeTestHub);
async function client(accountId: string, backendId: string, extra: Partial<BridgeWebSocketOptions> = {}) {
  const hub = await getLocalBridgeTestWorker();
  const connection = createBridgeWebSocketTransport({ url: hub.wsUrl, token: () => hub.token(accountId, backendId), ...extra });
  clients.push(connection); return connection;
}
function envelope(id: string, counter = 0, op: "upsert" | "delete" = "upsert", text = "private-marker-şifreli") {
  const routing = bridgeRecordKeys(keys.recordKey, "collections", id, op === "upsert" ? "row" : undefined);
  const base = { v: 1 as const, stream: "account" as const, rowKey: routing.rowKey, hlc: { physicalMs: 1700000000000, counter }, origin: "A" };
  const header: BridgeHeader = op === "upsert" ? { ...base, op, registerKey: routing.registerKey! } : { ...base, op };
  return codec.seal(header, op === "delete" ? { table: "collections", pk: id } : { table: "collections", pk: id, register: "row", schemaVersion: 1, values: { secret: text }, refs: {}, blobRefs: [] });
}
const waitFor = async (predicate: () => boolean) => { for (let i=0; i<100 && !predicate(); i++) await new Promise((resolve) => setTimeout(resolve, 20)); expect(predicate()).toBe(true); };

describe.skipIf(!networkMode)("Bridge real network and encrypted persistence", () => {
  it("stores ciphertext only in the Durable Object's actual SQLite, and retains exact tombstones across restart/compaction", async () => {
    const account = randomUUID(), hub = await getLocalBridgeTestWorker(), a = await client(account, "A");
    const upsert = envelope("private-row"), tombstone = envelope("private-row", 1, "delete");
    await a.push("account", [upsert]);
    const stored = JSON.stringify(await hub.inspect(account));
    expect(stored).toContain(upsert.body.payload); expect(stored).not.toContain("private-marker"); expect(stored).not.toContain("private-row"); expect(stored).not.toContain("collections");
    await a.push("account", [tombstone]); await a.compact(); a.close(); await hub.restart();
    const b = await client(account, "B"); const page = await b.pull("account", 0, 100);
    expect(page.records).toHaveLength(1); expect(page.records[0].envelope).toEqual(tombstone);
    expect(codec.open(page.records[0].envelope).body).toEqual({ table: "collections", pk: "private-row" });
    const writer = await client(account, "A"); expect(await writer.push("account", [upsert])).toEqual([{ deleted: tombstone }]);
  });
  it("isolates accounts and binds the authenticated backend independently from the plaintext origin claim", async () => {
    const first = randomUUID(), a = await client(first, "A"), b = await client(randomUUID(), "B");
    await a.push("account", [envelope("same-row")]); expect((await b.pull("account", 0, 100)).records).toEqual([]);
    const attacker = await client(first, "B"); expect(await attacker.push("account", [envelope("another")])).toEqual([{ error: "notOwner" }]);
    const hub = await getLocalBridgeTestWorker(), invalid = await client(first, "B", { token: "invalid" });
    await expect(invalid.pull("account", 0, 10)).rejects.toThrow(/connection/i);
    const expired = await client(first, "A", { token: await hub.token(first, "A", "-1s") });
    await expect(expired.pull("account", 0, 10)).rejects.toThrow(/connection/i);
  });
  it("delivers account-scoped presence and live hints, and preserves subscriptions through DO hibernation", async () => {
    const account = randomUUID(), hub = await getLocalBridgeTestWorker();
    const presence: { backendId: string; online: boolean }[] = [], changed: string[] = [];
    const b = await client(account, "B", { onPresence: (value) => presence.push(value), onChanged: (stream) => changed.push(stream) });
    await b.subscribe(["account"]); const a = await client(account, "A"); await a.push("account", [envelope("live")]);
    await waitFor(() => changed.includes("account") && presence.some((p) => p.backendId === "A" && p.online));
    changed.length=0; await hub.evict(account); await a.push("account", [envelope("after-hibernation")]);
    await waitFor(() => changed.includes("account")); a.close();
    await waitFor(() => presence.some((p) => p.backendId === "A" && !p.online));
  });
  it("restores the client subscription on reconnect and continues from a durable pull cursor", async () => {
    const account = randomUUID(), a = await client(account, "A"), events: string[] = [], b = await client(account, "B", { onChanged: (stream) => events.push(stream) });
    await b.subscribe(["account"]); await a.push("account", [envelope("one")]); const first = await b.pull("account", 0, 1);
    b.disconnect(); await waitFor(() => events.length>0); await new Promise((r) => setTimeout(r, 30));
    await b.pull("account", first.next, 100); events.length = 0;
    await a.push("account", [envelope("two")]); await waitFor(() => events.length>0);
    expect((await b.pull("account", first.next, 100)).records.map((r) => codec.open(r.envelope).body.pk)).toEqual(["two"]);
  });
  it("refuses a plaintext downgrade before any record is sent, and batches large record counts safely", async () => {
    const account = randomUUID(), a = await client(account, "A");
    const clear = envelope("bad"); clear.body = { nonce: null, payload: "plaintext" };
    await expect(a.push("account", [clear])).rejects.toThrow(/encrypted/); expect((await a.pull("account", 0, 10)).records).toEqual([]);
    const records = Array.from({ length: 205 }, (_, i) => envelope(`row-${i}`));
    expect(await a.push("account", records)).toHaveLength(205);
    expect((await a.pull("account", 0, 1000)).records).toHaveLength(205);
  });
  it("persists near-limit ciphertext and paginates by bytes without skipping records", async () => {
    const account = randomUUID(), a = await client(account, "A"), b = await client(account, "B");
    const records = Array.from({ length: 18 }, (_, index) => envelope(`large-${index}`, index, "upsert", "x".repeat(750_000)));
    expect(await a.push("account", records)).toHaveLength(records.length);
    const first = await b.pull("account", 0, 1000);
    expect(first.hasMore).toBe(true); expect(first.records.length).toBeGreaterThan(0); expect(first.records.length).toBeLessThan(records.length);
    const second = await b.pull("account", first.next, 1000);
    expect(second.hasMore).toBe(false);
    expect([...first.records, ...second.records].map((entry) => entry.envelope.header.rowKey)).toEqual(records.map((entry) => entry.header.rowKey));
    expect(() => envelope("oversized", 0, "upsert", "x".repeat(800_000))).toThrow(/encrypted/);
  });
  it("does not apply tampered ciphertext or tombstones, advance a cursor, or erase a local draft", async () => {
    const account = randomUUID(), a = await client(account, "A"), b = await client(account, "B");
    const fixture = createTestDb(); cleanup.push(fixture.cleanup); const db = fixture.sqlite;
    db.exec("INSERT INTO accounts(id) VALUES('default'); INSERT INTO app_settings(id,account_id,backend_id) VALUES('default','default','B')");
    let corrupt = false;
    const transport = { push: b.push, async pull(stream: "account" | `run:${string}`, after: number, limit: number) {
      const page = await b.pull(stream, after, limit);
      if (corrupt) for (const record of page.records) { const value = record.envelope.body.payload; record.envelope.body.payload = (value[0] === "A" ? "B" : "A") + value.slice(1); }
      return page;
    } };
    const engine = createBridgeEngine({ sqlite: db, backendId: "B", recordKey: keys.recordKey, codec, transport }); await engine.bootstrap();
    db.exec("INSERT INTO collections(id,account_id,name) VALUES('draft','default','Unsynced draft')");
    const before = db.prepare("SELECT * FROM bridge_cursors").all();
    await a.push("account", [envelope("draft", 1, "delete")]); corrupt=true;
    await expect(engine.pull()).rejects.toThrow(/authentication/);
    expect(db.prepare("SELECT name FROM collections WHERE id='draft'").get()).toEqual({ name: "Unsynced draft" });
    expect(db.prepare("SELECT * FROM bridge_cursors").all()).toEqual(before); expect(engine.pending().some((entry) => entry.pk === "draft")).toBe(true);
    corrupt=false; await engine.pull(); expect(db.prepare("SELECT 1 FROM collections WHERE id='draft'").get()).toBeUndefined();
  });
});
