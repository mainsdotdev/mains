import { bridgePlans, type BridgePlanEnv } from "./plans";
import { bridgeDevelopmentEnabled, createEntitlementLifecycle, emptyBridgeSubscription, type EntitlementRow } from "./entitlement-lifecycle";
export { BRIDGE_SUBSCRIPTION_CACHE_MS, type EntitlementRow } from "./entitlement-lifecycle";

type SubscriptionEnv = BridgePlanEnv & {
  BRIDGE_DEV_AUTH?: string;
  BRIDGE_ENV?: string;
  AUTH_DB?: { prepare(query: string): { bind(...values: unknown[]): { all<T>(): Promise<{ results: T[] }> } } };
};
/** The hub owns D1 I/O; the lifecycle owns receipt validity and grant selection. */
export function createBridgeSubscriptions(env: SubscriptionEnv, now = Date.now) {
  const plans = bridgePlans(env);
  const lifecycle = createEntitlementLifecycle(plans, async (accountId) => {
    const result = await env.AUTH_DB!.prepare(`SELECT 'subscription' source,plan_id,billing_interval,status,starts_at,expires_at
      FROM account_entitlements WHERE account_id=? AND feature='bridge'
      UNION ALL SELECT 'beta' source,'standard' plan_id,NULL billing_interval,status,activated_at starts_at,expires_at
      FROM bridge_beta_invites WHERE account_id=? AND activated_at IS NOT NULL`).bind(accountId, accountId).all<EntitlementRow>();
    return result.results;
  }, now);
  return {
    invalidate: lifecycle.invalidate,
    async status(accountId: string) {
      if (bridgeDevelopmentEnabled(env)) return { plans, subscription: { ...emptyBridgeSubscription(), status: "development" as const, planId: "standard", canUpload: true } };
      if (!env.AUTH_DB) return { plans, subscription: emptyBridgeSubscription() };
      return lifecycle.status(accountId);
    },
  };
}
