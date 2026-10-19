import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { argon2idAsync } from "@noble/hashes/argon2.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { BRIDGE_RECOVERY_ALPHABET, bridgeBase64, bridgeBytes, validateBridgeRecoveryWrap, type BridgeRecoveryWrap } from "@mains/contracts/bridge-auth";
import { requireBridgeKey } from "./bridge.keys";

const utf8 = (value: string) => new TextEncoder().encode(value);
const recoveryAad = (kdf: BridgeRecoveryWrap["kdf"]) => utf8(JSON.stringify([1, "mains.bridge.v1/recovery", kdf.name, kdf.memoryKiB, kdf.iterations, kdf.parallelism, kdf.salt]));
function normalize(code: string) {
  if (typeof code !== "string") throw new Error("Enter your recovery code");
  const normalized = code.toUpperCase().replace(/[\s-]/g, "");
  if (normalized.length !== 32 || [...normalized].some((c) => !BRIDGE_RECOVERY_ALPHABET.includes(c))) throw new Error("Invalid recovery code");
  return utf8(normalized);
}
export function generateBridgeRecoveryCode(): string {
  // 160 bits of entropy. Formatting never reduces the random alphabet's entropy.
  const bytes = randomBytes(32);
  return Array.from(bytes, (b) => BRIDGE_RECOVERY_ALPHABET[b & 31]).join("").match(/.{4}/g)!.join("-");
}
/** One Argon2id run yields both the wrap key and the recovery signing authority. The authority comes
 * from the code alone, so a device that holds only the account key cannot sign as recovery. */
async function recoveryMaterial(code: string, salt: Uint8Array) {
  const password = normalize(code);
  let stretched: Uint8Array | undefined;
  try {
    stretched = await argon2idAsync(password, salt, { m: 65536, t: 3, p: 1, dkLen: 32, asyncTick: 10 });
    return { wrapKey: hkdf(sha256, stretched, utf8("mains.bridge.v3"), utf8("recovery-wrap"), 32),
      signingSecret: hkdf(sha256, stretched, utf8("mains.bridge.v3"), utf8("recovery-signing"), 32) };
  } finally { password.fill(0); stretched?.fill(0); }
}
export interface BridgeSealedRecovery { wrap: BridgeRecoveryWrap; signingPublicKey: string }
export async function sealBridgeRecovery(accountKey: Uint8Array, code: string): Promise<BridgeSealedRecovery> {
  requireBridgeKey(accountKey);
  const salt = randomBytes(16), nonce = randomBytes(24), { wrapKey, signingSecret } = await recoveryMaterial(code, salt);
  const kdf = { name: "argon2id" as const, memoryKiB: 65536 as const, iterations: 3 as const, parallelism: 1 as const, salt: bridgeBase64(salt) };
  try {
    return { wrap: { v: 1, kdf, nonce: bridgeBase64(nonce), payload: bridgeBase64(xchacha20poly1305(wrapKey, nonce, recoveryAad(kdf)).encrypt(accountKey)) },
      signingPublicKey: bridgeBase64(ed25519.getPublicKey(signingSecret)) };
  } finally { wrapKey.fill(0); signingSecret.fill(0); }
}
/** The caller zeroes both secrets. */
export async function openBridgeRecovery(wrap: BridgeRecoveryWrap, code: string): Promise<{ accountKey: Uint8Array; signingSecret: Uint8Array; signingPublicKey: string }> {
  validateBridgeRecoveryWrap(wrap);
  const { wrapKey, signingSecret } = await recoveryMaterial(code, bridgeBytes(wrap.kdf.salt, 16));
  try {
    const accountKey = xchacha20poly1305(wrapKey, bridgeBytes(wrap.nonce, 24), recoveryAad(wrap.kdf)).decrypt(bridgeBytes(wrap.payload, 48));
    return { accountKey, signingSecret, signingPublicKey: bridgeBase64(ed25519.getPublicKey(signingSecret)) };
  } catch { signingSecret.fill(0); throw new Error("Recovery code does not match this account"); }
  finally { wrapKey.fill(0); }
}
