import type { BridgeQuota } from "@mains/contracts/bridge";
import { BRIDGE_BLOB_MAX_BYTES } from "@mains/contracts/bridge-blobs";
import type { createBridgeSubscriptions } from "./subscriptions";
import type { createBridgeLimits } from "./limits";

export type QuotaUsage = Pick<BridgeQuota, "blobBytes" | "reservedBytes" | "recordBytes" | "retainedBlobBytes">;

export async function readBridgeQuota(accountId: string, subscriptions: ReturnType<typeof createBridgeSubscriptions>,
  limits: ReturnType<typeof createBridgeLimits>, readUsage: () => QuotaUsage | Promise<QuotaUsage>): Promise<BridgeQuota> {
  let subscription = await subscriptions.status(accountId);
  for (;;) {
    const plan = subscription.subscription.planId;
    const policy = await limits.get(accountId, plan ?? undefined);
    // Recheck after policy I/O in case the effective grant changed.
    subscription = await subscriptions.status(accountId);
    if (subscription.subscription.planId !== plan) continue;
    const bytes = await readUsage();
    return { ...policy, ...bytes, usedBytes: bytes.recordBytes + bytes.blobBytes + bytes.reservedBytes,
      fileLimitBytes: BRIDGE_BLOB_MAX_BYTES, ...subscription };
  }
}
