import { BRIDGE_BLOB_CIPHER_OVERHEAD, BRIDGE_BLOB_MAX_BYTES, bridgeBlobChunkCount, bridgeBlobChunkSize, type BridgeBlobIdentity } from "@mains/contracts/bridge-blobs";
import type { BridgeQuota } from "@mains/contracts/bridge";
import type { BridgeIdentity, DevAuthEnv } from "./auth";
import { identityIsActive } from "./auth";
import { createBridgeSubscriptions } from "./subscriptions";
import { createBlobCollector, installBlobInventory } from "./blob-gc";
import { createBridgeLimits } from "./limits";
export { bridgeLimits } from "./limits";

export interface QuotaEnv extends DevAuthEnv {
  BLOBS: R2Bucket;
  BLOB_ARCHIVE?: R2Bucket;
  BRIDGE_STORAGE_LIMIT_BYTES?: string;
  BRIDGE_WRITES_PER_MINUTE?: string;
}
export interface BlobReservation { key: string; bytes: number }
export class BridgeQuotaError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function bridgeAccountPrefix(accountId: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(accountId)))].map((b) => b.toString(16).padStart(2, "0")).join("") + "/";
}

type AccountGate = <T>(work: () => Promise<T>) => Promise<T>;
/** Quota decisions and receipts use the account gate. Immutable PUT I/O runs
 * outside it, pinned by a durable intent until completion or restart recovery. */
export function createBlobQuota(storage: DurableObjectStorage, env: QuotaEnv, recordBytes: () => number, subscriptions = createBridgeSubscriptions(env), limits = createBridgeLimits(env)) {
  const sql = storage.sql;
  sql.exec(`CREATE TABLE IF NOT EXISTS quota_chunks(key TEXT PRIMARY KEY,bytes INTEGER NOT NULL,stored INTEGER NOT NULL,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS quota_state(id INTEGER PRIMARY KEY,initialized INTEGER NOT NULL);`);
  storage.transactionSync(() => {
    sql.exec(`CREATE INDEX IF NOT EXISTS quota_chunks_expiry ON quota_chunks(expires_at) WHERE stored=0;
      CREATE TABLE IF NOT EXISTS quota_usage(id INTEGER PRIMARY KEY CHECK(id=1),blob_bytes INTEGER NOT NULL CHECK(blob_bytes>=0),reserved_bytes INTEGER NOT NULL CHECK(reserved_bytes>=0));`);
    if (!sql.exec("SELECT 1 FROM quota_usage WHERE id=1").toArray().length) sql.exec(`INSERT INTO quota_usage SELECT 1,
      coalesce(sum(CASE WHEN stored=1 THEN bytes ELSE 0 END),0),coalesce(sum(CASE WHEN stored=0 THEN bytes ELSE 0 END),0) FROM quota_chunks`);
    sql.exec(`CREATE TRIGGER IF NOT EXISTS quota_usage_insert AFTER INSERT ON quota_chunks BEGIN
        UPDATE quota_usage SET blob_bytes=blob_bytes+CASE WHEN NEW.stored=1 THEN NEW.bytes ELSE 0 END,
          reserved_bytes=reserved_bytes+CASE WHEN NEW.stored=0 THEN NEW.bytes ELSE 0 END WHERE id=1;
      END;
      CREATE TRIGGER IF NOT EXISTS quota_usage_delete AFTER DELETE ON quota_chunks BEGIN
        UPDATE quota_usage SET blob_bytes=blob_bytes-CASE WHEN OLD.stored=1 THEN OLD.bytes ELSE 0 END,
          reserved_bytes=reserved_bytes-CASE WHEN OLD.stored=0 THEN OLD.bytes ELSE 0 END WHERE id=1;
      END;
      CREATE TRIGGER IF NOT EXISTS quota_usage_update AFTER UPDATE OF bytes,stored ON quota_chunks
      WHEN NEW.bytes<>OLD.bytes OR NEW.stored<>OLD.stored BEGIN
        UPDATE quota_usage SET blob_bytes=blob_bytes+(CASE WHEN NEW.stored=1 THEN NEW.bytes ELSE 0 END)-(CASE WHEN OLD.stored=1 THEN OLD.bytes ELSE 0 END),
          reserved_bytes=reserved_bytes+(CASE WHEN NEW.stored=0 THEN NEW.bytes ELSE 0 END)-(CASE WHEN OLD.stored=0 THEN OLD.bytes ELSE 0 END) WHERE id=1;
      END;`);
  });
  installBlobInventory(storage);
  const collector = createBlobCollector(storage, env.BLOBS, env.BLOB_ARCHIVE);
  const activeUploads = new Set<string>(), inFlight = new Map<string, Promise<void>>();
  let accountPrefix: string | undefined;
  let initialized = false;
  async function recoverUploads(key?: string) {
    const pending = key ? sql.exec<{ key: string; upload_id: string }>("SELECT key,upload_id FROM blob_uploads WHERE key=?", key).toArray() :
      sql.exec<{ key: string; upload_id: string }>("SELECT key,upload_id FROM blob_uploads LIMIT 32").toArray();
    for (const entry of pending) {
      // A deadline alone must never release a live writer's reservation. The
      // current DO retains its promises while I/O is pending; after a reset,
      // unresolved intents are reconciled before releasing bytes or GC pins.
      if (activeUploads.has(entry.upload_id)) continue;
      const object = await env.BLOBS.head(entry.key);
      const reservation = sql.exec<{ bytes: number }>("SELECT bytes FROM quota_chunks WHERE key=?", entry.key).toArray()[0];
      if (object && (!reservation || object.size !== reservation.bytes)) throw new Error("Unresolved blob upload length differs");
      storage.transactionSync(() => {
        if (object) {
          sql.exec("UPDATE quota_chunks SET stored=1,expires_at=0 WHERE key=?", entry.key);
          collector.protect(entry.key.slice(65,108));
        }
        sql.exec("DELETE FROM blob_uploads WHERE key=? AND upload_id=?", entry.key, entry.upload_id);
      });
    }
  }
  async function reconcile(accountId: string) {
    if (!initialized) {
      accountPrefix = await bridgeAccountPrefix(accountId);
      collector.setAccountPrefix(accountPrefix);
      if (!sql.exec("SELECT 1 FROM quota_state WHERE id=1").toArray().length) {
        let cursor: string | undefined;
        do {
          const page = await env.BLOBS.list({ prefix: await bridgeAccountPrefix(accountId), cursor });
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
      const object = await env.BLOBS.head(entry.key);
      if (object) sql.exec("UPDATE quota_chunks SET bytes=?,stored=1,expires_at=0 WHERE key=?", object.size, entry.key);
      else sql.exec("DELETE FROM quota_chunks WHERE key=? AND stored=0", entry.key);
    }
  }
  function usage() {
    const row = sql.exec<{ blobBytes: number; reservedBytes: number }>("SELECT blob_bytes AS blobBytes,reserved_bytes AS reservedBytes FROM quota_usage WHERE id=1").toArray()[0];
    return row;
  }
  const api = {
    invalidateLimits: limits.invalidate,
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
      if (!await identityIsActive(identity, env)) throw new BridgeQuotaError(403, "Backend access revoked");
      if (blobs.some((blob) => collector.isDeleting(blob.blobId))) throw new BridgeQuotaError(404, "Blob not found");
      storage.transactionSync(() => { for (const blob of blobs) collector.protectRead(blob.blobId, expiresAt); });
    },
    async status(accountId: string): Promise<BridgeQuota> {
      await reconcile(accountId);
      const subscription = await subscriptions.status(accountId);
      const policy = await limits.get(accountId, subscription.subscription.planId ?? undefined), bytes = usage(), records = recordBytes();
      return { ...policy, ...bytes, recordBytes: records, usedBytes: records + bytes.blobBytes + bytes.reservedBytes, fileLimitBytes: BRIDGE_BLOB_MAX_BYTES, ...subscription };
    },
    async reserve(identity: BridgeIdentity, entries: BlobReservation[], expiresAt: number) {
      if (!await identityIsActive(identity, env)) throw new BridgeQuotaError(403, "Backend access revoked");
      const prefix = await bridgeAccountPrefix(identity.accountId);
      for (const entry of entries) {
        if (!entry.key.startsWith(prefix) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 40) throw new BridgeQuotaError(400, "Invalid blob reservation");
      }
      for (const id of new Set(entries.map((entry) => entry.key.slice(65,108)))) await collector.resume(id);
      const quota = await api.status(identity.accountId);
      if (!quota.subscription!.canUpload) throw new BridgeQuotaError(403, "Bridge subscription required; local changes remain queued");
      const unique = new Map(entries.map((entry) => [entry.key, entry]));
      let additional = 0;
      for (const entry of unique.values()) {
        const previous = sql.exec<{ bytes: number }>("SELECT bytes FROM quota_chunks WHERE key=?", entry.key).toArray()[0];
        if (previous && previous.bytes !== entry.bytes) throw new BridgeQuotaError(409, "Immutable blob length differs");
        if (!previous) additional += entry.bytes;
      }
      if (additional > 0 && quota.usedBytes + additional > quota.limitBytes) throw new BridgeQuotaError(413, "Bridge storage quota exceeded");
      storage.transactionSync(() => {
        for (const entry of unique.values()) sql.exec(`INSERT INTO quota_chunks(key,bytes,stored,expires_at) VALUES(?,?,0,?)
          ON CONFLICT(key) DO UPDATE SET expires_at=max(expires_at,excluded.expires_at)`, entry.key, entry.bytes, expiresAt);
        for (const id of new Set(entries.map((entry) => entry.key.slice(65,108)))) collector.protect(id);
      });
    },
    async put(identity: BridgeIdentity, key: string, expiresAt: number, bytes: Uint8Array, gate: AccountGate): Promise<void> {
      const previous = inFlight.get(key);
      if (previous) { await previous.catch(() => {}); return api.put(identity, key, expiresAt, bytes, gate); }
      if (inFlight.size >= 8) throw new BridgeQuotaError(429, "Too many blob uploads in flight; retry shortly");
      let uploadId: string | undefined;
      const validate = async () => {
        if (expiresAt <= Date.now() || !await identityIsActive(identity, env)) throw new BridgeQuotaError(403, "Blob capability expired or revoked");
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
          if (!(await subscriptions.status(identity.accountId)).subscription.canUpload) throw new BridgeQuotaError(403, "Bridge subscription required; local changes remain queued");
          uploadId = crypto.randomUUID();
          sql.exec("INSERT INTO blob_uploads VALUES(?,?,?)", key, key.slice(65,108), uploadId);
          activeUploads.add(uploadId);
        });
        if (!uploadId) return;
        // No account-wide gate spans this network write. Conditional creation
        // and per-chunk coalescing retain immutable bytes on retries.
        const result = await env.BLOBS.put(key, bytes, { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "application/octet-stream" } });
        const object = result ?? await env.BLOBS.head(key);
        if (!object || object.size !== bytes.length) throw new Error("Blob upload receipt length differs");
        await gate(async () => {
          storage.transactionSync(() => {
            if (!sql.exec("SELECT 1 FROM blob_uploads WHERE key=? AND upload_id=?", key, uploadId!).toArray().length ||
                !sql.exec("SELECT 1 FROM quota_chunks WHERE key=? AND bytes=?", key, bytes.length).toArray().length)
              throw new Error("Blob upload intent changed");
            // Physical storage remains charged even if access expired while
            // the PUT was pending. Metadata cannot publish without its receipt.
            sql.exec("UPDATE quota_chunks SET stored=1,expires_at=0 WHERE key=?", key);
            collector.protect(key.slice(65,108));
            sql.exec("DELETE FROM blob_uploads WHERE key=? AND upload_id=?", key, uploadId!);
          });
          await validate();
          if (!(await subscriptions.status(identity.accountId)).subscription.canUpload) throw new BridgeQuotaError(403, "Bridge subscription required; local changes remain queued");
        });
      })();
      inFlight.set(key, work);
      try { await work; }
      finally { if (uploadId) activeUploads.delete(uploadId); if (inFlight.get(key) === work) inFlight.delete(key); }
    },
  };
  return api;
}
