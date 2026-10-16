import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, randomBytes } from "@noble/hashes/utils.js";
import { fromBase64Url, toBase64Url, utf8 } from "./bridge.encoding";
import { formatBridgeVerificationCode, type BridgeSealedAccountKey } from "@mains/contracts/bridge-auth";
export type { BridgeSealedAccountKey } from "@mains/contracts/bridge-auth";

const salt = utf8("mains.bridge.v1");
export function requireBridgeKey(key: Uint8Array): void {
  if (!(key instanceof Uint8Array) || key.length !== 32) throw new Error("Bridge keys must contain 32 bytes");
}
export function deriveBridgeKeys(accountKey: Uint8Array) {
  requireBridgeKey(accountKey);
  const derive = (label: string) => hkdf(sha256, accountKey, salt, utf8(`mains.bridge.v1/${label}`), 32);
  return { bodyKey: derive("body"), recordKey: derive("record"), blobIdKey: derive("blob-id") };
}
export function generateBridgeAccountKey(): Uint8Array { return randomBytes(32); }
/** A separate domain from device codes, recovery signing, record and blob keys. */
export function bridgeAccountFingerprint(accountKey: Uint8Array): string {
  requireBridgeKey(accountKey);
  const bytes = hkdf(sha256, accountKey, utf8("mains.bridge.v2"), utf8("account-verification"), 32);
  try { return formatBridgeVerificationCode(bytes); } finally { bytes.fill(0); }
}
export function generateBridgeDeviceKeyPair() { return x25519.keygen(); }
function wrapMaterial(shared: Uint8Array, ephemeral: Uint8Array, recipient: Uint8Array) {
  const aad = utf8(JSON.stringify([1, "mains.bridge.v1/account-key", toBase64Url(ephemeral), toBase64Url(recipient)]));
  return { aad, key: hkdf(sha256, shared, concatBytes(ephemeral, recipient), utf8("mains.bridge.v1/device-wrap"), 32) };
}
export function sealBridgeAccountKey(accountKey: Uint8Array, recipientPublicKey: Uint8Array): BridgeSealedAccountKey {
  requireBridgeKey(accountKey); requireBridgeKey(recipientPublicKey);
  const ephemeral = x25519.keygen(), nonce = randomBytes(24);
  const shared = x25519.getSharedSecret(ephemeral.secretKey, recipientPublicKey);
  const material = wrapMaterial(shared, ephemeral.publicKey, recipientPublicKey);
  try {
    return { v: 1, ephemeralPublicKey: toBase64Url(ephemeral.publicKey), nonce: toBase64Url(nonce),
      payload: toBase64Url(xchacha20poly1305(material.key, nonce, material.aad).encrypt(accountKey)) };
  } finally { shared.fill(0); ephemeral.secretKey.fill(0); material.key.fill(0); }
}
export function openBridgeAccountKey(wrap: BridgeSealedAccountKey, recipientSecretKey: Uint8Array): Uint8Array {
  requireBridgeKey(recipientSecretKey);
  if (!wrap || wrap.v !== 1 || Object.keys(wrap).length !== 4) throw new Error("Invalid Bridge key wrap");
  const ephemeral = fromBase64Url(wrap.ephemeralPublicKey, 32), recipient = x25519.getPublicKey(recipientSecretKey);
  const shared = x25519.getSharedSecret(recipientSecretKey, ephemeral);
  const material = wrapMaterial(shared, ephemeral, recipient);
  try { return xchacha20poly1305(material.key, fromBase64Url(wrap.nonce, 24), material.aad).decrypt(fromBase64Url(wrap.payload, 48)); }
  finally { shared.fill(0); material.key.fill(0); }
}
