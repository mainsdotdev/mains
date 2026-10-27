import { createHash, createPublicKey, verify } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { BridgeEnvelope, BridgeHeader } from "@mains/contracts/bridge-protocol";
import { bridgeBase64 } from "@mains/contracts/bridge-auth";
import { applyBridgeMembershipEntry, type BridgeMember, type BridgeMembershipChange, type BridgeMembershipHead, type BridgeMembershipState } from "@mains/contracts/bridge-membership";
import { bridgeSigningMessage } from "@mains/contracts/bridge-signing";
import { ed25519 } from "@noble/curves/ed25519.js";
import { createBridgeSealingCodec, bridgeRecordKeys } from "./bridge.crypto";
import { createBridgeSigningCodec } from "./bridge.signing";
import { bridgeAccountKeyCommitment, deriveBridgeKeys, generateBridgeDeviceKeyPair, generateBridgeSigningKeyPair } from "./bridge.keys";
import { deviceSigner, signBridgeMembershipEntry, verifyBridgeSignature } from "./bridge.membership";
import { createBridgeEngine, type BridgeEngineOptions } from "./bridge.engine";
import { createTestDb } from "../../../test/setup-db";
import type { BridgeTransport } from "./bridge.transport";
import { BRIDGE_TABLES } from "./bridge.records";

const noRecords = { through: 0, count: 0, root: createHash("sha256").update("[]").digest("base64url") };
const accountKey = new Uint8Array(32).fill(17), secretA = new Uint8Array(32).fill(18), secretB = new Uint8Array(32).fill(19), next = generateBridgeSigningKeyPair();
const publicA = bridgeBase64(ed25519.getPublicKey(secretA)), publicB = bridgeBase64(ed25519.getPublicKey(secretB));
const member = (backendId: string, signingPublicKey: string): BridgeMember => ({ backendId, publicKey: bridgeBase64(generateBridgeDeviceKeyPair().publicKey), signingPublicKey });
const memberA = member("A", publicA), memberB = member("B", publicB), rotatedA = member("A", bridgeBase64(next.publicKey));
/** genesis(A) → add(B) is `initial` (seq 1); A then leaves and rejoins with a new key: `rotated` (seq 3). */
let initial: BridgeMembershipState, rotated: BridgeMembershipState, fork: BridgeMembershipState;
beforeAll(async () => {
  const extend = async (state: BridgeMembershipState | null, change: BridgeMembershipChange, signer: BridgeMember, secret: Uint8Array, accountId = "account") =>
    applyBridgeMembershipEntry(state, signBridgeMembershipEntry(state ?? { accountId, seq: -1, head: null }, change, deviceSigner(signer), secret), verifyBridgeSignature);
  const genesis = (recovery: Uint8Array) => ({ kind: "genesis" as const, body: { member: memberA, recoverySigningPublicKey: bridgeBase64(ed25519.getPublicKey(recovery)),
    accountKeyCommitment: bridgeAccountKeyCommitment(accountKey) } });
  initial = await extend(await extend(null, genesis(new Uint8Array(32).fill(20)), memberA, secretA), { kind: "add", body: { member: memberB, via: "approval" } }, memberA, secretA);
  rotated = await extend(await extend(initial, { kind: "remove", body: { backendId: "A", account: noRecords } }, memberB, secretB), { kind: "add", body: { member: rotatedA, via: "approval" } }, memberB, secretB);
  fork = await extend(await extend(null, genesis(new Uint8Array(32).fill(21)), memberA, secretA), { kind: "add", body: { member: memberB, via: "approval" } }, memberA, secretA);
});
const view = (state: BridgeMembershipState, fences = new Map<number, ReadonlySet<string>>()) => ({ current: () => state, fence: (seq: number) => fences.get(seq) });
function codec(writer = "A", accountId = "account", state = initial, secret = writer === "A" ? secretA : secretB, fences = new Map<number, ReadonlySet<string>>()) {
  return createBridgeSigningCodec(createBridgeSealingCodec(accountKey), { accountId, backendId: writer, signingPrivateKey: secret }, view(state, fences));
}
/** A's removal at seq 2 admitting exactly these records. */
const fencing = (...records: BridgeEnvelope[]) => new Map([[2, new Set(records.map((record) => record.auth!.signature))]]);
/** A genuine device signature over any binding, as a hostile hub or removed writer could produce. */
function resign(value: BridgeEnvelope, secret: Uint8Array, membership: BridgeMembershipHead): BridgeEnvelope {
  const auth = { ...value.auth!, membership, signingPublicKey: bridgeBase64(ed25519.getPublicKey(secret)) };
  return { ...value, auth: { ...auth, signature: bridgeBase64(ed25519.sign(bridgeSigningMessage(value, auth), secret)) } };
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
  it("retries a page without advancing its cursor when membership becomes unavailable during value restoration", async () => {
    const fixture = createTestDb(); cleanup.push(fixture.cleanup);
    fixture.sqlite.exec("INSERT INTO accounts(id) VALUES('default'); INSERT INTO app_settings(id,account_id,backend_id) VALUES('default','default','B')");
    let state: BridgeMembershipState | null = initial, available = false;
    fixture.sqlite.exec("INSERT INTO collections(id,account_id,name) VALUES('c','default','secret')");
    const source = fixture.sqlite.prepare("SELECT * FROM collections WHERE id='c'").get() as Record<string, string | null>;
    fixture.sqlite.exec("DELETE FROM collections WHERE id='c'");
    const template = envelope(), record = codec().seal(template.header, { table: "collections", pk: "c", register: "row", schemaVersion: 3,
      values: Object.fromEntries(BRIDGE_TABLES.collections.registers.row.map((column) => [column, source[column]])), refs: {}, blobRefs: [] });
    const receiver = createBridgeSigningCodec(createBridgeSealingCodec(accountKey),
      { accountId: "account", backendId: "B", signingPrivateKey: secretB }, { current: () => state, fence: () => undefined });
    const transport = { pull: async () => ({ records: available ? [{ seq: 1, envelope: record }] : [], next: available ? 1 : 0, hasMore: false }) } as unknown as BridgeTransport;
    let interrupt = true;
    const blobs = { values: { async restore() { await Promise.resolve(); if (interrupt) state = null; return new Map(); } } } as unknown as BridgeEngineOptions["blobs"];
    const engine = createBridgeEngine({ sqlite: fixture.sqlite, backendId: "B", recordKey: deriveBridgeKeys(accountKey).recordKey, transport, codec: receiver, blobs });
    await engine.bootstrap(); available = true;
    await expect(engine.pull()).rejects.toThrow(/membership.*not verified/);
    expect(fixture.sqlite.prepare("SELECT seq FROM bridge_cursors WHERE stream='account'").get()).toEqual({ seq: 0 });
    expect(fixture.sqlite.prepare("SELECT * FROM bridge_parked").all()).toEqual([]);
    interrupt = false; state = initial; await engine.pull();
    expect(fixture.sqlite.prepare("SELECT name FROM collections WHERE id='c'").get()).toEqual({ name: "secret" });
    expect(engine.unverified()).toBe(0); await engine.stop();
  });
  it.each(["upsert", "delete"] as const)("accepts a %s signed by a writer's earlier key at the head it bound, never after that key's removal", (op) => {
    const value = envelope(op), current = codec("A", "account", rotated, next.secretKey, fencing(value));
    expect(value.auth!.membership).toEqual({ seq: 1, hash: initial.head });
    expect(current.open(value).body.pk).toBe("c");
    const renewed = current.seal(value.header, codec().open(value).body);
    expect(renewed.auth).toMatchObject({ signingPublicKey: bridgeBase64(next.publicKey), membership: { seq: 3, hash: rotated.head } }); expect(current.open(renewed).body.pk).toBe("c");
    // The removed key can still sign, but no binding at or after its removal names it as A's key.
    for (const seq of [2, 3]) expect(() => current.open(resign(value, secretA, { seq, hash: rotated.hashes[seq] }))).toThrow(/writer is not a member/);
    expect(() => codec("A", "account", rotated).seal(value.header, codec().open(value).body)).toThrow(/not a member/);
    value.auth!.signature = bridgeBase64(new Uint8Array(64));
    expect(() => codec("B").open(value)).toThrow(/signature is invalid/);
    current.destroy?.();
  });
  it("refuses a binding this device has not verified, from another history, or from before its writer was admitted", () => {
    const value = envelope(), receiver = codec("B");
    expect(() => codec("B", "account", { ...initial, seq: 0, hashes: initial.hashes.slice(0, 1) }).open(value)).toThrow(/has not verified/);
    expect(() => codec("B", "account", fork).open(value)).toThrow(/different membership history/);
    const b = codec("B").seal({ ...value.header, origin: "B" }, codec().open(value).body);
    expect(receiver.open(b).body.pk).toBe("c");
    expect(() => receiver.open(resign(b, secretB, { seq: 0, hash: initial.hashes[0] }))).toThrow(/writer is not a member/);
    expect(() => codec("A", "account", rotated, secretA, fencing(value)).open(value)).not.toThrow();
  });
  it("admits a removed writer's account records only through its removal fence, however early they bind", () => {
    const fenced = envelope(), later = envelope("delete"), receiver = (fences: Map<number, ReadonlySet<string>>) => codec("B", "account", rotated, secretB, fences);
    expect(receiver(fencing(fenced)).open(fenced).body.pk).toBe("c");
    // Validly signed by A's old key and bound before its removal, but published outside what the remover saw.
    expect(() => receiver(fencing(fenced)).open(later)).toThrow(/outside its removal fence/);
    expect(() => receiver(new Map()).open(fenced)).toThrow(/outside its removal fence/);
    // Run streams are fenced separately (slice 3); a still-admitted writer needs no fence.
    const run = codec("A").seal({ ...fenced.header, stream: "run:r", owner: "A", runId: "r" }, codec().open(fenced).body);
    expect(receiver(new Map()).open(run).body.pk).toBe("c");
    expect(codec("B").open(later).body.pk).toBe("c");
  });
  it("matches an independent OpenSSL signature verification over the canonical ciphertext envelope", () => {
    const value = envelope(), { auth, header: h, body } = value;
    const bytes = Buffer.from(JSON.stringify([2, "mains.bridge.v2/signed-record", "account", 1, 1, initial.head, auth!.publicationId, publicA,
      [1, "account", h.rowKey, h.registerKey, 1, 2, "A", "upsert", null, null, null, []], body.nonce, body.payload]));
    const key = createPublicKey({ format: "der", type: "spki", key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicA, "base64url")]) });
    expect(verify(null, bytes, key, Buffer.from(auth!.signature, "base64url"))).toBe(true);
    expect(codec("B").open(value).body.pk).toBe("c");
  });
  it.each(["accountId", "epoch", "membership", "publicationId", "signingPublicKey", "signature", "stream", "rowKey", "registerKey", "origin", "owner", "runId", "retention", "blobs", "physicalMs", "counter", "op", "nonce", "payload", "missing"])("rejects altered %s before decrypting", (field) => {
    const value = envelope(), header = value.header as any, auth = value.auth as any;
    if (field === "missing") delete value.auth;
    else if (field === "membership") auth.membership = { seq: 0, hash: initial.hashes[0] };
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
    expect(() => codec("A", "account", initial, secretB).seal(signed.header, raw.open(signed).body)).toThrow(/not a member/);
    expect(() => codec("B").open(resign(signed, secretB, signed.auth!.membership))).toThrow(/writer is not a member/);
    expect(() => codec("B", "other").open(signed)).toThrow(/another account/);
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
    const rotatedCodec = codec("A", "account", rotated, next.secretKey, fencing(root!));
    expect(rotatedCodec.open(root!).body.table).toBe(table);
    const receiver = createBridgeEngine({ sqlite: target.sqlite, backendId: "A", recordKey: deriveBridgeKeys(accountKey).recordKey, codec: rotatedCodec, transport: {
      push: async () => [], pull: async (_stream, after) => after ? { records: [], next: after, hasMore: false } : { records: [{ seq: 1, envelope: root! }], next: 1, hasMore: false },
    } });
    await receiver.pull(); expect(target.sqlite.prepare(`SELECT 1 FROM ${table} WHERE id='r'`).get()).toBeUndefined();
    expect(receiver.unverified()).toBe(1); expect(target.sqlite.prepare("SELECT physical_ms FROM bridge_clock").get()).toEqual({ physical_ms: 0 });
    await sender.stop(); await receiver.stop();
  });
});
