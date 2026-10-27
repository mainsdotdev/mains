CREATE TABLE bridge_account_quotas (
  account_id TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'standard',
  storage_limit_bytes INTEGER NOT NULL CHECK(storage_limit_bytes >= 0),
  writes_per_minute INTEGER NOT NULL DEFAULT 600 CHECK(writes_per_minute > 0)
);
