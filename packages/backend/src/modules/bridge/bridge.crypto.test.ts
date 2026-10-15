import { describe, expect, it } from "vitest";
import type { BridgeHeader, BridgeUpsertBody } from "@mains/contracts/bridge-protocol";
import { bridgePassThroughCodec as codec, bridgeRecordKeys, createBridgeSealingCodec } from "./bridge.crypto";
import { deriveBridgeKeys } from "./bridge.keys";

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
    expect(codec.open(codec.seal(header, body))).toEqual({ header, body });
  });

  it("shares row identity while keeping register identities independent", () => {
    const content = bridgeRecordKeys(key, "atlas_items", "page", "content");
    const metadata = bridgeRecordKeys(key, "atlas_items", "page", "metadata");
    expect(content.rowKey).toBe(metadata.rowKey);
    expect(content.registerKey).not.toBe(metadata.registerKey);
    expect(content.rowKey).not.toBe(bridgeRecordKeys(new Uint8Array(32).fill(8), "atlas_items", "page").rowKey);
  });

  it("keeps deletes as complete, minimal row-level envelopes", () => {
    const { registerKey: _registerKey, ...base } = header;
    const deletion: BridgeHeader = { ...base, op: "delete" };
    expect(codec.open(codec.seal(deletion, { table: "atlas_items", pk: "page" })).body).toEqual({ table: "atlas_items", pk: "page" });
    expect(() => codec.seal(deletion, body)).toThrow(/minimal/);
    expect(() => codec.open({ header: deletion, body: { nonce: null, payload: "" } })).toThrow();
  });

  it("rejects unsupported versions and never mistakes ciphertext for plaintext", () => {
    expect(() => codec.seal({ ...header, v: 2 } as unknown as BridgeHeader, body)).toThrow(/header/);
    expect(() => codec.open({ ...codec.seal(header, body), body: { nonce: "encrypted", payload: "ciphertext" } })).toThrow(/sealing codec/);
    expect(() => codec.open({ header, body: { nonce: null, payload: JSON.stringify({ ...body, values: { metadata: { private: "not a SQLite scalar" } } }) } })).toThrow(/scalars/);
  });
});
