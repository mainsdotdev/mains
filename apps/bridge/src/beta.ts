import type { AuthEnv } from "./identity";
import { HttpError } from "./auth-http";
import { createBridgeSubscriptions } from "./subscriptions";
import { betaActivation, bridgeAccessDecision, reusableBetaActivation, type BetaInvite, type BridgeAccess } from "./entitlement-lifecycle";
export { BRIDGE_BETA_DURATION_MS, type BetaInvite, type BridgeAccess } from "./entitlement-lifecycle";
export const BRIDGE_ACCESS_UNAVAILABLE = "Bridge access is not available for this account yet.";
type VerifiedUser = { id: string; email: string; emailVerified: boolean };

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
  const input = { accountId: user.id, verified: user.emailVerified, subscription };
  const direct = bridgeAccessDecision(input);
  if (direct) return direct;
  const invite = await invitation(env, user);
  const invited = bridgeAccessDecision({ ...input, invite });
  if (invited) return invited;
  const existing = await env.AUTH_DB!.prepare("SELECT 1 FROM bridge_accounts WHERE account_id=?").bind(user.id).first();
  return bridgeAccessDecision({ ...input, invite, existingAccount: !!existing }) ?? "unavailable";
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
  const command = betaActivation(user.id, user.email.trim().toLowerCase(), now);
  const row = await env.AUTH_DB!.prepare(command.sql).bind(...command.params).first<BetaInvite>();
  if (row) return row;
  const existing = await invitation(env, user);
  if (reusableBetaActivation(existing, user.id)) return existing!;
  throw new HttpError(403, BRIDGE_ACCESS_UNAVAILABLE);
}
