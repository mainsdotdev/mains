// Operator tooling only. No public Worker route can grant or revoke a plan.
export { bridgeAccountId, bridgePeriodEnd, bridgeSubscriptionGrant, bridgeSubscriptionRevoke } from "./entitlement-lifecycle";
export const bridgeEntitlementSelect = "SELECT account_id,plan_id,billing_interval,status,starts_at,expires_at,updated_at FROM account_entitlements WHERE account_id=? AND feature='bridge'";
