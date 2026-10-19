import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bridgeBase64, validateBridgeRecoveryWrap } from "@mains/contracts/bridge-auth";
import { generateBridgeAccountKey } from "./bridge.keys";
import { generateBridgeRecoveryCode, openBridgeRecovery, sealBridgeRecovery } from "./bridge.recovery";

describe("Bridge recovery encryption", () => {
  it("wraps a random account key with fixed Argon2id parameters, accepts formatting, and rejects wrong codes and tampering", async () => {
    const key = generateBridgeAccountKey(), code = generateBridgeRecoveryCode(), { wrap } = await sealBridgeRecovery(key, code);
    expect(code).toMatch(/^(?:[A-HJ-NP-Z2-9]{4}-){7}[A-HJ-NP-Z2-9]{4}$/);
    expect(wrap.kdf).toMatchObject({ name: "argon2id", memoryKiB: 65536, iterations: 3, parallelism: 1 });
    expect((await openBridgeRecovery(wrap, code.toLowerCase().replace(/-/g, " "))).accountKey).toEqual(key);
    const reordered = { ...wrap, kdf: { salt: wrap.kdf.salt, parallelism: wrap.kdf.parallelism, iterations: wrap.kdf.iterations, memoryKiB: wrap.kdf.memoryKiB, name: wrap.kdf.name } };
    expect((await openBridgeRecovery(reordered, code)).accountKey).toEqual(key);
    await expect(openBridgeRecovery(wrap, code[0] === "A" ? `B${code.slice(1)}` : `A${code.slice(1)}`)).rejects.toThrow("does not match");
    await expect(openBridgeRecovery({ ...wrap, nonce: Buffer.alloc(24).toString("base64url") }, code)).rejects.toThrow("does not match");
    expect(() => validateBridgeRecoveryWrap({ ...wrap, kdf: { ...wrap.kdf, memoryKiB: 1_000_000 } })).toThrow("Unsupported");
    await expect(openBridgeRecovery(wrap, "short")).rejects.toThrow("Invalid recovery code");
  }, 30_000);
  it("derives the recovery signing authority from the code, never from the account key", async () => {
    const key = generateBridgeAccountKey(), code = generateBridgeRecoveryCode(), sealed = await sealBridgeRecovery(key, code);
    const opened = await openBridgeRecovery(sealed.wrap, code);
    expect(opened.signingPublicKey).toBe(sealed.signingPublicKey);
    expect(bridgeBase64(ed25519.getPublicKey(opened.signingSecret))).toBe(sealed.signingPublicKey);
    // The same account key under another code (or another salt) yields an unrelated authority.
    expect((await sealBridgeRecovery(key, code)).signingPublicKey).not.toBe(sealed.signingPublicKey);
    expect((await sealBridgeRecovery(key, generateBridgeRecoveryCode())).signingPublicKey).not.toBe(sealed.signingPublicKey);
    for (const secret of [opened.signingSecret, ed25519.getPublicKey(opened.signingSecret)]) expect(Buffer.from(secret).equals(Buffer.from(key))).toBe(false);
  }, 30_000);
});
