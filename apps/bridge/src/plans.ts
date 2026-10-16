import type { BridgePlan } from "@mains/contracts/bridge-subscription";
import { BRIDGE_BLOB_MAX_BYTES } from "@mains/contracts/bridge-blobs";

export interface BridgePlanEnv {
  BRIDGE_STORAGE_LIMIT_BYTES?: string;
  BRIDGE_WRITES_PER_MINUTE?: string;
}
function configured(value: string | undefined, fallback: number, minimum = 0) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < minimum) throw new Error("Invalid Bridge plan configuration");
  return n;
}
/** Billing interval does not change a tier's rights. Add future tiers here. */
export function bridgePlans(env: BridgePlanEnv): BridgePlan[] {
  return [{ id: "standard", name: "Bridge", storageLimitBytes: configured(env.BRIDGE_STORAGE_LIMIT_BYTES, 1024 ** 3),
    fileLimitBytes: BRIDGE_BLOB_MAX_BYTES, writesPerMinute: configured(env.BRIDGE_WRITES_PER_MINUTE, 600, 1), billingIntervals: ["monthly", "yearly"] }];
}
