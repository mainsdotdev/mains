import type { RateLimitInfo } from "../../../../shared/adapter.types";
import type { ProviderUsageRow } from "../components/provider-settings-shared";

export function buildClaudeUsageRows(
  rateLimits: RateLimitInfo | null | undefined,
): ProviderUsageRow[] {
  if (!rateLimits) return [];
  const buckets = Object.values(rateLimits.rateLimitsByLimitId ?? {});
  // Primary/secondary also support a backend that only exposes the core windows.
  const snapshots = buckets.length > 0 ? buckets : [rateLimits];
  return snapshots.flatMap((snapshot) =>
    [snapshot.primary, snapshot.secondary].flatMap((window) =>
      window
        ? [{
            label: window.label ?? snapshot.limitName ?? "Usage limit",
            usedPercent: window.usedPercent,
            resetsAt: window.resetsAt,
          }]
        : [],
    ),
  );
}
