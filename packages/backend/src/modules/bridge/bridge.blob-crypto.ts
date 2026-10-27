import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, randomBytes } from "@noble/hashes/utils.js";
import { BRIDGE_BLOB_CIPHER_OVERHEAD, bridgeBlobChunkCount, bridgeBlobChunkSize, validateBridgeBlobIdentity, type BridgeBlobIdentity } from "@mains/contracts/bridge-blobs";
import { deriveBridgeKeys, requireBridgeKey } from "./bridge.keys";
import { toBase64Url, utf8 } from "./bridge.encoding";

export function createBridgeBlobCrypto(accountKey: Uint8Array) {
  requireBridgeKey(accountKey);
  const account = Uint8Array.from(accountKey), identity = deriveBridgeKeys(account).blobIdKey;
  const aad = (ref: BridgeBlobIdentity, index: number) => utf8(JSON.stringify([1, ref.blobId, ref.size, index, bridgeBlobChunkCount(ref.size)]));
  const keyFor = (ref: BridgeBlobIdentity) => hkdf(sha256, account, utf8("mains.bridge.v1"), utf8(`mains.bridge.v1/blob:${ref.blobId}`), 32);
  let stopped = false;
  const check = () => { if (stopped) throw new Error("Bridge blob crypto is stopped"); };
  return {
    id(bytes: Uint8Array): string { check(); return toBase64Url(hmac(sha256, identity, sha256(bytes))); },
    seal(ref: BridgeBlobIdentity, index: number, plaintext: Uint8Array): Uint8Array {
      check(); validateBridgeBlobIdentity(ref);
      if (plaintext.length !== bridgeBlobChunkSize(ref.size, index)) throw new Error("Invalid Bridge plaintext chunk length");
      const key = keyFor(ref), nonce = randomBytes(24);
      try { return concatBytes(nonce, xchacha20poly1305(key, nonce, aad(ref, index)).encrypt(plaintext)); }
      finally { key.fill(0); }
    },
    open(ref: BridgeBlobIdentity, index: number, ciphertext: Uint8Array): Uint8Array {
      check(); validateBridgeBlobIdentity(ref);
      if (ciphertext.length !== bridgeBlobChunkSize(ref.size, index) + BRIDGE_BLOB_CIPHER_OVERHEAD) throw new Error("Invalid Bridge ciphertext chunk length");
      const key = keyFor(ref);
      try { return xchacha20poly1305(key, ciphertext.subarray(0, 24), aad(ref, index)).decrypt(ciphertext.subarray(24)); }
      finally { key.fill(0); }
    },
    destroy() { stopped = true; account.fill(0); identity.fill(0); },
  };
}
