import type { BridgeBillingInterval, BridgePlan, BridgeSubscription, BridgeSubscriptionStatus } from "@mains/contracts/bridge-subscription";
import { bridgePlans, type BridgePlanEnv } from "./plans";
import { addUtcMonths } from "./periods";

export interface EntitlementRow {
  source: "subscription" | "beta";
  plan_id: string;
  billing_interval: "monthly" | "yearly" | null;
  status: "active" | "revoked";
  starts_at: number;
  expires_at: number;
}
export interface BetaInvite {
  email: string; account_id: string | null; status: "invited" | "active" | "revoked";
  invited_at: number; activated_at: number | null; expires_at: number | null;
}
export type BridgeAccess = "allowed" | "invited" | "unavailable";
export const BRIDGE_SUBSCRIPTION_CACHE_MS = 60_000;
export const BRIDGE_BETA_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const maxDate = 8_640_000_000_000_000;
export const bridgeDevelopmentEnabled = (env: { BRIDGE_DEV_AUTH?: string; BRIDGE_ENV?: string }) =>
  env.BRIDGE_DEV_AUTH === "true" && (!env.BRIDGE_ENV || env.BRIDGE_ENV === "local");
export function emptyBridgeSubscription(): BridgeSubscription {
  return { status: "none", planId: null, billingInterval: null, startsAt: null, expiresAt: null, canUpload: false };
}

/** One instant determines both grant periods and which source supplies rights. */
function project(rows: EntitlementRow[], plans: BridgePlan[], now: number): BridgeSubscription {
  const subscriptions = rows.map((row): BridgeSubscription => {
    const valid = plans.some((plan) => plan.id === row.plan_id) && (row.source === "beta" || ["monthly", "yearly"].includes(row.billing_interval ?? "")) &&
      Number.isSafeInteger(row.starts_at) && Number.isSafeInteger(row.expires_at) && row.starts_at >= 0 && row.expires_at > row.starts_at && row.expires_at <= maxDate;
    const status: BridgeSubscription["status"] = !valid ? "unavailable" : row.status === "revoked" ? "revoked" : row.status !== "active" ? "unavailable" :
      now < row.starts_at ? "scheduled" : now >= row.expires_at ? "expired" : "active";
    return { ...(row.source === "beta" ? { source: "beta" as const } : {}), status, planId: row.plan_id,
      billingInterval: row.source === "subscription" && ["monthly", "yearly"].includes(row.billing_interval ?? "") ? row.billing_interval : null,
      startsAt: valid ? new Date(row.starts_at).toISOString() : null, expiresAt: valid ? new Date(row.expires_at).toISOString() : null, canUpload: status === "active" };
  });
  const paid = subscriptions.find((entry) => entry.source !== "beta"), beta = subscriptions.find((entry) => entry.source === "beta");
  return paid?.canUpload ? paid : beta?.canUpload ? beta : beta ?? paid ?? emptyBridgeSubscription();
}

/** D1 receipts must still own their cache entry and lifetime before publication. */
export function createEntitlementLifecycle(plans: BridgePlan[], load: (accountId: string) => Promise<EntitlementRow[]>, now = Date.now) {
  type Lookup = { until: number; rows: Promise<EntitlementRow[]>; readers: number; retired: boolean };
  const cache = new Map<string, Lookup>();
  // Cache eviction cannot retire an in-flight permission read. Keep its owner
  // reachable until the last reader settles, so invalidation can still fence it.
  const pending = new Map<string, Lookup>();
  return {
    invalidate(accountId: string) {
      for (const entry of [cache.get(accountId), pending.get(accountId)]) if (entry) entry.retired = true;
      cache.delete(accountId); pending.delete(accountId);
    },
    async status(accountId: string): Promise<BridgeSubscriptionStatus> {
      for (;;) {
        let entry = pending.get(accountId) ?? cache.get(accountId);
        if (!entry || entry.retired || entry.until <= now()) {
          if (entry) entry.retired = true;
          if (cache.size >= 256 && !cache.has(accountId)) cache.delete(cache.keys().next().value!);
          entry = { until: now() + BRIDGE_SUBSCRIPTION_CACHE_MS, rows: Promise.resolve().then(() => load(accountId)), readers: 0, retired: false };
          cache.set(accountId, entry);
        }
        pending.set(accountId, entry); entry.readers++;
        try {
          const rows = await entry.rows, checkedAt = now();
          if (entry.retired || entry.until <= checkedAt) continue;
          return { plans, subscription: project(rows, plans, checkedAt) };
        } catch (error) {
          entry.retired = true;
          if (cache.get(accountId) === entry) cache.delete(accountId);
          if (pending.get(accountId) === entry) pending.delete(accountId);
          throw error;
        } finally {
          entry.readers--;
          if (!entry.readers && pending.get(accountId) === entry) pending.delete(accountId);
        }
      }
    },
  };
}

/** Enrollment/recovery eligibility is separate from permission to upload. */
export function bridgeAccessDecision(input: {
  accountId: string; verified: boolean; subscription: BridgeSubscription;
  invite?: BetaInvite | null; existingAccount?: boolean;
}): BridgeAccess | undefined {
  if (!input.verified) return "unavailable";
  if (input.subscription.canUpload) return "allowed";
  if (input.invite === undefined) return undefined;
  const invite = input.invite;
  if (invite?.status === "invited" && invite.activated_at === null) return "invited";
  if (invite?.account_id === input.accountId && invite.activated_at !== null) return "allowed";
  if (input.subscription.status !== "none" && input.subscription.status !== "unavailable") return "allowed";
  return input.existingAccount === undefined ? undefined : input.existingAccount ? "allowed" : "unavailable";
}
export function betaActivation(accountId: string, email: string, now: number) {
  return { sql: `UPDATE bridge_beta_invites SET account_id=?,status='active',activated_at=?,expires_at=?,updated_at=?
    WHERE email=? AND account_id IS NULL AND status='invited' AND activated_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM bridge_beta_invites WHERE account_id=?) RETURNING *`,
  params: [accountId, now, now + BRIDGE_BETA_DURATION_MS, now, email, accountId] };
}
export function reusableBetaActivation(invite: BetaInvite | null, accountId: string) {
  return invite?.account_id === accountId && invite.activated_at !== null && invite.status === "active";
}
export function betaInvitation(email: string, now: number) {
  return { sql: `INSERT INTO bridge_beta_invites(email,status,invited_at,updated_at) VALUES(?,'invited',?,?)
    ON CONFLICT(email) DO UPDATE SET status='invited',updated_at=excluded.updated_at
    WHERE bridge_beta_invites.status='revoked' AND bridge_beta_invites.activated_at IS NULL`, params: [email, now, now] };
}
export function betaRevocation(email: string, now: number) {
  return { sql: "UPDATE bridge_beta_invites SET status='revoked',updated_at=? WHERE email=? AND status<>'revoked'", params: [now, email] };
}
export function betaExtension(email: string, expiresAt: number, now: number) {
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > maxDate) throw new Error("Use a future expiry timestamp");
  return { sql: `UPDATE bridge_beta_invites SET status='active',expires_at=?,updated_at=?
    WHERE email=? AND activated_at IS NOT NULL AND expires_at<?`, params: [expiresAt, now, email, expiresAt] };
}
export function bridgePeriodEnd(startsAt: number, interval: BridgeBillingInterval): number {
  if (!Number.isSafeInteger(startsAt) || startsAt < 0 || !["monthly", "yearly"].includes(interval)) throw new Error("Invalid Bridge subscription period");
  const end = addUtcMonths(startsAt, interval === "monthly" ? 1 : 12);
  if (!Number.isSafeInteger(end) || end <= startsAt) throw new Error("Invalid Bridge subscription period");
  return end;
}
export function bridgeAccountId(value: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error("Use the verified user's account ID");
  return value;
}
export function bridgeSubscriptionGrant(input: { accountId: string; planId?: string; interval: BridgeBillingInterval; startsAt: number }, env: BridgePlanEnv = {}) {
  const account = bridgeAccountId(input.accountId), plan = input.planId ?? "standard";
  if (!bridgePlans(env).some((entry) => entry.id === plan && entry.billingIntervals.includes(input.interval))) throw new Error("Unknown Bridge plan or billing interval");
  const expiresAt = bridgePeriodEnd(input.startsAt, input.interval);
  return { expiresAt, sql: `INSERT INTO account_entitlements(account_id,feature,plan_id,billing_interval,status,starts_at,expires_at,updated_at)
      VALUES(?,'bridge',?,?,'active',?,?,?) ON CONFLICT(account_id,feature) DO UPDATE SET
      plan_id=excluded.plan_id,billing_interval=excluded.billing_interval,status='active',starts_at=excluded.starts_at,expires_at=excluded.expires_at,updated_at=excluded.updated_at
      WHERE account_entitlements.plan_id<>excluded.plan_id OR account_entitlements.billing_interval<>excluded.billing_interval OR account_entitlements.status<>'active'
      OR account_entitlements.starts_at<>excluded.starts_at OR account_entitlements.expires_at<>excluded.expires_at`,
    params: [account, plan, input.interval, input.startsAt, expiresAt, Date.now()] as (string | number)[] };
}
export function bridgeSubscriptionRevoke(accountId: string, now = Date.now()) {
  return { sql: "UPDATE account_entitlements SET status='revoked',updated_at=? WHERE account_id=? AND feature='bridge' AND status<>'revoked'", params: [now, bridgeAccountId(accountId)] };
}
