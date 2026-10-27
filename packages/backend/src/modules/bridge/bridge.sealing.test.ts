import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { BridgeEnvelope, BridgeHeader } from "@mains/contracts/bridge-protocol";
import { bridgeHeaderAad, bridgePassThroughCodec, bridgeRecordKeys, createBridgeSealingCodec } from "./bridge.crypto";
import { deriveBridgeKeys, generateBridgeAccountKey, generateBridgeDeviceKeyPair, openBridgeAccountKey, sealBridgeAccountKey } from "./bridge.keys";

const vectors = JSON.parse(readFileSync(new URL("../../../test/fixtures/bridge/crypto-v1.json", import.meta.url), "utf8"));
const accountKey = hexToBytes(vectors.accountKeyHex);
const codec = createBridgeSealingCodec(accountKey);
const fixture = vectors.delete.envelope as BridgeEnvelope;
const clone = () => structuredClone(fixture);

describe("Bridge E2EE", () => {
  it("matches independently generated HKDF, encrypted envelope and sealed-box known answers", () => {
    const keys = deriveBridgeKeys(accountKey);
    expect(bytesToHex(keys.bodyKey)).toBe(vectors.derivedHex.body);
    expect(bytesToHex(keys.recordKey)).toBe(vectors.derivedHex.record);
    expect(bytesToHex(keys.blobIdKey)).toBe(vectors.derivedHex["blob-id"]);
    expect(codec.open(fixture).body).toEqual(vectors.delete.body);
    expect(bytesToHex(openBridgeAccountKey(vectors.wrap.sealed as any, hexToBytes(vectors.wrap.recipientSecretKeyHex)))).toBe(vectors.accountKeyHex);
  });
  it("uses fresh 24-byte nonces and roundtrips without exposing table, pk or data in the ciphertext", () => {
    const first = codec.seal(fixture.header, vectors.delete.body), second = codec.seal(fixture.header, vectors.delete.body);
    expect(first.body.nonce).toHaveLength(32); expect(first.body.nonce).not.toBe(second.body.nonce);
    expect(first.body.payload).not.toBe(second.body.payload);
    expect(JSON.stringify(first)).not.toContain("collections"); expect(JSON.stringify(first)).not.toContain("known-id");
    expect(codec.open(first)).toEqual({ header: fixture.header, body: vectors.delete.body });
  });
  it.each(["stream", "rowKey", "origin", "owner", "runId", "physicalMs", "counter", "op", "nonce", "payload"])("authenticates %s", (field) => {
    const envelope = clone(), h = envelope.header as any;
    if (field === "stream") h.stream = "run:another";
    else if (field === "rowKey") h.rowKey = bridgeRecordKeys(deriveBridgeKeys(accountKey).recordKey, "collections", "another").rowKey;
    else if (field === "origin") h.origin = "backend-b";
    else if (field === "owner") h.owner = "backend-a";
    else if (field === "runId") h.runId = "another";
    else if (field === "physicalMs" || field === "counter") h.hlc[field]++;
    else if (field === "op") { h.op = "upsert"; h.registerKey = h.rowKey; }
    else {
      const name = field as "nonce" | "payload", value = envelope.body[name]!;
      envelope.body[name] = (value[0] === "A" ? "B" : "A") + value.slice(1);
    }
    expect(() => codec.open(envelope)).toThrow();
  });
  it("authenticates registerKey and separates row identities even when the body is well formed", () => {
    const keys = bridgeRecordKeys(deriveBridgeKeys(accountKey).recordKey, "spaces", "s", "row");
    const header: BridgeHeader = { ...fixture.header, ...keys, op: "upsert", registerKey: keys.registerKey! };
    const body = { table: "spaces", pk: "s", register: "row", schemaVersion: 1, values: { title: "Gizli başlık 🌍" }, refs: {}, blobRefs: [] };
    const envelope = codec.seal(header, body);
    expect(codec.open(envelope).body).toEqual(body);
    if (envelope.header.op === "upsert") envelope.header.registerKey = fixture.header.rowKey;
    expect(() => codec.open(envelope)).toThrow();
    expect(() => codec.seal(header, { ...body, pk: "other" })).toThrow(/identity/);
  });
  it("canonicalizes header property order while rejecting unknown unauthenticated fields", () => {
    const reordered = { op: fixture.header.op, origin: fixture.header.origin, hlc: fixture.header.hlc, rowKey: fixture.header.rowKey, stream: fixture.header.stream, v: 1 } as BridgeHeader;
    expect(bridgeHeaderAad(reordered)).toEqual(bridgeHeaderAad(fixture.header));
    expect(codec.open({ ...fixture, header: reordered }).body).toEqual(vectors.delete.body);
    expect(() => codec.open({ ...fixture, header: { ...fixture.header, extra: "ignored?" } as unknown as BridgeHeader })).toThrow();
  });
  it("rejects the wrong account key, plaintext downgrade, malformed nonce and truncated ciphertext", () => {
    expect(() => createBridgeSealingCodec(generateBridgeAccountKey()).open(fixture)).toThrow();
    expect(() => codec.open(bridgePassThroughCodec.seal(fixture.header, vectors.delete.body))).toThrow();
    expect(() => codec.open({ ...fixture, body: { ...fixture.body, nonce: "bad" } })).toThrow();
    expect(() => codec.open({ ...fixture, body: { ...fixture.body, payload: fixture.body.payload.slice(0, -4) } })).toThrow();
    expect(() => createBridgeSealingCodec(new Uint8Array(31))).toThrow();
  });
  it("seals an account key only to the intended device and authenticates the ephemeral key", () => {
    const device = generateBridgeDeviceKeyPair(), other = generateBridgeDeviceKeyPair();
    const wrap = sealBridgeAccountKey(accountKey, device.publicKey);
    expect(openBridgeAccountKey(wrap, device.secretKey)).toEqual(accountKey);
    expect(() => openBridgeAccountKey(wrap, other.secretKey)).toThrow();
    expect(() => openBridgeAccountKey({ ...wrap, ephemeralPublicKey: vectors.wrap.sealed.ephemeralPublicKey }, device.secretKey)).toThrow();
    expect(() => sealBridgeAccountKey(accountKey, new Uint8Array(32))).toThrow();
    expect(sealBridgeAccountKey(accountKey, device.publicKey)).not.toEqual(wrap);
  });
});
