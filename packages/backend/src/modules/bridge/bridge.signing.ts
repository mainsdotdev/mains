import { ed25519 } from "@noble/curves/ed25519.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { bridgeBase64, bridgeBytes } from "@mains/contracts/bridge-auth";
import { bridgeSigningMessage } from "@mains/contracts/bridge-signing";
import { validateEncryptedBridgeEnvelope } from "@mains/contracts/bridge-wire";
import type { BridgeCodec } from "./bridge.crypto";

export interface BridgeSigningIdentity {
  accountId: string;
  backendId: string;
  signingPrivateKey: Uint8Array;
  localSigningPublicKeys?: readonly string[];
}
/** Membership authentication is a separate seam; the envelope cannot choose its own author key. */
export type BridgeWriterAllowed = (backendId: string, signingPublicKey: string) => boolean;

export function createBridgeSigningCodec(codec: BridgeCodec, identity: BridgeSigningIdentity, allowed: BridgeWriterAllowed): BridgeCodec {
  const { accountId, backendId } = identity;
  if (![accountId, backendId].every((id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id))) throw new Error("Invalid Bridge signing identity");
  const secret = Uint8Array.from(identity.signingPrivateKey), publicKey = bridgeBase64(ed25519.getPublicKey(secret));
  const localKeys = new Set([publicKey, ...identity.localSigningPublicKeys ?? []]);
  for (const key of localKeys) bridgeBytes(key, 32);
  return {
    destroy() { secret.fill(0); codec.destroy?.(); },
    seal(header, body) {
      if (header.origin !== backendId || header.owner && header.owner !== backendId) throw new Error("Cannot sign another Bridge writer's record");
      const envelope = codec.seal(header, body);
      const auth = { v: 1 as const, accountId, epoch: 1 as const,
        publicationId: bridgeBase64(randomBytes(32)), signingPublicKey: publicKey };
      envelope.auth = { ...auth, signature: bridgeBase64(ed25519.sign(bridgeSigningMessage(envelope, auth), secret)) };
      validateEncryptedBridgeEnvelope(envelope);
      return envelope;
    },
    open(envelope) {
      validateEncryptedBridgeEnvelope(envelope);
      const { auth, header } = envelope;
      if (auth.accountId !== accountId || (header.origin === backendId ? !localKeys.has(auth.signingPublicKey) : !allowed(header.origin, auth.signingPublicKey)))
        throw new Error("Bridge record writer is not registered for this account");
      if (!ed25519.verify(bridgeBytes(auth.signature, 64), bridgeSigningMessage(envelope, auth), bridgeBytes(auth.signingPublicKey, 32), { zip215: false }))
        throw new Error("Bridge device signature is invalid");
      return codec.open(envelope);
    },
  };
}
