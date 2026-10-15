CREATE TABLE bridge_accounts (
  account_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  initializer_backend_id TEXT NOT NULL,
  initializer_token_hash TEXT NOT NULL,
  recovery_public_key TEXT NOT NULL,
  recovery_wrap TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE bridge_backends (
  account_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  backend_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  label TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','revoked')),
  token_hash TEXT NOT NULL UNIQUE,
  token_expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER,
  recovery_challenge TEXT,
  challenge_expires_at INTEGER,
  PRIMARY KEY(account_id,backend_id)
);
CREATE TABLE bridge_key_wraps (
  account_id TEXT NOT NULL,
  backend_id TEXT NOT NULL,
  wrap TEXT NOT NULL,
  PRIMARY KEY(account_id,backend_id),
  FOREIGN KEY(account_id,backend_id) REFERENCES bridge_backends(account_id,backend_id) ON DELETE CASCADE
);
CREATE TABLE bridge_approvals (
  request_id TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL,
  backend_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(account_id,backend_id),
  FOREIGN KEY(account_id,backend_id) REFERENCES bridge_backends(account_id,backend_id) ON DELETE CASCADE
);
CREATE TABLE bridge_login_codes (
  code_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE bridge_limits (id TEXT PRIMARY KEY NOT NULL, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
