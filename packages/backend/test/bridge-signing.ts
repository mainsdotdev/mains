import { createHash, randomBytes } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bridgeBase64 } from "@mains/contracts/bridge-auth";
import type { BridgeMembershipHead } from "@mains/contracts/bridge-membership";
import type { BridgeEnvelope } from "@mains/contracts/bridge-protocol";
import { bridgeSigningMessage } from "@mains/contracts/bridge-signing";
import { createBridgeSigningCodec, type BridgeSigningMembership } from "../src/modules/bridge/bridge.signing";
import { createBridgeMembershipView, type BridgeMembershipView } from "../src/modules/bridge/bridge.membership";
import { bridgeAccountKeyCommitment } from "../src/modules/bridge/bridge.keys";
import type { BridgeCodec } from "../src/modules/bridge/bridge.crypto";

export function fixtureSigningKey(accountId: string, backendId: string): Uint8Array {
  return createHash("sha256").update("mains.bridge/test-device-key\0").update(JSON.stringify([accountId, backendId])).digest();
}
/** Mirrors apps/bridge/test/record-signing.mjs: the key a fixture account's genesis commits to by default. */
export function fixtureAccountKey(accountId: string): Uint8Array {
  return createHash("sha256").update("mains.bridge/test-account-key\0").update(accountId).digest();
}
export interface FixtureMembershipHub {
  readonly url: string;
  admit(accountId: string, backendId: string, accountKey?: Uint8Array): Promise<BridgeMembershipHead>;
  token(accountId: string, backendId: string): Promise<string>;
}
/** Admits `backendIds` in order on the local hub, then verifies the account's log as a backend would. */
export async function fixtureMembership(hub: FixtureMembershipHub, accountId: string, backendIds: string[], accountKey?: Uint8Array): Promise<BridgeMembershipView> {
  for (const backendId of backendIds) await hub.admit(accountId, backendId, accountKey);
  const view = createBridgeMembershipView({ hubUrl: hub.url, token: () => hub.token(accountId, backendIds[0]), accountId,
    accountKeyCommitment: bridgeAccountKeyCommitment(accountKey ?? fixtureAccountKey(accountId)) });
  await view.refresh();
  return view;
}
export function fixtureHead(membership: BridgeSigningMembership): BridgeMembershipHead {
  const state = membership.current();
  if (!state) throw new Error("Fixture membership is not loaded");
  return { seq: state.seq, hash: state.head };
}
export function fixtureSigningCodec(accountId: string, backendId: string, codec: BridgeCodec, membership: BridgeSigningMembership): BridgeCodec {
  return createBridgeSigningCodec(codec, { accountId, backendId, signingPrivateKey: fixtureSigningKey(accountId, backendId) }, membership);
}
/** Deliberately author a bad AEAD/body for receiver rejection tests. */
export function signFixtureEnvelope(accountId: string, envelope: BridgeEnvelope, membership: BridgeMembershipHead): BridgeEnvelope {
  const secret = fixtureSigningKey(accountId, envelope.header.origin);
  const auth = { v: 2 as const, epoch: 1 as const, accountId, membership, publicationId: randomBytes(32).toString("base64url"), signingPublicKey: bridgeBase64(ed25519.getPublicKey(secret)) };
  return { ...envelope, auth: { ...auth, signature: bridgeBase64(ed25519.sign(bridgeSigningMessage(envelope, auth), secret)) } };
}
