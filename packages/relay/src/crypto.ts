import { x25519 } from "@noble/curves/ed25519.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes } from "@noble/hashes/utils.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
export const RELAY_PROOF = "mains.relay.challenge.v1";
const MAX_PLAINTEXT_BYTES = 4 * 1024 * 1024;

export function encodeKey(bytes: Uint8Array): string {
  let binary = "";
  // Hermes limits variadic calls to 4096 arguments. Stay below that ceiling
  // even for history/file frames much larger than a handshake.
  for (let i = 0; i < bytes.length; i += 2048) binary += String.fromCharCode(...bytes.subarray(i, i + 2048));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decodeKey(value: unknown, length?: number): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 6 * 1024 * 1024) throw new Error("Invalid relay encoding");
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  if ((length !== undefined && bytes.length !== length) || encodeKey(bytes) !== value) throw new Error("Invalid relay key");
  return bytes;
}
export const relayPublicKey = (secret: Uint8Array): string => encodeKey(x25519.getPublicKey(secret));
export const relaySharedKey = (secret: Uint8Array, publicKey: unknown): Uint8Array => x25519.getSharedSecret(secret, decodeKey(publicKey, 32));

export interface RelayBox { sequence: number; ciphertext: string }

function channel(key: Uint8Array, aad: Uint8Array) {
  let sent = 0, received = 0;
  const nonce = (sequence: number) => {
    const bytes = new Uint8Array(24);
    new DataView(bytes.buffer).setBigUint64(16, BigInt(sequence), false);
    return bytes;
  };
  return {
    seal(text: string): RelayBox {
      const bytes = encoder.encode(text);
      if (bytes.length > MAX_PLAINTEXT_BYTES || !Number.isSafeInteger(sent)) throw new Error("Relay message exceeds limit");
      const sequence = sent++;
      return { sequence, ciphertext: encodeKey(xchacha20poly1305(key, nonce(sequence), aad).encrypt(bytes)) };
    },
    open(value: unknown): string {
      const box = value as RelayBox | null;
      if (!box || box.sequence !== received || !Number.isSafeInteger(received)) throw new Error("Invalid relay sequence");
      const bytes = decodeKey(box.ciphertext);
      if (bytes.length > MAX_PLAINTEXT_BYTES + 16) throw new Error("Relay message exceeds limit");
      const plaintext = xchacha20poly1305(key, nonce(received), aad).decrypt(bytes);
      const text = decoder.decode(plaintext);
      received++;
      return text;
    },
  };
}

/** Fresh nonces on BOTH ends prevent an untrusted relay from replaying a prior
 * authentication/command stream. Direction keys and strict counters fence
 * reflection, duplication, reordering and cross-device/session substitution. */
export function createRelaySession(shared: Uint8Array, backendId: string, deviceId: string, clientNonce: unknown, serverNonce: unknown) {
  const context = encoder.encode(JSON.stringify(["mains.relay.e2ee.v1", backendId, deviceId]));
  const salt = concatBytes(decodeKey(clientNonce, 32), decodeKey(serverNonce, 32));
  const derive = (direction: string) => hkdf(sha256, shared, salt, concatBytes(context, encoder.encode(direction)), 32);
  return { toBackend: channel(derive("device-to-backend"), context), toDevice: channel(derive("backend-to-device"), context) };
}
