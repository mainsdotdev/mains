import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify } from "node:crypto";

/** Deterministic test devices only. Never used by a runtime or development enrollment. */
/** @param {string} accountId @param {string} backendId */
export function fixtureSigningKey(accountId, backendId) {
  return createHash("sha256").update("mains.bridge/test-device-key\0").update(JSON.stringify([accountId, backendId])).digest();
}
/** @param {string} accountId @param {string} backendId */
export function fixturePublicKey(accountId, backendId) {
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), fixtureSigningKey(accountId, backendId)]), type: "pkcs8", format: "der" });
  return createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(-32).toString("base64url");
}
/** Independent Node/OpenSSL signature implementation for Worker acceptance fixtures. */
/** @template {{header: any, body: any, auth?: any}} T @param {T} envelope @param {string} accountId @param {string} [backendId] @returns {T} */
export function signFixture(envelope, accountId, backendId = envelope.header.origin) {
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), fixtureSigningKey(accountId, backendId)]), type: "pkcs8", format: "der" });
  const h = envelope.header;
  const fields = [h.v, h.stream, h.rowKey, h.registerKey ?? null, h.hlc.physicalMs, h.hlc.counter, h.origin, h.op, h.owner ?? null, h.runId ?? null,
    ...(h.blobs === undefined ? h.retention === undefined ? [] : [h.retention] : [h.retention ?? null, h.blobs.map((/** @type {{blobId: string, size: number}} */ blob) => [blob.blobId, blob.size])])];
  const message = (/** @type {any} */ auth) => Buffer.from(JSON.stringify([1, "mains.bridge.v1/signed-record", auth.accountId, auth.epoch, auth.publicationId, auth.signingPublicKey, fields, envelope.body.nonce, envelope.body.payload]));
  const existing = envelope.auth;
  if (existing?.accountId === accountId && existing.signingPublicKey === fixturePublicKey(accountId, backendId) &&
      verify(null, message(existing), createPublicKey(key), Buffer.from(existing.signature, "base64url"))) return envelope;
  const auth = { v: 1, accountId, epoch: 1, publicationId: randomBytes(32).toString("base64url"), signingPublicKey: fixturePublicKey(accountId, backendId) };
  envelope.auth = { ...auth, signature: sign(null, message(auth), key).toString("base64url") };
  return envelope;
}
