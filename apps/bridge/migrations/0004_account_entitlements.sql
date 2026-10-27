CREATE TABLE account_entitlements (
  account_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  billing_interval TEXT NOT NULL CHECK(billing_interval IN ('monthly','yearly')),
  status TEXT NOT NULL CHECK(status IN ('active','revoked')),
  starts_at INTEGER NOT NULL CHECK(starts_at >= 0),
  expires_at INTEGER NOT NULL CHECK(expires_at > starts_at),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(account_id,feature)
);
