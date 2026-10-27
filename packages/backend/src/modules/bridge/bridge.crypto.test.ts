import { describe, expect, it } from "vitest";
import type { BridgeHeader, BridgeUpsertBody } from "@mains/contracts/bridge-protocol";
import { bridgePassThroughCodec as codec, bridgeRecordKeys, createBridgeSealingCodec } from "./bridge.crypto";
import { deriveBridgeKeys } from "./bridge.keys";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { bridgeHeaderAad } from "./bridge.crypto";
import { toBase64Url, utf8 } from "./bridge.encoding";
import { validateBridgeHeader } from "@mains/contracts/bridge-wire";

const key = new Uint8Array(32).fill(7);
const body: BridgeUpsertBody = { table: "atlas_items", pk: "page", register: "metadata", schemaVersion: 1,
  values: { is_favorite: true }, refs: {}, blobRefs: [] };
const header: BridgeHeader = { v: 1, stream: "account", ...bridgeRecordKeys(key, body.table, body.pk, body.register),
  registerKey: bridgeRecordKeys(key, body.table, body.pk, body.register).registerKey!, hlc: { physicalMs: 1, counter: 0 }, origin: "backend-a", op: "upsert" };

describe("Bridge portable envelope", () => {
  it("authenticates optional mirror retention without changing existing records' AAD", () => {
    const sealing = createBridgeSealingCodec(key);
    const keys = bridgeRecordKeys(deriveBridgeKeys(key).recordKey, body.table, body.pk, body.register);
    const mirrorHeader: BridgeHeader = { ...header, ...keys, registerKey: keys.registerKey!, stream: "run:r", owner: header.origin, runId: "r", retention: "30d-idle" };
    const envelope = sealing.seal(mirrorHeader, body);
    expect(sealing.open(envelope).header.retention).toBe("30d-idle");
    delete envelope.header.retention; expect(() => sealing.open(envelope)).toThrow();
    const ordinary = sealing.seal({ ...mirrorHeader, retention: undefined }, body);
    ordinary.header.retention = "30d-idle"; expect(() => sealing.open(ordinary)).toThrow();
  });

  it("round-trips an isolated register through the development codec", () => {
    expect(codec.open(codec.seal(header, body))).toEqual({ header: { ...header, blobs: [] }, body });
  });

  it("shares row identity while keeping register identities independent", () => {
    const content = bridgeRecordKeys(key, "atlas_items", "page", "content");
    const metadata = bridgeRecordKeys(key, "atlas_items", "page", "metadata");
    expect(content.rowKey).toBe(metadata.rowKey);
    expect(content.registerKey).not.toBe(metadata.registerKey);
    expect(content.rowKey).not.toBe(bridgeRecordKeys(new Uint8Array(32).fill(8), "atlas_items", "page").rowKey);
  });

  it("keeps deletes as complete, minimal row-level envelopes", () => {
    const { registerKey: _registerKey, blobs: _blobs, ...base } = header; void _blobs;
    const deletion: BridgeHeader = { ...base, op: "delete" };
    expect(codec.open(codec.seal(deletion, { table: "atlas_items", pk: "page" })).body).toEqual({ table: "atlas_items", pk: "page" });
    expect(() => codec.seal(deletion, body)).toThrow(/minimal/);
    expect(() => codec.open({ header: deletion, body: { nonce: null, payload: "" } })).toThrow();
  });

  it("authenticates sorted, deduplicated opaque blob roots without exposing file descriptions", () => {
    const sealing = createBridgeSealingCodec(key), keys = bridgeRecordKeys(deriveBridgeKeys(key).recordKey, body.table, body.pk, body.register);
    const ref = { blobId: toBase64Url(randomBytes(32)), size: 42, column: "file", name: "private-name.png", mime: "image/png", sourcePath: "/private/path" };
    const withFiles = { ...body, blobRefs: [ref, { ...ref, column: "cover" }] };
    const envelope = sealing.seal({ ...header, ...keys, registerKey: keys.registerKey! }, withFiles);
    expect(envelope.header.blobs).toEqual([{ blobId: ref.blobId, size: ref.size }]);
    expect(JSON.stringify(envelope.header)).not.toContain("private");
    expect(sealing.open(envelope).body).toEqual(withFiles);
    expect(sealing.open({ ...envelope, header: { ...envelope.header, blobs: [{ size: ref.size, blobId: ref.blobId }] } as BridgeHeader }).body).toEqual(withFiles);
    for (const blobs of [[], [{ blobId: toBase64Url(randomBytes(32)), size: 42 }], [{ blobId: ref.blobId, size: 43 }], undefined])
      expect(() => sealing.open({ ...envelope, header: { ...envelope.header, blobs } as BridgeHeader })).toThrow();
    expect(() => validateBridgeHeader({ ...envelope.header, blobs: [...envelope.header.blobs!, ...envelope.header.blobs!] })).toThrow();
    expect(() => validateBridgeHeader({ ...envelope.header, blobs: [{ ...envelope.header.blobs![0], name: "leak" }] })).toThrow();
    expect(() => validateBridgeHeader({ ...envelope.header, blobs: Array(65).fill(envelope.header.blobs![0]) })).toThrow();
  });

  it("reads legacy AAD but refuses a valid ciphertext whose announced roots disagree with its body", () => {
    const keys = deriveBridgeKeys(key), sealing = createBridgeSealingCodec(key);
    const ids = bridgeRecordKeys(keys.recordKey, body.table, body.pk, body.register);
    const legacyHeader: BridgeHeader = { ...header, ...ids, registerKey: ids.registerKey! };
    const legacySeal = (h: BridgeHeader, b: BridgeUpsertBody) => {
      const nonce = randomBytes(24);
      return { header: h, body: { nonce: toBase64Url(nonce), payload: toBase64Url(xchacha20poly1305(keys.bodyKey, nonce, bridgeHeaderAad(h)).encrypt(utf8(JSON.stringify(b)))) } };
    };
    expect(sealing.open(legacySeal(legacyHeader, body))).toEqual({ header: legacyHeader, body });
    const ref = { blobId: toBase64Url(randomBytes(32)), size: 42, column: "file", name: "file.png", mime: null };
    expect(() => sealing.open(legacySeal({ ...legacyHeader, blobs: [] }, { ...body, blobRefs: [ref] }))).toThrow(/roots/);
  });

  it("rejects unsupported versions and never mistakes ciphertext for plaintext", () => {
    expect(() => codec.seal({ ...header, v: 2 } as unknown as BridgeHeader, body)).toThrow(/header/);
    expect(() => codec.open({ ...codec.seal(header, body), body: { nonce: "encrypted", payload: "ciphertext" } })).toThrow(/sealing codec/);
    expect(() => codec.open({ header, body: { nonce: null, payload: JSON.stringify({ ...body, values: { metadata: { private: "not a SQLite scalar" } } }) } })).toThrow(/scalars/);
  });
});
