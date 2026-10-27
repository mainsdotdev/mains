import { describe, expect, it } from "vitest";
import { fromBase64Url, toBase64Url } from "./bridge.encoding";

describe("Bridge canonical base64url encoding", () => {
  it.each([["f", "Zg"], ["fo", "Zm8"], ["foo", "Zm9v"], ["foob", "Zm9vYg"]])("preserves the wire encoding of %s", (text, encoded) => {
    expect(toBase64Url(new TextEncoder().encode(text))).toBe(encoded);
    expect(fromBase64Url(encoded)).toEqual(new TextEncoder().encode(text));
  });

  it("round-trips a large ciphertext view without including bytes outside the view", () => {
    const storage = new Uint8Array(2 * 1024 * 1024 + 18);
    for (let index = 0; index < storage.length; index++) storage[index] = index % 256;
    const bytes = storage.subarray(7, storage.length - 11);
    const encoded = toBase64Url(bytes);
    expect(encoded).toBe(Buffer.from(bytes).toString("base64url"));
    expect(Buffer.from(fromBase64Url(encoded, bytes.length)).equals(bytes)).toBe(true);
  });

  it.each(["", "A", "Zg==", "Zg\n", "Zh", "Zm9", "Zg+", "Zg/", "é"])("rejects a noncanonical encoding %j", (value) => {
    expect(() => fromBase64Url(value)).toThrow("Invalid Bridge encoding");
  });

  it("enforces the requested decoded length", () => {
    expect(fromBase64Url("Zg", 1)).toEqual(new Uint8Array([102]));
    expect(() => fromBase64Url("Zg", 2)).toThrow("Invalid Bridge encoding");
  });
});
