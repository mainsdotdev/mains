import { createPublicKey, verify } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { BridgeEnvelope, BridgeHeader } from "@mains/contracts/bridge-protocol";
import { bridgeBase64 } from "@mains/contracts/bridge-auth";
import { ed25519 } from "@noble/curves/ed25519.js";
import { createBridgeSealingCodec, bridgeRecordKeys } from "./bridge.crypto";
import { createBridgeSigningCodec } from "./bridge.signing";
import { deriveBridgeKeys, generateBridgeSigningKeyPair } from "./bridge.keys";
import { createBridgeEngine } from "./bridge.engine";
import { createTestDb } from "../../../test/setup-db";
import type { BridgeTransport } from "./bridge.transport";

const accountKey = new Uint8Array(32).fill(17), secretA = new Uint8Array(32).fill(18), secretB = new Uint8Array(32).fill(19);
const publicA = bridgeBase64(ed25519.getPublicKey(secretA)), publicB = bridgeBase64(ed25519.getPublicKey(secretB));
function codec(writer = "A", accountId = "account") {
  return createBridgeSigningCodec(createBridgeSealingCodec(accountKey), { accountId, backendId: writer, signingPrivateKey: writer === "A" ? secretA : secretB },
    (id, key) => id === "A" && key === publicA || id === "B" && key === publicB);
}
function envelope(op: "upsert" | "delete" = "upsert"): BridgeEnvelope {
  const keys = bridgeRecordKeys(deriveBridgeKeys(accountKey).recordKey, "collections", "c", op === "upsert" ? "row" : undefined);
  const base = { v: 1 as const, stream: "account" as const, rowKey: keys.rowKey, hlc: { physicalMs: 1, counter: 2 }, origin: "A" };
  const header: BridgeHeader = op === "delete" ? { ...base, op } : { ...base, op, registerKey: keys.registerKey! };
  return codec().seal(header, op === "delete" ? { table: "collections", pk: "c" } :
    { table: "collections", pk: "c", register: "row", schemaVersion: 3, values: { id: "c", account_id: "default", name: "secret", created_at: "2026-01-01" }, refs: {}, blobRefs: [] });
}
const cleanup: Array<() => unknown> = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });

describe("Bridge authenticated publications", () => {
  it.each(["upsert", "delete"] as const)("accepts a historical local %s after random-key rotation without delegating own identity to the hub", (op) => {
    const value = envelope(op), next = generateBridgeSigningKeyPair();
    const current = createBridgeSigningCodec(createBridgeSealingCodec(accountKey), { accountId: "account", backendId: "A",
      signingPrivateKey: next.secretKey, localSigningPublicKeys: [publicA] }, () => { throw new Error("Own key must not use the hub directory"); });
    expect(current.open(value).body.pk).toBe("c");
    const renewed = current.seal(value.header, codec().open(value).body);
    expect(renewed.auth!.signingPublicKey).toBe(bridgeBase64(next.publicKey)); expect(current.open(renewed).body.pk).toBe("c");
    const untrusted = createBridgeSigningCodec(createBridgeSealingCodec(accountKey), { accountId: "account", backendId: "A", signingPrivateKey: next.secretKey }, () => true);
    expect(() => untrusted.open(value)).toThrow(/writer is not registered/);
    value.auth!.signature = bridgeBase64(new Uint8Array(64));
    expect(() => current.open(value)).toThrow(/signature is invalid/);
    current.destroy?.(); untrusted.destroy?.();
  });
  it("matches an independent OpenSSL signature verification over the canonical ciphertext envelope", () => {
    const value = envelope(), { auth, header: h, body } = value;
    const bytes = Buffer.from(JSON.stringify([1, "mains.bridge.v1/signed-record", "account", 1, auth!.publicationId, publicA,
      [1, "account", h.rowKey, h.registerKey, 1, 2, "A", "upsert", null, null, null, []], body.nonce, body.payload]));
    const key = createPublicKey({ format: "der", type: "spki", key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicA, "base64url")]) });
    expect(verify(null, bytes, key, Buffer.from(auth!.signature, "base64url"))).toBe(true);
    expect(codec("B").open(value).body.pk).toBe("c");
  });
  it.each(["accountId", "epoch", "publicationId", "signingPublicKey", "signature", "stream", "rowKey", "registerKey", "origin", "owner", "runId", "retention", "blobs", "physicalMs", "counter", "op", "nonce", "payload", "missing"])("rejects altered %s before decrypting", (field) => {
    const value = envelope(), header = value.header as any, auth = value.auth as any;
    if (field === "missing") delete value.auth;
    else if (field in auth) auth[field] = field === "epoch" ? 2 : field === "accountId" ? "other" : field === "signingPublicKey" ? publicB : (auth[field][0] === "A" ? "B" : "A") + auth[field].slice(1);
    else if (field === "nonce" || field === "payload") value.body[field] = (value.body[field]![0] === "A" ? "B" : "A") + value.body[field]!.slice(1);
    else if (field === "physicalMs" || field === "counter") header.hlc[field]++;
    else if (field === "blobs") header.blobs = [{ blobId: bridgeBase64(new Uint8Array(32).fill(7)), size: 3 }];
    else header[field] = field === "owner" || field === "origin" ? "B" : field === "stream" ? "run:r" : field === "retention" ? "30d-idle" : field === "op" ? "delete" : "x".repeat(22);
    expect(() => codec("B").open(value)).toThrow();
  });
  it("cannot impersonate the local writer using the shared account key or a substituted directory key", () => {
    const signed = envelope(), raw = createBridgeSealingCodec(accountKey);
    expect(() => codec("B").seal(signed.header, raw.open(signed).body)).toThrow(/another Bridge writer/);
    const receiver = createBridgeSigningCodec(raw, { accountId: "account", backendId: "A", signingPrivateKey: secretA }, () => true);
    const fake = createBridgeSigningCodec(raw, { accountId: "account", backendId: "A", signingPrivateKey: secretB }, () => true).seal(signed.header, raw.open(signed).body);
    expect(() => receiver.open(fake)).toThrow(/writer/);
    expect(() => codec("B", "other").open(signed)).toThrow(/writer/);
  });
  it("persists one signed publication across a lost ACK and restart, and refuses a mismatched success ACK", async () => {
    const fixture = createTestDb(); cleanup.push(fixture.cleanup);
    const db = fixture.sqlite;
    db.exec("INSERT INTO accounts(id) VALUES('default'); INSERT INTO app_settings(id,account_id,backend_id) VALUES('default','default','A')");
    let sent: BridgeEnvelope | undefined, response: "lost" | "wrong" | "ok" = "ok";
    const transport: BridgeTransport = { pull: async () => ({ records: [], next: 0, hasMore: false }), async push(_stream, records) {
      if (sent) expect(records[0]).toEqual(sent); else sent = structuredClone(records[0]);
      if (response === "lost") throw new Error("lost response");
      return records.map((record) => ({ seq: 1, publicationId: response === "wrong" ? bridgeBase64(new Uint8Array(32)) : record.auth!.publicationId }));
    } };
    const make = () => createBridgeEngine({ sqlite: db, backendId: "A", recordKey: deriveBridgeKeys(accountKey).recordKey, codec: codec(), transport });
    let engine = make(); await engine.bootstrap(); await engine.push(); sent = undefined; response = "lost";
    db.exec("INSERT INTO collections(id,account_id,name) VALUES('c','default','draft')");
    await expect(engine.push()).rejects.toThrow(/lost/); expect(engine.pending()).toHaveLength(1);
    await engine.stop(); engine = make(); response = "wrong";
    await expect(engine.push()).rejects.toThrow(/different publication/); expect(engine.pending()).toHaveLength(1);
    response = "ok"; await engine.push(); expect(engine.pending()).toHaveLength(0);
    expect(db.prepare("SELECT count(*) n FROM bridge_publications").get()).toEqual({ n: 0 });
    await engine.stop();
  });
  it("rejects forged future clocks and tombstones before clock advancement or clearing a local write", async () => {
    const fixture = createTestDb(); cleanup.push(fixture.cleanup); const db = fixture.sqlite;
    db.exec("INSERT INTO accounts(id) VALUES('default'); INSERT INTO app_settings(id,account_id,backend_id) VALUES('default','default','B')");
    const future = envelope(), tombstone = envelope("delete"); future.header.hlc.physicalMs = Number.MAX_SAFE_INTEGER;
    tombstone.auth!.signature = bridgeBase64(new Uint8Array(64));
    let inject = false;
    const transport: BridgeTransport = { push: async () => [], pull: async (_stream, after) => inject && after === 0
      ? { records: [{ seq: 1, envelope: future }, { seq: 2, envelope: tombstone }], next: 2, hasMore: false }
      : { records: [], next: after, hasMore: false } };
    const engine = createBridgeEngine({ sqlite: db, backendId: "B", recordKey: deriveBridgeKeys(accountKey).recordKey, codec: codec("B"), transport });
    await engine.bootstrap(); db.exec("INSERT INTO collections(id,account_id,name) VALUES('c','default','offline draft')");
    const before = db.prepare("SELECT physical_ms,counter FROM bridge_clock").get(); inject = true;
    await engine.pull();
    expect(db.prepare("SELECT physical_ms,counter FROM bridge_clock").get()).toEqual(before);
    expect(db.prepare("SELECT name FROM collections WHERE id='c'").get()).toEqual({ name: "offline draft" });
    expect(engine.pending().some((entry) => entry.pk === "c")).toBe(true); expect(engine.unverified()).toBe(2);
    await engine.stop();
  });
  it.each(["runs", "pulses"])("cannot introduce locally executable %s from an incoming owner field, even with a genuine old local signature", async (table) => {
    const source = createTestDb(), target = createTestDb(); cleanup.push(source.cleanup, target.cleanup);
    for (const { sqlite } of [source, target]) sqlite.exec("INSERT INTO accounts(id) VALUES('default'); INSERT INTO app_settings(id,account_id,backend_id) VALUES('default','default','A'); INSERT INTO providers(id,kind,display_name) VALUES('codex','agent_runtime','Codex')");
    const published: BridgeEnvelope[] = [];
    const sender = createBridgeEngine({ sqlite: source.sqlite, backendId: "A", recordKey: deriveBridgeKeys(accountKey).recordKey, codec: codec(), transport: {
      pull: async () => ({ records: [], next: 0, hasMore: false }), push: async (_stream, records) => {
        published.push(...records); return records.map((record, index) => ({ seq: index + 1, publicationId: record.auth!.publicationId }));
      },
    } });
    await sender.bootstrap();
    if (table === "runs") source.sqlite.exec("INSERT INTO runs(id,owner_backend_id,account_id,provider_id,title) VALUES('r','A','default','codex','Incoming executable root')");
    else source.sqlite.exec("INSERT INTO pulses(id,owner_backend_id,account_id,provider_id,model,title,prompt,frequency,timezone,mode) VALUES('r','A','default','codex','test','Incoming executable pulse','Never execute','hourly','UTC','chat')");
    await sender.push();
    const root = published.find((record) => { const body = codec().open(record).body; return body.table === table && "register" in body && body.register === "row"; });
    expect(root).toBeDefined();
    const next = generateBridgeSigningKeyPair();
    const rotatedCodec = createBridgeSigningCodec(createBridgeSealingCodec(accountKey), { accountId: "account", backendId: "A", signingPrivateKey: next.secretKey, localSigningPublicKeys: [publicA] }, () => false);
    expect(rotatedCodec.open(root!).body.table).toBe(table);
    const receiver = createBridgeEngine({ sqlite: target.sqlite, backendId: "A", recordKey: deriveBridgeKeys(accountKey).recordKey, codec: rotatedCodec, transport: {
      push: async () => [], pull: async (_stream, after) => after ? { records: [], next: after, hasMore: false } : { records: [{ seq: 1, envelope: root! }], next: 1, hasMore: false },
    } });
    await receiver.pull(); expect(target.sqlite.prepare(`SELECT 1 FROM ${table} WHERE id='r'`).get()).toBeUndefined();
    expect(receiver.unverified()).toBe(1); expect(target.sqlite.prepare("SELECT physical_ms FROM bridge_clock").get()).toEqual({ physical_ms: 0 });
    await sender.stop(); await receiver.stop();
  });
});
