// Operator-only helpers for the beta CLI and the private BridgeOperations entrypoint. No public route imports this module.
export function bridgeBetaEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || [...email].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Use a valid invitation email");
  // Do not strip dots or plus aliases: the exact mailbox must be verified.
  return email;
}
export const bridgeBetaColumns = "email,account_id,status,invited_at,activated_at,expires_at,mailed_at,updated_at";
export const bridgeBetaSelect = `SELECT ${bridgeBetaColumns} FROM bridge_beta_invites WHERE email=?`;
export function bridgeBetaInvite(email: string, now = Date.now()) {
  return { sql: `INSERT INTO bridge_beta_invites(email,status,invited_at,updated_at) VALUES(?,'invited',?,?)
    ON CONFLICT(email) DO UPDATE SET status='invited',updated_at=excluded.updated_at
    WHERE bridge_beta_invites.status='revoked' AND bridge_beta_invites.activated_at IS NULL`,
  params: [bridgeBetaEmail(email), now, now] };
}
export function bridgeBetaRevoke(email: string, now = Date.now()) {
  return { sql: "UPDATE bridge_beta_invites SET status='revoked',updated_at=? WHERE email=? AND status<>'revoked'", params: [now, bridgeBetaEmail(email)] };
}
/** An explicit end timestamp makes retries safe; extension never restarts the
 * original period or shortens it. It can restore a previously revoked grant. */
export function bridgeBetaExtend(email: string, expiresAt: number, now = Date.now()) {
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > 8_640_000_000_000_000) throw new Error("Use a future expiry timestamp");
  return { sql: `UPDATE bridge_beta_invites SET status='active',expires_at=?,updated_at=?
    WHERE email=? AND activated_at IS NOT NULL AND expires_at<?`, params: [expiresAt, now, bridgeBetaEmail(email), expiresAt] };
}
