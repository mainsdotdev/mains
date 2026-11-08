import { BRIDGE_BLOB_MAX_BYTES } from "@mains/contracts/bridge-blobs";
import type { BridgeQuota } from "@mains/contracts/bridge";
import type { BridgeIdentity, DevAuthEnv } from "./auth";
import { identityIsActive } from "./auth";
import { createBridgeSubscriptions } from "./subscriptions";
import { installBlobInventory } from "./blob-gc";
import { createBlobLifecycle, bridgeAccountPrefix, BridgeQuotaError, type BlobReservation } from "./blob-lifecycle";
export { bridgeAccountPrefix, BridgeQuotaError, type BlobReservation } from "./blob-lifecycle";
import { createBridgeLimits } from "./limits";
export { bridgeLimits } from "./limits";

export interface QuotaEnv extends DevAuthEnv {
  BLOBS: R2Bucket;
  BLOB_ARCHIVE?: R2Bucket;
  BRIDGE_STORAGE_LIMIT_BYTES?: string;
  BRIDGE_WRITES_PER_MINUTE?: string;
}
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
  const lifecycle = createBlobLifecycle(storage, env.BLOBS, {
    archive: env.BLOB_ARCHIVE,
    authorize: (identity) => identityIsActive(identity, env),
    canUpload: async (accountId) => (await subscriptions.status(accountId)).subscription.canUpload,
  });
  function usage() {
    const row = sql.exec<{ blobBytes: number; reservedBytes: number }>("SELECT blob_bytes AS blobBytes,reserved_bytes AS reservedBytes FROM quota_usage WHERE id=1").toArray()[0];
    return row;
  }
  const api = {
    invalidateLimits: limits.invalidate,
    collect: lifecycle.collect,
    nextExpiry: lifecycle.nextExpiry,
    hasBlobs: lifecycle.hasBlobs,
    protectReads: lifecycle.protectReads,
    put: lifecycle.put,
    async status(accountId: string): Promise<BridgeQuota> {
      await lifecycle.reconcile(accountId);
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
      for (const id of new Set(entries.map((entry) => entry.key.slice(65,108)))) await lifecycle.resume(id);
      const quota = await api.status(identity.accountId);
      if (!quota.subscription!.canUpload) throw new BridgeQuotaError(403, "Bridge subscription required; local changes remain queued");
      const additional = lifecycle.additionalBytes(entries);
      if (additional > 0 && quota.usedBytes + additional > quota.limitBytes) throw new BridgeQuotaError(413, "Bridge storage quota exceeded");
      lifecycle.reserve(entries, expiresAt);
    },
  };
  return api;
}
