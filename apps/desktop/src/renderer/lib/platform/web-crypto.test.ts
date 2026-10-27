import { describe, expect, it, vi } from "vitest";
import { installWebCrypto } from "./web-crypto";

describe("LAN browser cryptographic identifiers", () => {
  it("generates distinct RFC 4122 version-4 UUIDs without a secure-context randomUUID", () => {
    const crypto: Pick<Crypto, "getRandomValues"> & Partial<Pick<Crypto, "randomUUID">> = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) };
    installWebCrypto(crypto);
    const ids = Array.from({ length: 100 }, () => crypto.randomUUID!());
    expect(new Set(ids).size).toBe(100);
    expect(ids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true);
  });
  it("preserves the native implementation", () => {
    const crypto = { getRandomValues: vi.fn(), randomUUID: vi.fn() };
    const native = crypto.randomUUID; installWebCrypto(crypto);
    expect(crypto.randomUUID).toBe(native); expect(crypto.getRandomValues).not.toHaveBeenCalled();
  });
  it("fails if secure entropy is unavailable", () => {
    const crypto: Pick<Crypto, "getRandomValues"> & Partial<Pick<Crypto, "randomUUID">> = { getRandomValues() { throw new Error("No entropy"); } };
    installWebCrypto(crypto); expect(() => crypto.randomUUID!()).toThrow("No entropy");
  });
});
