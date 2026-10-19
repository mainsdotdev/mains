import { ed25519 } from "@noble/curves/ed25519.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { bridgeBase64, bridgeBytes } from "@mains/contracts/bridge-auth";
import { bridgeMember, bridgeWriterKey } from "@mains/contracts/bridge-membership";
import { bridgeSigningMessage } from "@mains/contracts/bridge-signing";
import { validateEncryptedBridgeEnvelope } from "@mains/contracts/bridge-wire";
import type { BridgeCodec } from "./bridge.crypto";
import type { BridgeMembershipView } from "./bridge.membership";

export interface BridgeSigningIdentity {
  accountId: string;
  backendId: string;
  signingPrivateKey: Uint8Array;
}
/** Verified membership is the only source of writer keys; the envelope cannot choose its own author key. */
export type BridgeSigningMembership = Pick<BridgeMembershipView, "current" | "fence">;

export function createBridgeSigningCodec(codec: BridgeCodec, identity: BridgeSigningIdentity, membership: BridgeSigningMembership): BridgeCodec {
  const { accountId, backendId } = identity;
  if (![accountId, backendId].every((id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id))) throw new Error("Invalid Bridge signing identity");
  const secret = Uint8Array.from(identity.signingPrivateKey), publicKey = bridgeBase64(ed25519.getPublicKey(secret));
  return {
    destroy() { secret.fill(0); codec.destroy?.(); },
    seal(header, body) {
      if (header.origin !== backendId || header.owner && header.owner !== backendId) throw new Error("Cannot sign another Bridge writer's record");
      // A writer binds the newest head it verified, which must still list its current key.
      const state = membership.current();
      if (!state || bridgeMember(state, backendId)?.signingPublicKey !== publicKey) throw new Error("This backend is not a member of the Bridge account");
      const envelope = codec.seal(header, body);
      const auth = { v: 2 as const, accountId, epoch: 1 as const, membership: { seq: state.seq, hash: state.head },
        publicationId: bridgeBase64(randomBytes(32)), signingPublicKey: publicKey };
      envelope.auth = { ...auth, signature: bridgeBase64(ed25519.sign(bridgeSigningMessage(envelope, auth), secret)) };
      validateEncryptedBridgeEnvelope(envelope);
      return envelope;
    },
    open(envelope) {
      validateEncryptedBridgeEnvelope(envelope);
      const { auth, header } = envelope, bound = auth.membership, state = membership.current();
      if (auth.accountId !== accountId) throw new Error("Bridge record belongs to another account");
      // Replication refreshes membership before a page that binds a newer head (MEMBERSHIP.md §5).
      if (!state || bound.seq > state.seq) throw new Error("Bridge record binds membership this device has not verified");
      if (state.hashes[bound.seq] !== bound.hash) throw new Error("Bridge record binds a different membership history");
      const key = bridgeWriterKey(state, header.origin, auth.signingPublicKey, bound.seq);
      if (!key) throw new Error("Bridge record writer is not a member of this account");
      // After a removal, the removed writer's account records are exactly those its fence admits, however
      // early they bind; run streams are fenced separately (MEMBERSHIP.md §6).
      if (key.until !== null && header.stream === "account" && !membership.fence(key.until)?.has(auth.signature))
        throw new Error("Bridge record from a removed writer is outside its removal fence");
      if (!ed25519.verify(bridgeBytes(auth.signature, 64), bridgeSigningMessage(envelope, auth), bridgeBytes(auth.signingPublicKey, 32), { zip215: false }))
        throw new Error("Bridge device signature is invalid");
      return codec.open(envelope);
    },
  };
}
