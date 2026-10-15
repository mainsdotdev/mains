import { BRIDGE_BLOB_MAX_BYTES } from "@mains/contracts/bridge-blobs";
import type { BridgeQuota } from "@mains/contracts/bridge";
import type { BridgeIdentity, DevAuthEnv } from "./auth";
import { identityIsActive } from "./auth";

export interface QuotaEnv extends DevAuthEnv {
  BLOBS: R2Bucket;
  BRIDGE_STORAGE_LIMIT_BYTES?: string;
  BRIDGE_WRITES_PER_MINUTE?: string;
}
export interface BlobReservation { key: string; bytes: number }
export class BridgeQuotaError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const number = (value: string | undefined, fallback: number) => {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("Invalid Bridge quota configuration");
  return n;
};
export async function bridgeLimits(env: QuotaEnv, accountId: string) {
  const override = env.AUTH_DB ? await env.AUTH_DB.prepare("SELECT plan,storage_limit_bytes,writes_per_minute FROM bridge_account_quotas WHERE account_id=?").bind(accountId)
    .first<{ plan: string; storage_limit_bytes: number; writes_per_minute: number }>() : null;
  return { plan: override?.plan ?? "standard", limitBytes: override?.storage_limit_bytes ?? number(env.BRIDGE_STORAGE_LIMIT_BYTES, 1024 ** 3),
    writesPerMinute: override?.writes_per_minute ?? Math.max(1, number(env.BRIDGE_WRITES_PER_MINUTE, 600)) };
}
export async function bridgeAccountPrefix(accountId: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(accountId)))].map((b) => b.toString(16).padStart(2, "0")).join("") + "/";
}

/** Called only inside the account Durable Object's concurrency gate. Reservations and
 * immutable R2 commits share that gate, including expiry/restart reconciliation. */
export function createBlobQuota(storage: DurableObjectStorage, env: QuotaEnv, recordBytes: () => number) {
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
  let initialized = false;
  async function reconcile(accountId: string) {
    if (!initialized) {
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
    const expired = sql.exec<{ key: string }>("SELECT key FROM quota_chunks WHERE stored=0 AND expires_at<=?", Date.now()).toArray();
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
    async status(accountId: string): Promise<BridgeQuota> {
      await reconcile(accountId);
      const limits = await bridgeLimits(env, accountId), bytes = usage(), records = recordBytes();
      return { ...limits, ...bytes, recordBytes: records, usedBytes: records + bytes.blobBytes + bytes.reservedBytes, fileLimitBytes: BRIDGE_BLOB_MAX_BYTES };
    },
    async reserve(identity: BridgeIdentity, entries: BlobReservation[], expiresAt: number) {
      if (!await identityIsActive(identity, env)) throw new BridgeQuotaError(403, "Backend access revoked");
      const quota = await api.status(identity.accountId), prefix = await bridgeAccountPrefix(identity.accountId);
      const unique = new Map(entries.map((entry) => [entry.key, entry]));
      let additional = 0;
      for (const entry of unique.values()) {
        if (!entry.key.startsWith(prefix) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 40) throw new BridgeQuotaError(400, "Invalid blob reservation");
        const previous = sql.exec<{ bytes: number }>("SELECT bytes FROM quota_chunks WHERE key=?", entry.key).toArray()[0];
        if (previous && previous.bytes !== entry.bytes) throw new BridgeQuotaError(409, "Immutable blob length differs");
        if (!previous) additional += entry.bytes;
      }
      if (additional > 0 && quota.usedBytes + additional > quota.limitBytes) throw new BridgeQuotaError(413, "Bridge storage quota exceeded");
      storage.transactionSync(() => {
        for (const entry of unique.values()) sql.exec(`INSERT INTO quota_chunks(key,bytes,stored,expires_at) VALUES(?,?,0,?)
          ON CONFLICT(key) DO UPDATE SET expires_at=max(expires_at,excluded.expires_at)`, entry.key, entry.bytes, expiresAt);
      });
    },
    async put(identity: BridgeIdentity, key: string, expiresAt: number, bytes: Uint8Array) {
      if (expiresAt <= Date.now() || !await identityIsActive(identity, env)) throw new BridgeQuotaError(403, "Blob capability expired or revoked");
      if (!key.startsWith(await bridgeAccountPrefix(identity.accountId))) throw new BridgeQuotaError(403, "Invalid account prefix");
      const reservation = sql.exec<{ bytes: number; stored: number; expires_at: number }>("SELECT bytes,stored,expires_at FROM quota_chunks WHERE key=?", key).toArray()[0];
      if (!reservation || reservation.bytes !== bytes.length || !reservation.stored && reservation.expires_at <= Date.now()) throw new BridgeQuotaError(403, "Blob reservation expired");
      if (reservation.stored) return;
      await env.BLOBS.put(key, bytes, { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "application/octet-stream" } });
      sql.exec("UPDATE quota_chunks SET stored=1,expires_at=0 WHERE key=?", key);
    },
  };
  return api;
}
