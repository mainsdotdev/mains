import type { DevAuthEnv } from "./auth";
import { bridgePlans, type BridgePlanEnv } from "./plans";

type LimitsEnv = DevAuthEnv & BridgePlanEnv;
export const BRIDGE_LIMITS_CACHE_MS = 60_000;
export async function bridgeLimits(env: LimitsEnv, accountId: string, planId = "standard") {
  const plan = bridgePlans(env).find((plan) => plan.id === planId) ?? bridgePlans(env)[0];
  const override = env.AUTH_DB ? await env.AUTH_DB.prepare("SELECT plan,storage_limit_bytes,writes_per_minute FROM bridge_account_quotas WHERE account_id=?").bind(accountId)
    .first<{ plan: string; storage_limit_bytes: number; writes_per_minute: number }>() : null;
  return Object.freeze({ plan: override?.plan ?? plan.id, limitBytes: override?.storage_limit_bytes ?? plan.storageLimitBytes,
    writesPerMinute: override?.writes_per_minute ?? plan.writesPerMinute });
}

/** Cache policy only. Live record/chunk/reservation totals are always read under
 * the account gate. No stale fallback is allowed after expiry or a failed read. */
export function createBridgeLimits(env: LimitsEnv, options: { now?: () => number; onCache?: (hit: boolean) => void } = {}) {
  const now = options.now ?? Date.now;
  const cache = new Map<string, { accountId: string; until: number; value: ReturnType<typeof bridgeLimits> }>();
  return {
    invalidate(accountId: string) { for (const [key, entry] of cache) if (entry.accountId === accountId) cache.delete(key); },
    async get(accountId: string, planId = "standard") {
      const key = JSON.stringify([accountId, planId]);
      let entry = cache.get(key);
      const hit = !!entry && entry.until > now();
      try { options.onCache?.(hit); } catch { /* Diagnostics cannot change quota decisions. */ }
      if (!hit) {
        if (cache.size >= 256) cache.delete(cache.keys().next().value!);
        entry = { accountId, until: now() + BRIDGE_LIMITS_CACHE_MS, value: bridgeLimits(env, accountId, planId) };
        cache.set(key, entry);
      }
      try { return await entry!.value; }
      catch (error) { if (cache.get(key) === entry) cache.delete(key); throw error; }
    },
  };
}
