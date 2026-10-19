import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bridgeBase64 } from "@mains/contracts/bridge-auth";
import { createBridgeSigningCodec } from "../src/modules/bridge/bridge.signing";
import type { BridgeCodec } from "../src/modules/bridge/bridge.crypto";
import type { BridgeEnvelope } from "@mains/contracts/bridge-protocol";
import { bridgeSigningMessage } from "@mains/contracts/bridge-signing";
import { randomBytes } from "node:crypto";

export function fixtureSigningKey(accountId: string, backendId: string): Uint8Array {
  return createHash("sha256").update("mains.bridge/test-device-key\0").update(JSON.stringify([accountId, backendId])).digest();
}
export function fixtureSigningCodec(accountId: string, backendId: string, codec: BridgeCodec): BridgeCodec {
  return createBridgeSigningCodec(codec, { accountId, backendId, signingPrivateKey: fixtureSigningKey(accountId, backendId) },
    (writer, key) => key === bridgeBase64(ed25519.getPublicKey(fixtureSigningKey(accountId, writer))));
}
/** Deliberately author a bad AEAD/body for receiver rejection tests. */
export function signFixtureEnvelope(accountId: string, envelope: BridgeEnvelope): BridgeEnvelope {
  const secret = fixtureSigningKey(accountId, envelope.header.origin);
  const auth = { v: 1 as const, epoch: 1 as const, accountId, publicationId: randomBytes(32).toString("base64url"), signingPublicKey: bridgeBase64(ed25519.getPublicKey(secret)) };
  return { ...envelope, auth: { ...auth, signature: bridgeBase64(ed25519.sign(bridgeSigningMessage(envelope, auth), secret)) } };
}
