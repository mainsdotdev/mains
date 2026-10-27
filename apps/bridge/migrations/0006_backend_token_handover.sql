-- The current credential remains valid while its successor is unacknowledged.
-- Only the first authenticated use of the successor commits the handover.
ALTER TABLE bridge_backends ADD COLUMN next_token_hash TEXT;
ALTER TABLE bridge_backends ADD COLUMN next_token_expires_at INTEGER
  CHECK ((next_token_hash IS NULL) = (next_token_expires_at IS NULL));
CREATE UNIQUE INDEX bridge_backends_next_token_hash ON bridge_backends(next_token_hash)
  WHERE next_token_hash IS NOT NULL;
