import { describe, expect, it } from "vitest";
import { BRIDGE_BLOB_CHUNK_BYTES } from "@mains/contracts/bridge-blobs";
import { createBridgeBlobCrypto } from "./bridge.blob-crypto";

describe("Bridge blob encryption", () => {
  it("deduplicates within one account, with opaque identities across accounts", () => {
    const a = createBridgeBlobCrypto(new Uint8Array(32).fill(7)), b = createBridgeBlobCrypto(new Uint8Array(32).fill(8));
    const bytes = new Uint8Array([1, 2, 3]);
    expect(a.id(bytes)).toBe(a.id(bytes)); expect(a.id(bytes)).not.toBe(b.id(bytes));
    a.destroy(); b.destroy(); expect(() => a.id(bytes)).toThrow(/stopped/);
  });
  it("seals with fresh nonces and authenticates identity, position, length and account", () => {
    const a = createBridgeBlobCrypto(new Uint8Array(32).fill(7)), b = createBridgeBlobCrypto(new Uint8Array(32).fill(8));
    const bytes = new Uint8Array(BRIDGE_BLOB_CHUNK_BYTES * 2).fill(19), ref = { blobId: a.id(bytes), size: bytes.length };
    const part = bytes.subarray(0, BRIDGE_BLOB_CHUNK_BYTES), sealed = a.seal(ref, 0, part);
    expect(Buffer.from(a.seal(ref, 0, part)).equals(Buffer.from(sealed))).toBe(false);
    expect(Buffer.from(a.open(ref, 0, sealed)).equals(Buffer.from(part))).toBe(true);
    expect(() => a.open(ref, 1, sealed)).toThrow(); expect(() => b.open(ref, 0, sealed)).toThrow();
    expect(() => a.open({ ...ref, size: ref.size - 1 }, 0, sealed)).toThrow();
    expect(() => a.open({ ...ref, blobId: b.id(bytes) }, 0, sealed)).toThrow();
    sealed[30] ^= 1; expect(() => a.open(ref, 0, sealed)).toThrow();
    expect(() => a.open(ref, 0, sealed.subarray(1))).toThrow(/length/);
    a.destroy(); b.destroy();
  });
  it("transfers empty files as one authenticated chunk", () => {
    const crypto = createBridgeBlobCrypto(new Uint8Array(32).fill(9)), bytes = new Uint8Array();
    const ref = { blobId: crypto.id(bytes), size: 0 };
    expect(crypto.open(ref, 0, crypto.seal(ref, 0, bytes))).toEqual(bytes); crypto.destroy();
  });
});
