// Operator tooling only. Never imported by the public Worker entry.
import type { BridgeBillingInterval } from "@mains/contracts/bridge-subscription";
import { bridgePlans, type BridgePlanEnv } from "./plans";

export function bridgePeriodEnd(startsAt: number, interval: BridgeBillingInterval): number {
  if (!Number.isSafeInteger(startsAt) || startsAt < 0 || !["monthly", "yearly"].includes(interval)) throw new Error("Invalid Bridge subscription period");
  const start = new Date(startsAt), end = new Date(startsAt);
  end.setUTCDate(1); end.setUTCMonth(start.getUTCMonth() + (interval === "monthly" ? 1 : 12));
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  if (!Number.isSafeInteger(end.getTime()) || end.getTime() <= startsAt) throw new Error("Invalid Bridge subscription period");
  return end.getTime();
}
export const bridgeEntitlementSelect = "SELECT account_id,plan_id,billing_interval,status,starts_at,expires_at,updated_at FROM account_entitlements WHERE account_id=? AND feature='bridge'";
export function bridgeAccountId(value: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error("Use the verified user's account ID");
  return value;
}
export function bridgeSubscriptionGrant(input: { accountId: string; planId?: string; interval: BridgeBillingInterval; startsAt: number }, env: BridgePlanEnv = {}) {
  const account = bridgeAccountId(input.accountId), plan = input.planId ?? "standard";
  if (!bridgePlans(env).some((entry) => entry.id === plan && entry.billingIntervals.includes(input.interval))) throw new Error("Unknown Bridge plan or billing interval");
  const expiresAt = bridgePeriodEnd(input.startsAt, input.interval);
  return {
    expiresAt,
    sql: `INSERT INTO account_entitlements(account_id,feature,plan_id,billing_interval,status,starts_at,expires_at,updated_at)
      VALUES(?,'bridge',?,?,'active',?,?,?) ON CONFLICT(account_id,feature) DO UPDATE SET
      plan_id=excluded.plan_id,billing_interval=excluded.billing_interval,status='active',starts_at=excluded.starts_at,expires_at=excluded.expires_at,updated_at=excluded.updated_at
      WHERE account_entitlements.plan_id<>excluded.plan_id OR account_entitlements.billing_interval<>excluded.billing_interval OR account_entitlements.status<>'active'
      OR account_entitlements.starts_at<>excluded.starts_at OR account_entitlements.expires_at<>excluded.expires_at`,
    params: [account, plan, input.interval, input.startsAt, expiresAt, Date.now()] as (string | number)[],
  };
}
