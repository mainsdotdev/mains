import { BRIDGE_BLOB_CIPHER_OVERHEAD, BRIDGE_BLOB_GC_GRACE_MS, bridgeBlobChunkCount, bridgeBlobChunkSize, type BridgeBlobIdentity } from "@mains/contracts/bridge-blobs";
import type { BridgeIdentity } from "./auth";
import { archiveBlobChunks } from "./blob-archive";

export interface BlobReservation { key: string; bytes: number }
export class BridgeQuotaError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function bridgeAccountPrefix(accountId: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(accountId)))].map((b) => b.toString(16).padStart(2, "0")).join("") + "/";
}

type AccountGate = <T>(work: () => Promise<T>) => Promise<T>;

/** Durable ciphertext lifecycle; every SQL transition runs under the account gate.
 *
 * absent -> reserved: charge capacity and protect the blob's grace period.
 * reserved -> uploading: persist an intent before dispatching immutable R2 PUT.
 * uploading -> stored: atomically charge the receipt, renew grace, remove intent.
 * interrupted -> reserved/stored: HEAD must reconcile before releasing its pin.
 * unreferenced -> deleting: fence publication before R2 deletion; release bytes
 * only after physical deletion succeeds. Failures retain the intent and charge.
 * PUT I/O alone leaves the gate; live intents protect all chunks of that blob.
 */
export function createBlobLifecycle(storage: DurableObjectStorage, bucket: R2Bucket, options: {
  archive?: R2Bucket;
  authorize: (identity: BridgeIdentity) => Promise<boolean>;
  canUpload: (accountId: string) => Promise<boolean>;
}) {
  const sql = storage.sql;
  const collector = createBlobCollector(storage, bucket, options.archive);
  const activeUploads = new Set<string>(), inFlight = new Map<string, Promise<void>>();
  let accountPrefix: string | undefined;
  let initialized = false;
  function commitStored(key: string, bytes: number, uploadId?: string) {
    storage.transactionSync(() => {
      if (uploadId && (!sql.exec("SELECT 1 FROM blob_uploads WHERE key=? AND upload_id=?", key, uploadId).toArray().length ||
          !sql.exec("SELECT 1 FROM quota_chunks WHERE key=? AND bytes=?", key, bytes).toArray().length))
        throw new Error("Blob upload intent changed");
      // The receipt, grace renewal and intent release are one transition,
      // including recovery. A SQL failure preserves both charge and GC pin.
      sql.exec("UPDATE quota_chunks SET bytes=?,stored=1,expires_at=0 WHERE key=?", bytes, key);
      collector.protect(key.slice(65,108));
      if (uploadId) sql.exec("DELETE FROM blob_uploads WHERE key=? AND upload_id=?", key, uploadId);
    });
  }
  async function recoverUploads(key?: string) {
    const pending = key ? sql.exec<{ key: string; upload_id: string }>("SELECT key,upload_id FROM blob_uploads WHERE key=?", key).toArray() :
      sql.exec<{ key: string; upload_id: string }>("SELECT key,upload_id FROM blob_uploads LIMIT 32").toArray();
    for (const entry of pending) {
      // A deadline alone must never release a live writer's reservation. The
      // current DO retains its promises while I/O is pending; after a reset,
      // unresolved intents are reconciled before releasing bytes or GC pins.
      if (activeUploads.has(entry.upload_id)) continue;
      const object = await bucket.head(entry.key);
      const reservation = sql.exec<{ bytes: number }>("SELECT bytes FROM quota_chunks WHERE key=?", entry.key).toArray()[0];
      if (object && (!reservation || object.size !== reservation.bytes)) throw new Error("Unresolved blob upload length differs");
      if (object) commitStored(entry.key, object.size, entry.upload_id);
      else sql.exec("DELETE FROM blob_uploads WHERE key=? AND upload_id=?", entry.key, entry.upload_id);
    }
  }
  async function reconcile(accountId: string) {
    if (!initialized) {
      accountPrefix = await bridgeAccountPrefix(accountId);
      collector.setAccountPrefix(accountPrefix);
      if (!sql.exec("SELECT 1 FROM quota_state WHERE id=1").toArray().length) {
        let cursor: string | undefined;
        do {
          const page = await bucket.list({ prefix: await bridgeAccountPrefix(accountId), cursor });
          for (const object of page.objects) sql.exec("INSERT INTO quota_chunks(key,bytes,stored,expires_at) VALUES(?,?,1,0) ON CONFLICT(key) DO UPDATE SET bytes=excluded.bytes,stored=1,expires_at=0", object.key, object.size);
          cursor = page.truncated ? page.cursor : undefined;
        } while (cursor);
        sql.exec("INSERT OR REPLACE INTO quota_state VALUES(1,1)");
      }
      initialized = true;
    }
    await recoverUploads();
    const expired = sql.exec<{ key: string }>(`SELECT key FROM quota_chunks q WHERE stored=0 AND expires_at<=?
      AND NOT EXISTS(SELECT 1 FROM blob_uploads u WHERE u.key=q.key)`, Date.now()).toArray();
    for (const entry of expired) {
      // Covers a crash after R2 commit but before the SQLite receipt.
      const object = await bucket.head(entry.key);
      if (object) commitStored(entry.key, object.size);
      else sql.exec("DELETE FROM quota_chunks WHERE key=? AND stored=0", entry.key);
    }
  }
  const api = {
    reconcile,
    resume: collector.resume,
    additionalBytes(entries: BlobReservation[]) {
      const unique = new Map(entries.map((entry) => [entry.key, entry]));
      let additional = 0;
      for (const entry of unique.values()) {
        const previous = sql.exec<{ bytes: number }>("SELECT bytes FROM quota_chunks WHERE key=?", entry.key).toArray()[0];
        if (previous && previous.bytes !== entry.bytes) throw new BridgeQuotaError(409, "Immutable blob length differs");
        if (!previous) additional += entry.bytes;
      }
      return additional;
    },
    reserve(entries: BlobReservation[], expiresAt: number) {
      const unique = new Map(entries.map((entry) => [entry.key, entry]));
      storage.transactionSync(() => {
        for (const entry of unique.values()) sql.exec(`INSERT INTO quota_chunks(key,bytes,stored,expires_at) VALUES(?,?,0,?)
          ON CONFLICT(key) DO UPDATE SET expires_at=max(expires_at,excluded.expires_at)`, entry.key, entry.bytes, expiresAt);
        for (const id of new Set(entries.map((entry) => entry.key.slice(65,108)))) collector.protect(id);
      });
    },
    async collect() { await recoverUploads(); await collector.collect(); },
    nextExpiry() {
      if (sql.exec<{ upload_id: string }>("SELECT upload_id FROM blob_uploads LIMIT 32").toArray().some((entry) => !activeUploads.has(entry.upload_id))) return Date.now();
      return collector.nextExpiry();
    },
    hasBlobs(blobs: BridgeBlobIdentity[]) {
      if (!blobs.length) return true;
      if (!accountPrefix) return false;
      return blobs.every((blob) => !collector.isDeleting(blob.blobId) && Array.from({ length: bridgeBlobChunkCount(blob.size) }, (_, i) => i).every((index) =>
        !!sql.exec("SELECT 1 FROM quota_chunks WHERE key=? AND bytes=? AND stored=1", `${accountPrefix}${blob.blobId}/${index}`, bridgeBlobChunkSize(blob.size, index) + BRIDGE_BLOB_CIPHER_OVERHEAD).toArray().length));
    },
    async protectReads(identity: BridgeIdentity, blobs: BridgeBlobIdentity[], expiresAt: number) {
      if (!await options.authorize(identity)) throw new BridgeQuotaError(403, "Backend access revoked");
      if (blobs.some((blob) => collector.isDeleting(blob.blobId))) throw new BridgeQuotaError(404, "Blob not found");
      storage.transactionSync(() => { for (const blob of blobs) collector.protectRead(blob.blobId, expiresAt); });
    },
    async put(identity: BridgeIdentity, key: string, expiresAt: number, bytes: Uint8Array, gate: AccountGate): Promise<void> {
      const previous = inFlight.get(key);
      if (previous) { await previous.catch(() => {}); return api.put(identity, key, expiresAt, bytes, gate); }
      if (inFlight.size >= 8) throw new BridgeQuotaError(429, "Too many blob uploads in flight; retry shortly");
      let uploadId: string | undefined;
      const validate = async () => {
        if (expiresAt <= Date.now() || !await options.authorize(identity)) throw new BridgeQuotaError(403, "Blob capability expired or revoked");
      };
      const work = (async () => {
        await gate(async () => {
          await validate();
          if (!key.startsWith(await bridgeAccountPrefix(identity.accountId))) throw new BridgeQuotaError(403, "Invalid account prefix");
          if (collector.isDeleting(key.slice(65,108))) throw new BridgeQuotaError(403, "Blob cleanup is pending; request a new upload capability");
          await recoverUploads(key);
          const reservation = sql.exec<{ bytes: number; stored: number; expires_at: number }>("SELECT bytes,stored,expires_at FROM quota_chunks WHERE key=?", key).toArray()[0];
          if (!reservation || reservation.bytes !== bytes.length || !reservation.stored && reservation.expires_at <= Date.now()) throw new BridgeQuotaError(403, "Blob reservation expired");
          if (reservation.stored) return;
          if (!(await options.canUpload(identity.accountId))) throw new BridgeQuotaError(403, "Bridge subscription required; local changes remain queued");
          uploadId = crypto.randomUUID();
          sql.exec("INSERT INTO blob_uploads VALUES(?,?,?)", key, key.slice(65,108), uploadId);
          activeUploads.add(uploadId);
        });
        if (!uploadId) return;
        // No account-wide gate spans this network write. Conditional creation
        // and per-chunk coalescing retain immutable bytes on retries.
        const result = await bucket.put(key, bytes, { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "application/octet-stream" } });
        const object = result ?? await bucket.head(key);
        if (!object || object.size !== bytes.length) throw new Error("Blob upload receipt length differs");
        await gate(async () => {
          // Physical bytes remain charged even if access expired during PUT.
          commitStored(key, bytes.length, uploadId!);
          await validate();
          if (!(await options.canUpload(identity.accountId))) throw new BridgeQuotaError(403, "Bridge subscription required; local changes remain queued");
        });
      })();
      inFlight.set(key, work);
      try { await work; }
      finally { if (uploadId) activeUploads.delete(uploadId); if (inFlight.get(key) === work) inFlight.delete(key); }
    },
  };
  return api;
}

export function createBlobCollector(storage: DurableObjectStorage, bucket: R2Bucket, archive?: R2Bucket) {
  const sql = storage.sql;
  function enabled() { return sql.exec<{ legacy_records: number }>("SELECT legacy_records FROM blob_gc_state WHERE id=1").toArray()[0].legacy_records === 0; }
  async function finish(id: string) {
    if (sql.exec("SELECT 1 FROM blob_uploads WHERE blob_id=? LIMIT 1", id).toArray().length) throw new Error("Blob upload is still in flight");
    const prefix = sql.exec<{ account_prefix: string | null }>("SELECT account_prefix FROM blob_gc_state WHERE id=1").toArray()[0].account_prefix;
    if (!prefix) throw new Error("Bridge blob namespace is not initialized");
    const start = `${prefix}${id}/`, end = `${prefix}${id}0`;
    const keys = sql.exec<{ key: string }>("SELECT key FROM quota_chunks WHERE key>=? AND key<?", start, end).toArray().map((row) => row.key);
    if (keys.length) {
      await archiveBlobChunks(bucket, archive, keys);
      await bucket.delete(keys);
    }
    storage.transactionSync(() => {
      sql.exec("DELETE FROM quota_chunks WHERE key>=? AND key<?", start, end);
      sql.exec("DELETE FROM blob_objects WHERE blob_id=? AND refs=0", id);
      sql.exec("DELETE FROM blob_deletions WHERE blob_id=?", id);
    });
  }
  const api = {
    setAccountPrefix(prefix: string) {
      // A fresh in-memory quota helper reuses the durable prefix. Avoid even a
      // zero-row UPDATE on ordinary reads: it can open a write transaction.
      if (sql.exec("SELECT 1 FROM blob_gc_state WHERE id=1 AND account_prefix IS NULL").toArray().length) {
        sql.exec("UPDATE blob_gc_state SET account_prefix=? WHERE id=1 AND account_prefix IS NULL", prefix);
      }
    },
    isDeleting(id: string) { return !!sql.exec("SELECT 1 FROM blob_deletions WHERE blob_id=?", id).toArray().length; },
    async resume(id: string) { if (api.isDeleting(id)) await finish(id); },
    /** An upload renews the grace period even if it reuses previously stored bytes. */
    protect(blobId: string) { sql.exec("UPDATE blob_objects SET delete_after=max(coalesce(delete_after,0),?) WHERE blob_id=? AND refs=0", Date.now() + BRIDGE_BLOB_GC_GRACE_MS, blobId); },
    protectRead(blobId: string, expiresAt: number) { sql.exec("UPDATE blob_objects SET delete_after=max(coalesce(delete_after,0),?) WHERE blob_id=? AND refs=0", expiresAt + 1000, blobId); },
    nextExpiry(): number | null {
      if (sql.exec("SELECT 1 FROM blob_deletions LIMIT 1").toArray().length) return Date.now();
      if (!enabled()) return null;
      return sql.exec<{ expires: number | null }>(`SELECT delete_after expires FROM blob_objects o WHERE refs=0 AND delete_after IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM blob_uploads u WHERE u.blob_id=o.blob_id) ORDER BY delete_after LIMIT 1`).toArray()[0]?.expires ?? null;
    },
    /** Under the same account gate as publication, reservation and upload receipts.
     * R2 first, receipts second: a crash/failure stays charged and retries safely. */
    async collect() {
      const failures: unknown[] = [];
      const collectOne = async (id: string) => {
        try { await finish(id); }
        catch (error) { failures.push(error); }
      };
      // Finish durable deletion intents even when a legacy writer has since
      // paused new collection. Never publish a root against stale receipts.
      const pending = sql.exec<{ blob_id: string }>("SELECT blob_id FROM blob_deletions LIMIT 32").toArray();
      for (const { blob_id: id } of pending) await collectOne(id);
      const prefix = sql.exec<{ account_prefix: string | null }>("SELECT account_prefix FROM blob_gc_state WHERE id=1").toArray()[0].account_prefix;
      if (enabled() && prefix) {
        const candidates = sql.exec<{ blob_id: string }>(`SELECT blob_id FROM blob_objects o WHERE refs=0 AND delete_after<=?
          AND NOT EXISTS(SELECT 1 FROM blob_uploads u WHERE u.blob_id=o.blob_id)
          AND NOT EXISTS(SELECT 1 FROM blob_deletions d WHERE d.blob_id=o.blob_id) ORDER BY delete_after LIMIT ?`, Date.now(), 32 - pending.length).toArray();
        for (const { blob_id: id } of candidates) {
          sql.exec("INSERT OR IGNORE INTO blob_deletions VALUES(?)", id);
          await collectOne(id);
        }
      }
      // Preserve the failed intents and alarm retry without letting one blob
      // prevent independent, bounded reclamation in the rest of this batch.
      if (failures.length) throw failures[0];
    },
  };
  return api;
}
