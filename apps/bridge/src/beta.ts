import type { AuthEnv } from "./identity";
import { HttpError } from "./auth-http";
import { createBridgeSubscriptions } from "./subscriptions";

export const BRIDGE_BETA_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
export const BRIDGE_ACCESS_UNAVAILABLE = "Bridge access is not available for this account yet.";
type VerifiedUser = { id: string; email: string; emailVerified: boolean };
export interface BetaInvite {
  email: string; account_id: string | null; status: "invited" | "active" | "revoked";
  invited_at: number; activated_at: number | null; expires_at: number | null;
}
export type BridgeAccess = "allowed" | "invited" | "unavailable";

async function invitation(env: AuthEnv, user: VerifiedUser): Promise<BetaInvite | null> {
  return env.AUTH_DB!.prepare(`SELECT email,account_id,status,invited_at,activated_at,expires_at FROM bridge_beta_invites WHERE account_id=?
    UNION ALL SELECT email,account_id,status,invited_at,activated_at,expires_at FROM bridge_beta_invites
    WHERE email=? AND account_id IS NULL LIMIT 1`).bind(user.id, user.email.trim().toLowerCase()).first<BetaInvite>();
}

/** Identity sign-in stays public. Bridge enrollment requires an explicit grant.
 * Existing owners retain read/recovery access, including after a grant ends. */
export async function bridgeAccess(env: AuthEnv, user: VerifiedUser): Promise<BridgeAccess> {
  if (!user.emailVerified) return "unavailable";
  const { subscription } = await createBridgeSubscriptions(env).status(user.id);
  if (subscription.canUpload) return "allowed";
  const invite = await invitation(env, user);
  if (invite?.status === "invited" && invite.activated_at === null) return "invited";
  if (invite?.account_id === user.id && invite.activated_at !== null) return "allowed";
  if (subscription.status !== "none" && subscription.status !== "unavailable") return "allowed";
  const existing = await env.AUTH_DB!.prepare("SELECT 1 FROM bridge_accounts WHERE account_id=?").bind(user.id).first();
  return existing ? "allowed" : "unavailable";
}
export async function requireBridgeAccess(env: AuthEnv, user: VerifiedUser): Promise<void> {
  const access = await bridgeAccess(env, user);
  if (access !== "allowed") throw new HttpError(403, access === "invited" ? "Activate beta in the sign-in window to connect this device." : BRIDGE_ACCESS_UNAVAILABLE);
}
/** Also guards pending credentials issued before the closed-beta rollout. */
export async function requireBridgeBootstrapAccess(env: AuthEnv, accountId: string): Promise<void> {
  const row = await env.AUTH_DB!.prepare('SELECT id,email,emailVerified FROM user WHERE id=?').bind(accountId).first<{ id: string; email: string; emailVerified: number }>();
  if (!row) throw new HttpError(403, BRIDGE_ACCESS_UNAVAILABLE);
  await requireBridgeAccess(env, { ...row, emailVerified: row.emailVerified === 1 });
}
export async function activateBridgeBeta(env: AuthEnv, user: VerifiedUser, now = Date.now()): Promise<BetaInvite> {
  if (!user.emailVerified) throw new HttpError(403, BRIDGE_ACCESS_UNAVAILABLE);
  // One conditional statement claims and starts the invitation. Concurrent
  // clicks, login retries and additional devices cannot move either timestamp.
  const row = await env.AUTH_DB!.prepare(`UPDATE bridge_beta_invites SET account_id=?,status='active',activated_at=?,expires_at=?,updated_at=?
    WHERE email=? AND account_id IS NULL AND status='invited' AND activated_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM bridge_beta_invites WHERE account_id=?) RETURNING *`)
    .bind(user.id, now, now + BRIDGE_BETA_DURATION_MS, now, user.email.trim().toLowerCase(), user.id).first<BetaInvite>();
  if (row) return row;
  const existing = await invitation(env, user);
  if (existing?.account_id === user.id && existing.activated_at !== null && existing.status === "active") return existing;
  throw new HttpError(403, BRIDGE_ACCESS_UNAVAILABLE);
}
