import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { OperationsError, sha256, sameTarget, type BackupFile, type OperationsTarget } from "./operations-lib";
import type { HubSnapshot, HubPage } from "../src/hub-backup";

const day = 86_400_000;
export const RETENTION_DAYS = 35;
export interface SealedFile extends BackupFile { key: string }
export interface AutomaticManifest {
  version: 2; target: OperationsTarget; startedAt: string; completedAt: string;
  files: SealedFile[]; accounts: { accountId: string; snapshot: string; pages: { table: string; path: string }[] }[];
}
export interface ObjectReceipt { key: string; size: number; sha256: string; etag: string }
export interface SnapshotIndex {
  version: 1; root: string; completedAt: string; manifest: ObjectReceipt; objects: ObjectReceipt[];
}

export function backupKeyPair() {
  const pair = generateKeyPairSync("x25519");
  return { publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(), privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
}
function publicId(pem: string) { return sha256(createPublicKey(pem).export({ type: "spki", format: "der" })); }
export function backupRoot(target: OperationsTarget, publicKey: string) {
  return `v1/${target.environment}/${sha256(JSON.stringify([target.accountId, target.worker, target.databaseId, target.blobs, target.archive]))}/${publicId(publicKey)}`;
}
/** X25519 + HKDF-SHA256 + AES-256-GCM. The scheduler has ONLY the public key.
 * Environment/object path and the complete header are authenticated as AAD. */
export function seal(bytes: Uint8Array, publicKey: string, key: string): Buffer {
  const recipient = createPublicKey(publicKey);
  if (recipient.asymmetricKeyType !== "x25519") throw new OperationsError("Use an X25519 backup public key");
  const ephemeral = generateKeyPairSync("x25519"), nonce = randomBytes(12);
  const header = Buffer.from(JSON.stringify({ version: 1, ephemeral: ephemeral.publicKey.export({ type: "spki", format: "der" }).toString("base64") }));
  const secret = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient });
  const aes = hkdfSync("sha256", secret, Buffer.from(sha256(key), "hex"), "mains-bridge-backup:v1", 32);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(aes), nonce);
  cipher.setAAD(Buffer.concat([Buffer.from(key + "\n"), header]));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]), length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  return Buffer.concat([Buffer.from("MBK1"), length, header, nonce, cipher.getAuthTag(), ciphertext]);
}
export function unseal(bytes: Uint8Array, privateKey: string, key: string): Buffer {
  try {
    const source = Buffer.from(bytes), length = source.readUInt32BE(4);
    if (source.subarray(0, 4).toString() !== "MBK1" || length > 1024 || source.length < 8 + length + 28) throw new Error();
    const header = source.subarray(8, 8 + length), parsed = JSON.parse(header.toString());
    if (parsed.version !== 1) throw new Error();
    const secret = diffieHellman({ privateKey: createPrivateKey(privateKey), publicKey: createPublicKey({ key: Buffer.from(parsed.ephemeral, "base64"), type: "spki", format: "der" }) });
    const aes = hkdfSync("sha256", secret, Buffer.from(sha256(key), "hex"), "mains-bridge-backup:v1", 32);
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(aes), source.subarray(8 + length, 20 + length));
    decipher.setAAD(Buffer.concat([Buffer.from(key + "\n"), header]));
    decipher.setAuthTag(source.subarray(20 + length, 36 + length));
    return Buffer.concat([decipher.update(source.subarray(36 + length)), decipher.final()]);
  } catch { throw new OperationsError("Backup decryption/authentication failed"); }
}
async function body(bucket: any, key: string): Promise<Buffer> {
  const object = await bucket.get(key);
  // Remote binding proxies transfer .body on access; read that property once.
  const stream = object?.body;
  if (!stream) throw new OperationsError("Backup object is missing");
  return Buffer.from(await new Response(stream).arrayBuffer());
}
export async function listObjects(bucket: any, prefix: string): Promise<any[]> {
  const objects = []; let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 }); objects.push(...page.objects);
    if (page.truncated && (!page.cursor || page.cursor === cursor)) throw new OperationsError("Invalid backup pagination");
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}
export async function backupLease(bucket: any, root: string, handle: (guard: () => void) => Promise<void>, now = Date.now()) {
  const key = `${root}/lease`, expiresAt = now + 2 * 3_600_000;
  const previous = await bucket.get(key);
  if (previous && JSON.parse((await new Response(previous.body).text())).expiresAt > now) throw new OperationsError("Another backup/retention job holds the environment lease");
  const locked = await bucket.put(key, JSON.stringify({ expiresAt }), { onlyIf: previous ? { etagMatches: previous.etag } : { etagDoesNotMatch: "*" } });
  if (!locked) throw new OperationsError("Another backup acquired the environment lease");
  const guard = () => { if (Date.now() >= expiresAt - 60_000) throw new OperationsError("Backup lease expired; no snapshot may be published"); };
  try { await handle(guard); }
  finally {
    // Conditional replacement, not a racy HEAD+DELETE of a newer owner's lock.
    await bucket.put(key, JSON.stringify({ expiresAt: 0 }), { onlyIf: { etagMatches: locked.etag } });
  }
}
function receipt(key: string, object: any): ObjectReceipt {
  const meta = object.customMetadata;
  if (!meta || !/^[a-f0-9]{64}$/.test(meta.sealedSha ?? "") || !/^[a-f0-9]{64}$/.test(meta.plainSha ?? "") || !/^\d+$/.test(meta.plainSize ?? "") ||
    meta.sealedMd5 !== object.etag) throw new OperationsError("Backup object integrity metadata mismatch");
  return { key, size: object.size, sha256: meta.sealedSha, etag: object.etag };
}

/** One immutable object per source key+ETag (or file digest), per environment
 * and encryption key. Existing objects need HEAD only; new writes are read back
 * and checked before any completed snapshot can refer to them. */
export async function storeSealed(bucket: any, root: string, id: string, publicKey: string, load: () => Promise<Uint8Array>, verified = new Map<string, ObjectReceipt>()) {
  const key = `${root}/objects/${sha256(id)}`;
  let stored = await bucket.head(key);
  if (!stored) {
    const plain = await load(), bytes = seal(plain, publicKey, key);
    await bucket.put(key, bytes, { onlyIf: { etagDoesNotMatch: "*" },
      customMetadata: { plainSize: String(plain.byteLength), plainSha: sha256(plain), sealedSha: sha256(bytes), sealedMd5: createHash("md5").update(bytes).digest("hex") },
      httpMetadata: { contentType: "application/octet-stream" } });
    stored = await bucket.head(key);
  }
  if (!stored) throw new OperationsError("Backup write was not committed");
  const proof = receipt(key, stored), prior = verified.get(key);
  if (!prior || prior.etag !== proof.etag || prior.sha256 !== proof.sha256 || prior.size !== proof.size) {
    // A previous process can die between PUT and verification. Only references
    // from a completed snapshot (or this run's read-back) may skip this GET.
    const bytes = await body(bucket, key);
    if (bytes.length !== proof.size || sha256(bytes) !== proof.sha256) throw new OperationsError("New backup object verification failed");
    verified.set(key, proof);
  }
  return { receipt: proof, plainSize: Number(stored.customMetadata.plainSize), plainSha: stored.customMetadata.plainSha as string };
}

export async function captureAccount(ops: any, accountId: string, write: (path: string, bytes: string, table?: string) => Promise<void>, prefix: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot: HubSnapshot = await ops.snapshotBegin(accountId), pages: { table: string; path: string }[] = [];
    if (snapshot.version !== 1 || !Array.isArray(snapshot.tables) || snapshot.tables.length > 64) throw new OperationsError("Unsupported hub snapshot");
    let changed = false;
    for (const table of snapshot.tables) {
      let after = 0;
      for (;;) {
        const page: HubPage = await ops.snapshotPage(accountId, snapshot.token, table, after);
        if (page.changed) { changed = true; break; }
        if (!Array.isArray(page.rows) || (!page.done && (!Number.isSafeInteger(page.next) || page.next <= after))) throw new OperationsError("Invalid hub snapshot page");
        const path = `${prefix}/${attempt}/${pages.length}.json`;
        await write(path, JSON.stringify(page), table); pages.push({ table, path }); after = page.next;
        if (page.done) break;
      }
      if (changed) break;
    }
    if (!changed && await ops.snapshotValid(accountId, snapshot.token)) {
      const path = `${prefix}/${attempt}/snapshot.json`;
      await write(path, JSON.stringify(snapshot));
      return { accountId, snapshot: path, pages };
    }
  }
  throw new OperationsError("Account changed during all three backup attempts; no completed backup was published. Retry when activity settles");
}

/** Caller serializes runs per environment (the workflow has a concurrency
 * group). No live bucket is ever passed to retention. A completion index is the
 * LAST write and contains opaque references only, not identities/auth SQL. */
export async function publishSnapshot(bucket: any, root: string, publicKey: string, manifest: AutomaticManifest, refs: ObjectReceipt[]) {
  const bytes = Buffer.from(JSON.stringify(manifest));
  const sealed = await storeSealed(bucket, root, `manifest:${sha256(bytes)}`, publicKey, async () => bytes);
  const index: SnapshotIndex = { version: 1, root, completedAt: manifest.completedAt, manifest: sealed.receipt, objects: [...new Map(refs.map((ref) => [ref.key, ref])).values()] };
  for (const ref of [index.manifest, ...index.objects]) {
    const head = await bucket.head(ref.key);
    if (!head || head.size !== ref.size || head.etag !== ref.etag) throw new OperationsError("Backup changed before completion");
  }
  const key = `${root}/snapshots/${manifest.completedAt.replace(/[:.]/g, "-")}-${randomUUID()}.json`;
  const encoded = JSON.stringify(index);
  if (!await bucket.put(key, encoded, { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "application/json" } })) throw new OperationsError("Snapshot completion write failed");
  if ((await body(bucket, key)).toString() !== encoded) throw new OperationsError("Snapshot completion verification failed");
  return key;
}
function validateIndex(index: SnapshotIndex, root: string): void {
  if (index.version !== 1 || index.root !== root || !Number.isFinite(Date.parse(index.completedAt)) || !Array.isArray(index.objects)) throw new OperationsError("Invalid backup completion index; retention stopped");
  for (const ref of [index.manifest, ...index.objects]) {
    if (!ref || !new RegExp(`^${root}/objects/[a-f0-9]{64}$`).test(ref.key) || !Number.isSafeInteger(ref.size) || ref.size <= 0 || !/^[a-f0-9]{64}$/.test(ref.sha256) || !/^[a-f0-9]{32}$/.test(ref.etag)) throw new OperationsError("Invalid backup reference; retention stopped");
  }
}
export async function snapshotIndexes(bucket: any, root: string) {
  const indexes = [];
  for (const item of await listObjects(bucket, `${root}/snapshots/`)) {
    const index = JSON.parse((await body(bucket, item.key)).toString()) as SnapshotIndex;
    validateIndex(index, root); indexes.push({ key: item.key as string, index });
  }
  return indexes;
}
export async function checkFreshness(bucket: any, root: string, now = Date.now(), maxAgeHours = 36) {
  const indexes = await snapshotIndexes(bucket, root), newest = Math.max(...indexes.map(({ index }) => Date.parse(index.completedAt)));
  if (!Number.isFinite(newest) || newest > now + 300_000 || now - newest > maxAgeHours * 3_600_000) throw new OperationsError("Bridge backup is missing or stale; inspect the backup workflow");
  return new Date(newest).toISOString();
}
export async function pruneSnapshots(bucket: any, root: string, now = Date.now()) {
  const indexes = await snapshotIndexes(bucket, root);
  // Never discard the last known successful backup because a scheduler stopped.
  const newest = Math.max(...indexes.map(({ index }) => Date.parse(index.completedAt)));
  const keep = indexes.filter(({ index }) => Date.parse(index.completedAt) >= now - RETENTION_DAYS * day || Date.parse(index.completedAt) === newest);
  if (!keep.length) throw new OperationsError("No completed backup; retention stopped");
  const referenced = new Set(keep.flatMap(({ index }) => [index.manifest, ...index.objects].map((ref) => ref.key)));
  // Validate ALL retained references before deleting even one expired snapshot.
  for (const { index } of keep) for (const ref of [index.manifest, ...index.objects]) {
    const head = await bucket.head(ref.key);
    if (!head || head.etag !== ref.etag || head.size !== ref.size) throw new OperationsError("Retained backup is incomplete; retention stopped");
  }
  for (const item of indexes) if (!keep.includes(item)) await bucket.delete(item.key);
  let deleted = 0;
  // Orphans from interrupted attempts have 48h grace. A workflow times out in
  // 90 minutes; concurrency serialization also covers the freshness job.
  for (const item of await listObjects(bucket, `${root}/objects/`)) {
    if (!referenced.has(item.key) && new Date(item.uploaded).getTime() < now - 2 * day) { await bucket.delete(item.key); deleted++; }
  }
  return { retainedSnapshots: keep.length, deletedObjects: deleted };
}

export async function downloadSnapshot(bucket: any, indexKey: string, target: OperationsTarget, privateKey: string,
  write: (path: string, bytes: Uint8Array) => Promise<void>): Promise<AutomaticManifest> {
  const root = backupRoot(target, createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString());
  if (!indexKey.startsWith(`${root}/snapshots/`)) throw new OperationsError("Backup belongs to another environment or key");
  const index = JSON.parse((await body(bucket, indexKey)).toString()) as SnapshotIndex; validateIndex(index, root);
  const open = async (ref: ObjectReceipt) => {
    const bytes = await body(bucket, ref.key);
    if (bytes.length !== ref.size || sha256(bytes) !== ref.sha256) throw new OperationsError("Backup ciphertext checksum mismatch");
    return unseal(bytes, privateKey, ref.key);
  };
  const manifest = JSON.parse((await open(index.manifest)).toString()) as AutomaticManifest;
  if (manifest.version !== 2 || !sameTarget(manifest.target, target) || !Array.isArray(manifest.files) || !Array.isArray(manifest.accounts)) throw new OperationsError("Invalid encrypted backup manifest");
  for (const file of manifest.files) {
    const ref = index.objects.find((candidate) => candidate.key === file.key);
    if (!ref) throw new OperationsError("Backup file is not in the completed index");
    const bytes = await open(ref);
    if (bytes.length !== file.size || sha256(bytes) !== file.sha256) throw new OperationsError("Decrypted backup checksum mismatch");
    await write(file.path, bytes);
  }
  return manifest;
}
export async function readBackupKey(path: string) { return readFile(join(path), "utf8"); }
