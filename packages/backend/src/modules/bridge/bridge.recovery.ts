import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { argon2idAsync } from "@noble/hashes/argon2.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { BRIDGE_RECOVERY_ALPHABET, bridgeBase64, bridgeBytes, bridgeRecoveryMessage, validateBridgeRecoveryWrap,
  type BridgeDeviceIdentity, type BridgeRecoveryWrap, type BridgeSealedAccountKey } from "@mains/contracts/bridge-auth";
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
const signingSeed = (key: Uint8Array) => hkdf(sha256, key, utf8("mains.bridge.v1"), utf8("mains.bridge.v1/recovery-signing"), 32);
export function bridgeRecoveryPublicKey(accountKey: Uint8Array): string {
  requireBridgeKey(accountKey); const seed = signingSeed(accountKey);
  try { return bridgeBase64(ed25519.getPublicKey(seed)); } finally { seed.fill(0); }
}
async function recoveryKey(code: string, salt: Uint8Array) {
  const password = normalize(code);
  try { return await argon2idAsync(password, salt, { m: 65536, t: 3, p: 1, dkLen: 32, asyncTick: 10 }); }
  finally { password.fill(0); }
}
export async function sealBridgeRecovery(accountKey: Uint8Array, code: string): Promise<BridgeRecoveryWrap> {
  requireBridgeKey(accountKey);
  const salt = randomBytes(16), nonce = randomBytes(24), key = await recoveryKey(code, salt);
  const kdf = { name: "argon2id" as const, memoryKiB: 65536 as const, iterations: 3 as const, parallelism: 1 as const, salt: bridgeBase64(salt) };
  try { return { v: 1, kdf, nonce: bridgeBase64(nonce), payload: bridgeBase64(xchacha20poly1305(key, nonce, recoveryAad(kdf)).encrypt(accountKey)) }; }
  finally { key.fill(0); }
}
export async function openBridgeRecovery(wrap: BridgeRecoveryWrap, code: string): Promise<Uint8Array> {
  validateBridgeRecoveryWrap(wrap);
  const key = await recoveryKey(code, bridgeBytes(wrap.kdf.salt, 16));
  try { return xchacha20poly1305(key, bridgeBytes(wrap.nonce, 24), recoveryAad(wrap.kdf)).decrypt(bridgeBytes(wrap.payload, 48)); }
  catch { throw new Error("Recovery code does not match this account"); }
  finally { key.fill(0); }
}
export function signBridgeRecovery(accountKey: Uint8Array, recipient: BridgeDeviceIdentity, challenge: string, wrap: BridgeSealedAccountKey): string {
  const seed = signingSeed(accountKey);
  try { return bridgeBase64(ed25519.sign(bridgeRecoveryMessage(recipient, challenge, wrap), seed)); }
  finally { seed.fill(0); }
}
