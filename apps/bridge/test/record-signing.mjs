import { createHash, createPrivateKey, createPublicKey, hkdfSync, randomBytes, sign, verify } from "node:crypto";

/** Deterministic test devices only. Never used by a runtime or development enrollment. */
/** @param {string} accountId @param {string} backendId */
export function fixtureSigningKey(accountId, backendId) {
  return createHash("sha256").update("mains.bridge/test-device-key\0").update(JSON.stringify([accountId, backendId])).digest();
}
/** @param {Buffer} seed */
const privateKey = (seed) => createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), type: "pkcs8", format: "der" });
/** @param {Buffer} seed */
const publicKey = (seed) => createPublicKey(privateKey(seed)).export({ format: "der", type: "spki" }).subarray(-32).toString("base64url");
/** @param {string} accountId @param {string} backendId */
export function fixturePublicKey(accountId, backendId) { return publicKey(fixtureSigningKey(accountId, backendId)); }
/** The account key a fixture account's genesis commits to unless a test supplies its own.
 * @param {string} accountId */
export function fixtureAccountKey(accountId) {
  return createHash("sha256").update("mains.bridge/test-account-key\0").update(accountId).digest();
}
/** @param {Uint8Array} accountKey */
export function fixtureAccountCommitment(accountKey) {
  return Buffer.from(hkdfSync("sha256", accountKey, "mains.bridge.v3", "account-commitment", 32)).toString("base64url");
}
/** Membership needs 32 distinct encryption-key bytes; fixtures never decrypt with them.
 * @param {string} accountId @param {string} backendId */
export function fixtureMember(accountId, backendId) {
  const box = createHash("sha256").update("mains.bridge/test-device-box\0").update(JSON.stringify([accountId, backendId])).digest("base64url");
  return { backendId, publicKey: box, signingPublicKey: fixturePublicKey(accountId, backendId) };
}

/** Independent implementation of the membership entry format (contracts/bridge-membership.ts).
 * @param {any} entry */
function membershipFields(entry) {
  const m = (/** @type {any} */ member) => [member.backendId, member.publicKey, member.signingPublicKey];
  const body = entry.kind === "genesis" ? [...m(entry.body.member), entry.body.recoverySigningPublicKey, entry.body.accountKeyCommitment]
    : entry.kind === "add" ? [...m(entry.body.member), entry.body.via]
    : entry.kind === "remove" ? [entry.body.backendId, entry.body.account.through, entry.body.account.count, entry.body.account.root] : [entry.body.recoverySigningPublicKey];
  return [1, "mains.bridge.v1/membership", entry.accountId, entry.seq, entry.prev, entry.kind, body,
    entry.signer.kind, entry.signer.kind === "device" ? entry.signer.backendId : null, entry.signer.signingPublicKey];
}
/** @param {any} entry */
export function fixtureEntryHash(entry) {
  return createHash("sha256").update(JSON.stringify([...membershipFields(entry), entry.signature])).digest("base64url");
}
/** Signs the entry after `head` (null for genesis) with a fixture device key.
 * @param {string} accountId @param {{ seq: number, hash: string } | null} head @param {string} kind @param {any} body @param {string} signer */
export function fixtureMembershipEntry(accountId, head, kind, body, signer) {
  const entry = { v: 1, accountId, seq: head ? head.seq + 1 : 0, prev: head?.hash ?? null, kind, body,
    signer: { kind: "device", backendId: signer, signingPublicKey: fixturePublicKey(accountId, signer) } };
  return { ...entry, signature: sign(null, Buffer.from(JSON.stringify(membershipFields(entry))), privateKey(fixtureSigningKey(accountId, signer))).toString("base64url") };
}
/** A removal fence over exactly `signatures` (apps/bridge/MEMBERSHIP.md §6).
 * @param {string[]} signatures @param {number} through */
export function fixtureFence(signatures, through) {
  const sorted = [...new Set(signatures)].sort();
  return { signatures: sorted, account: { through, count: sorted.length, root: createHash("sha256").update(JSON.stringify(sorted)).digest("base64url") } };
}
/** @param {string} accountId @param {string} backendId @param {Uint8Array} accountKey */
export function fixtureGenesis(accountId, backendId, accountKey) {
  const recovery = publicKey(createHash("sha256").update("mains.bridge/test-recovery-key\0").update(accountId).digest());
  return fixtureMembershipEntry(accountId, null, "genesis", { member: fixtureMember(accountId, backendId), recoverySigningPublicKey: recovery,
    accountKeyCommitment: fixtureAccountCommitment(accountKey) }, backendId);
}

/** The newest membership head this process admitted fixture backends on, per account. */
const heads = new Map();
/** @param {string} accountId @param {{ seq: number, hash: string }} head */
export function rememberFixtureHead(accountId, head) { if ((heads.get(accountId)?.seq ?? -1) < head.seq) heads.set(accountId, head); }
/** Store-level fixtures never reach the Worker's membership check; a Worker refuses this head. */
const unbound = { seq: 0, hash: createHash("sha256").update("mains.bridge/test-unbound-membership").digest("base64url") };
/** @param {string} accountId @returns {{ seq: number, hash: string }} */
export function fixtureMembershipHead(accountId) { return heads.get(accountId) ?? unbound; }

/** Independent Node/OpenSSL signature implementation for Worker acceptance fixtures. */
/** @template {{header: any, body: any, auth?: any}} T @param {T} envelope @param {string} accountId @param {string} [backendId] @param {{ seq: number, hash: string }} [membership] @returns {T} */
export function signFixture(envelope, accountId, backendId = envelope.header.origin, membership = fixtureMembershipHead(accountId)) {
  const key = privateKey(fixtureSigningKey(accountId, backendId));
  const h = envelope.header;
  const fields = [h.v, h.stream, h.rowKey, h.registerKey ?? null, h.hlc.physicalMs, h.hlc.counter, h.origin, h.op, h.owner ?? null, h.runId ?? null,
    ...(h.blobs === undefined ? h.retention === undefined ? [] : [h.retention] : [h.retention ?? null, h.blobs.map((/** @type {{blobId: string, size: number}} */ blob) => [blob.blobId, blob.size])])];
  const message = (/** @type {any} */ auth) => Buffer.from(JSON.stringify([2, "mains.bridge.v2/signed-record", auth.accountId, auth.epoch, auth.membership.seq, auth.membership.hash,
    auth.publicationId, auth.signingPublicKey, fields, envelope.body.nonce, envelope.body.payload]));
  const existing = envelope.auth;
  if (existing?.v === 2 && existing.accountId === accountId && existing.signingPublicKey === fixturePublicKey(accountId, backendId) &&
      verify(null, message(existing), createPublicKey(privateKey(fixtureSigningKey(accountId, backendId))), Buffer.from(existing.signature, "base64url"))) return envelope;
  const auth = { v: 2, accountId, epoch: 1, membership: { seq: membership.seq, hash: membership.hash },
    publicationId: randomBytes(32).toString("base64url"), signingPublicKey: fixturePublicKey(accountId, backendId) };
  envelope.auth = { ...auth, signature: sign(null, message(auth), key).toString("base64url") };
  return envelope;
}
