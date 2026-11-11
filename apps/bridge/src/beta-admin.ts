import { betaInvitation, betaRevocation, betaExtension } from "./entitlement-lifecycle";

// Operator-only helpers for the beta CLI and the private BridgeOperations entrypoint. No public route imports this module.
export function bridgeBetaEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || [...email].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Use a valid invitation email");
  // Do not strip dots or plus aliases: the exact mailbox must be verified.
  return email;
}
export const bridgeBetaColumns = "email,account_id,status,invited_at,activated_at,expires_at,mailed_at,updated_at";
export const bridgeBetaSelect = `SELECT ${bridgeBetaColumns} FROM bridge_beta_invites WHERE email=?`;
export function bridgeBetaInvite(email: string, now = Date.now()) { return betaInvitation(bridgeBetaEmail(email), now); }
export function bridgeBetaRevoke(email: string, now = Date.now()) { return betaRevocation(bridgeBetaEmail(email), now); }
/** Explicit extension never restarts or shortens an activated period. */
export function bridgeBetaExtend(email: string, expiresAt: number, now = Date.now()) { return betaExtension(bridgeBetaEmail(email), expiresAt, now); }
