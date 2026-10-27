-- Invitations never change existing subscriptions, keys or ciphertext. The
-- verified mailbox claims one invitation. Activation binds it to the account.
CREATE TABLE bridge_beta_invites (
  email TEXT NOT NULL PRIMARY KEY,
  account_id TEXT UNIQUE REFERENCES user(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('invited','active','revoked')),
  invited_at INTEGER NOT NULL CHECK(invited_at >= 0),
  activated_at INTEGER,
  expires_at INTEGER,
  updated_at INTEGER NOT NULL,
  CHECK((activated_at IS NULL AND expires_at IS NULL AND account_id IS NULL)
    OR (activated_at IS NOT NULL AND expires_at IS NOT NULL AND activated_at >= 0 AND expires_at > activated_at AND account_id IS NOT NULL)),
  CHECK(status <> 'active' OR activated_at IS NOT NULL)
);
