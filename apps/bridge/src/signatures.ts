import { bridgeBytes } from "@mains/contracts/bridge-auth";
import { bridgeSigningMessage } from "@mains/contracts/bridge-signing";
import { validateEncryptedBridgeEnvelope } from "@mains/contracts/bridge-wire";
import type { BridgeEnvelope } from "@mains/contracts/bridge-protocol";
import type { BridgeIdentity } from "./auth";

/** Verify the complete batch before any publication state, including clocks or tombstones, changes. */
export async function verifyBridgePublication(identity: BridgeIdentity, envelopes: BridgeEnvelope[]): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", bridgeBytes(identity.signingPublicKey, 32), "Ed25519", false, ["verify"]);
    for (const envelope of envelopes) {
      validateEncryptedBridgeEnvelope(envelope);
      const { auth, header } = envelope;
      if (auth.accountId !== identity.accountId || auth.signingPublicKey !== identity.signingPublicKey || header.origin !== identity.backendId ||
          !await crypto.subtle.verify("Ed25519", key, bridgeBytes(auth.signature, 64), bridgeSigningMessage(envelope, auth))) return false;
    }
    return true;
  } catch { return false; }
}
