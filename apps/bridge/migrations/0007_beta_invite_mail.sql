-- The operator's invitation email goes out once per invitation. Sending it again is explicit.
ALTER TABLE bridge_beta_invites ADD COLUMN mailed_at INTEGER;
