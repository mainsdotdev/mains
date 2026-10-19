import type { BridgeEnvelope, BridgeHeader, BridgeRecordSignature } from "./bridge-protocol";

/** Fixed positions cover every admitted routing field, including optional-field presence. */
export function bridgeHeaderFields(header: BridgeHeader): unknown[] {
  return [header.v, header.stream, header.rowKey, header.registerKey ?? null,
    header.hlc.physicalMs, header.hlc.counter, header.origin, header.op, header.owner ?? null, header.runId ?? null,
    ...(header.blobs === undefined ? header.retention === undefined ? [] : [header.retention] :
      [header.retention ?? null, header.blobs.map(({ blobId, size }) => [blobId, size])])];
}

/** Signature input is independent of JSON property order and contains no plaintext. */
export function bridgeSigningMessage(envelope: BridgeEnvelope, auth: Omit<BridgeRecordSignature, "signature">): Uint8Array {
  return new TextEncoder().encode(JSON.stringify([2, "mains.bridge.v2/signed-record", auth.accountId, auth.epoch, auth.membership.seq, auth.membership.hash,
    auth.publicationId, auth.signingPublicKey, bridgeHeaderFields(envelope.header), envelope.body.nonce, envelope.body.payload]));
}
