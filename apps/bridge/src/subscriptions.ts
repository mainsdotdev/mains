import type { BridgeSubscription, BridgeSubscriptionStatus } from "@mains/contracts/bridge-subscription";
import type { DevAuthEnv } from "./auth";
import { bridgeDevelopmentEnabled } from "./auth";
import { bridgePlans, type BridgePlanEnv } from "./plans";

type SubscriptionEnv = DevAuthEnv & BridgePlanEnv;
export interface EntitlementRow {
  source: "subscription" | "beta";
  plan_id: string;
  billing_interval: "monthly" | "yearly" | null;
  status: "active" | "revoked";
  starts_at: number;
  expires_at: number;
}
export const BRIDGE_SUBSCRIPTION_CACHE_MS = 60_000;
const empty: BridgeSubscription = { status: "none", planId: null, billingInterval: null, startsAt: null, expiresAt: null, canUpload: false };

/** Indexed D1 lookup with a bounded, short-lived, single-flight cache. Expiry is
 * evaluated on every call, so an active cached row never extends its period. */
export function createBridgeSubscriptions(env: SubscriptionEnv, now = Date.now) {
  const cache = new Map<string, { until: number; rows: Promise<EntitlementRow[]> }>();
  const plans = bridgePlans(env);
  const format = (row: EntitlementRow): BridgeSubscription => {
    const valid = plans.some((plan) => plan.id === row.plan_id) && (row.source === "beta" || ["monthly", "yearly"].includes(row.billing_interval ?? "")) &&
      Number.isSafeInteger(row.starts_at) && Number.isSafeInteger(row.expires_at) && row.starts_at >= 0 && row.expires_at > row.starts_at && row.expires_at <= 8_640_000_000_000_000;
    const status: BridgeSubscription["status"] = !valid ? "unavailable" : row.status === "revoked" ? "revoked" : row.status !== "active" ? "unavailable" :
      now() < row.starts_at ? "scheduled" : now() >= row.expires_at ? "expired" : "active";
    return { ...(row.source === "beta" ? { source: "beta" as const } : {}), status, planId: row.plan_id,
      billingInterval: row.source === "subscription" && ["monthly", "yearly"].includes(row.billing_interval ?? "") ? row.billing_interval : null,
      startsAt: valid ? new Date(row.starts_at).toISOString() : null, expiresAt: valid ? new Date(row.expires_at).toISOString() : null, canUpload: status === "active" };
  };
  return {
    invalidate(accountId: string) { cache.delete(accountId); },
    async status(accountId: string): Promise<BridgeSubscriptionStatus> {
      if (bridgeDevelopmentEnabled(env)) return { plans, subscription: { ...empty, status: "development", planId: "standard", canUpload: true } };
      if (!env.AUTH_DB) return { plans, subscription: { ...empty } };
      let entry = cache.get(accountId);
      if (!entry || entry.until <= now()) {
        if (cache.size >= 256) cache.delete(cache.keys().next().value!);
        entry = { until: now() + BRIDGE_SUBSCRIPTION_CACHE_MS,
          rows: env.AUTH_DB.prepare(`SELECT 'subscription' source,plan_id,billing_interval,status,starts_at,expires_at
            FROM account_entitlements WHERE account_id=? AND feature='bridge'
            UNION ALL SELECT 'beta' source,'standard' plan_id,NULL billing_interval,status,activated_at starts_at,expires_at
            FROM bridge_beta_invites WHERE account_id=? AND activated_at IS NOT NULL`)
            .bind(accountId, accountId).all<EntitlementRow>().then((result) => result.results) };
        cache.set(accountId, entry);
      }
      let rows: EntitlementRow[];
      try { rows = await entry.rows; }
      catch (error) { if (cache.get(accountId) === entry) cache.delete(accountId); throw error; }
      const subscriptions = rows.map(format), paid = subscriptions.find((entry) => entry.source !== "beta"), beta = subscriptions.find((entry) => entry.source === "beta");
      // Re-evaluate both cached periods on every call. A scheduled paid period
      // takes over on time; an active paid grant is never downgraded by beta.
      return { plans, subscription: paid?.canUpload ? paid : beta?.canUpload ? beta : beta ?? paid ?? { ...empty } };
    },
  };
}
