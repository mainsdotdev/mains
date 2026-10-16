import type { BridgeSubscription, BridgeSubscriptionStatus } from "@mains/contracts/bridge-subscription";
import type { DevAuthEnv } from "./auth";
import { bridgeDevelopmentEnabled } from "./auth";
import { bridgePlans, type BridgePlanEnv } from "./plans";

type SubscriptionEnv = DevAuthEnv & BridgePlanEnv;
export interface EntitlementRow {
  plan_id: string;
  billing_interval: "monthly" | "yearly";
  status: "active" | "revoked";
  starts_at: number;
  expires_at: number;
}
export const BRIDGE_SUBSCRIPTION_CACHE_MS = 60_000;
const empty: BridgeSubscription = { status: "none", planId: null, billingInterval: null, startsAt: null, expiresAt: null, canUpload: false };

/** Indexed D1 lookup with a bounded, short-lived, single-flight cache. Expiry is
 * evaluated on every call, so an active cached row never extends its period. */
export function createBridgeSubscriptions(env: SubscriptionEnv, now = Date.now) {
  const cache = new Map<string, { until: number; row: Promise<EntitlementRow | null> }>();
  const plans = bridgePlans(env);
  return {
    invalidate(accountId: string) { cache.delete(accountId); },
    async status(accountId: string): Promise<BridgeSubscriptionStatus> {
      if (bridgeDevelopmentEnabled(env)) return { plans, subscription: { ...empty, status: "development", planId: "standard", canUpload: true } };
      if (!env.AUTH_DB) return { plans, subscription: { ...empty } };
      let entry = cache.get(accountId);
      if (!entry || entry.until <= now()) {
        if (cache.size >= 256) cache.delete(cache.keys().next().value!);
        entry = { until: now() + BRIDGE_SUBSCRIPTION_CACHE_MS,
          row: env.AUTH_DB.prepare("SELECT plan_id,billing_interval,status,starts_at,expires_at FROM account_entitlements WHERE account_id=? AND feature='bridge'")
            .bind(accountId).first<EntitlementRow>() };
        cache.set(accountId, entry);
      }
      let row: EntitlementRow | null;
      try { row = await entry.row; }
      catch (error) { if (cache.get(accountId) === entry) cache.delete(accountId); throw error; }
      if (!row) return { plans, subscription: { ...empty } };
      const valid = plans.some((plan) => plan.id === row.plan_id) && ["monthly", "yearly"].includes(row.billing_interval) &&
        Number.isSafeInteger(row.starts_at) && Number.isSafeInteger(row.expires_at) && row.starts_at >= 0 && row.expires_at > row.starts_at && row.expires_at <= 8_640_000_000_000_000;
      const status: BridgeSubscription["status"] = !valid ? "unavailable" : row.status === "revoked" ? "revoked" : row.status !== "active" ? "unavailable" :
        now() < row.starts_at ? "scheduled" : now() >= row.expires_at ? "expired" : "active";
      return { plans, subscription: { status, planId: row.plan_id, billingInterval: ["monthly", "yearly"].includes(row.billing_interval) ? row.billing_interval : null,
        startsAt: valid ? new Date(row.starts_at).toISOString() : null, expiresAt: valid ? new Date(row.expires_at).toISOString() : null, canUpload: status === "active" } };
    },
  };
}
