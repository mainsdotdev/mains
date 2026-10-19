import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bridgeBytes, bridgeRecoveryMessage, validateBridgeRecoveryWrap } from "@mains/contracts/bridge-auth";
import { generateBridgeAccountKey, generateBridgeDeviceKeyPair, generateBridgeSigningKeyPair, sealBridgeAccountKey } from "./bridge.keys";
import { bridgeRecoveryPublicKey, generateBridgeRecoveryCode, openBridgeRecovery, sealBridgeRecovery, signBridgeRecovery } from "./bridge.recovery";

describe("Bridge recovery encryption", () => {
  it("wraps a random account key with fixed Argon2id parameters, accepts formatting, and rejects wrong codes and tampering", async () => {
    const key = generateBridgeAccountKey(), code = generateBridgeRecoveryCode(), wrapped = await sealBridgeRecovery(key, code);
    expect(code).toMatch(/^(?:[A-HJ-NP-Z2-9]{4}-){7}[A-HJ-NP-Z2-9]{4}$/);
    expect(wrapped.kdf).toMatchObject({ name: "argon2id", memoryKiB: 65536, iterations: 3, parallelism: 1 });
    expect(await openBridgeRecovery(wrapped, code.toLowerCase().replace(/-/g, " "))).toEqual(key);
    const reordered = { ...wrapped, kdf: { salt: wrapped.kdf.salt, parallelism: wrapped.kdf.parallelism, iterations: wrapped.kdf.iterations, memoryKiB: wrapped.kdf.memoryKiB, name: wrapped.kdf.name } };
    expect(await openBridgeRecovery(reordered, code)).toEqual(key);
    await expect(openBridgeRecovery(wrapped, code[0] === "A" ? `B${code.slice(1)}` : `A${code.slice(1)}`)).rejects.toThrow("does not match");
    const changed = { ...wrapped, nonce: Buffer.alloc(24).toString("base64url") };
    await expect(openBridgeRecovery(changed, code)).rejects.toThrow("does not match");
    expect(() => validateBridgeRecoveryWrap({ ...wrapped, kdf: { ...wrapped.kdf, memoryKiB: 1_000_000 } })).toThrow("Unsupported");
    await expect(openBridgeRecovery(wrapped, "short")).rejects.toThrow("Invalid recovery code");
  }, 30_000);
  it("authenticates the account, backend id, recipient key, challenge and exact wrapped bytes without disclosing the account key", () => {
    const key = generateBridgeAccountKey(), recipient = generateBridgeDeviceKeyPair(), pub = Buffer.from(recipient.publicKey).toString("base64url");
    const identity = { accountId: "account", backendId: "B", publicKey: pub, signingPublicKey: Buffer.from(generateBridgeSigningKeyPair().publicKey).toString("base64url") };
    const wrap = sealBridgeAccountKey(key, recipient.publicKey), signature = bridgeBytes(signBridgeRecovery(key, identity, "challenge", wrap), 64);
    const verifyKey = bridgeBytes(bridgeRecoveryPublicKey(key), 32);
    expect(ed25519.verify(signature, bridgeRecoveryMessage(identity, "challenge", wrap), verifyKey)).toBe(true);
    for (const change of [{ accountId: "other" }, { backendId: "C" }, { publicKey: identity.signingPublicKey }, { signingPublicKey: pub }])
      expect(ed25519.verify(signature, bridgeRecoveryMessage({ ...identity, ...change }, "challenge", wrap), verifyKey)).toBe(false);
    expect(ed25519.verify(signature, bridgeRecoveryMessage(identity, "other", wrap), verifyKey)).toBe(false);
    const different = sealBridgeAccountKey(key, recipient.publicKey);
    expect(ed25519.verify(signature, bridgeRecoveryMessage(identity, "challenge", different), verifyKey)).toBe(false);
  });
});
