import type { BridgeSubscription } from "@mains/contracts/bridge-subscription";
import type { BridgeDiagnosticsEnv } from "./observability";
import { bridgeRecordsPerMonth, type BridgePlanEnv } from "./plans";
import { addUtcMonths } from "./periods";

export interface WriteBudgetPeriod { start: number; end: number }
export interface WriteBudgetEvent {
  event: "bridge.write_budget"; hubId: string; environment: string; threshold: 80 | 100;
  records: number; budget: number; periodStart: string; periodEnd: string;
}

/** Monthly window anchored to the entitlement start, like billing. Without a
 * started entitlement (development, scheduled), the UTC calendar month is used. */
export function writeBudgetPeriod(anchor: number | null, now = Date.now()): WriteBudgetPeriod {
  if (anchor === null || !Number.isSafeInteger(anchor) || anchor < 0 || anchor > now) {
    const date = new Date(now), start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    return { start, end: addUtcMonths(start, 1) };
  }
  const from = new Date(anchor), to = new Date(now);
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth();
  if (addUtcMonths(anchor, months) > now) months--;
  return { start: addUtcMonths(anchor, months), end: addUtcMonths(anchor, months + 1) };
}
export function subscriptionWriteBudgetPeriod(subscription: BridgeSubscription | undefined, now = Date.now()): WriteBudgetPeriod {
  const anchor = subscription?.startsAt ? Date.parse(subscription.startsAt) : NaN;
  return writeBudgetPeriod(Number.isSafeInteger(anchor) ? anchor : null, now);
}

/** Monitoring only: one event when a push crosses 80% or 100% of the period's
 * fair-use budget. No account ID, record content or SQL is logged. */
export function reportWriteBudget(env: BridgePlanEnv & BridgeDiagnosticsEnv, hubId: string, period: WriteBudgetPeriod, before: number, after: number,
  emit: (event: WriteBudgetEvent) => void = (event) => console.info(JSON.stringify(event))) {
  try {
    const budget = bridgeRecordsPerMonth(env);
    for (const threshold of [80, 100] as const) {
      const limit = Math.ceil(budget * threshold / 100);
      if (before >= limit || after < limit) continue;
      emit({ event: "bridge.write_budget", hubId: /^[a-f0-9]{64}$/i.test(hubId) ? hubId : "unavailable",
        environment: env.BRIDGE_ENV === "production" || env.BRIDGE_ENV === "staging" ? env.BRIDGE_ENV : "local", threshold,
        records: after, budget, periodStart: new Date(period.start).toISOString(), periodEnd: new Date(period.end).toISOString() });
    }
  } catch { /* Monitoring must never affect publication. */ }
}
