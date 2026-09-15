import type {
  RateLimitInfo,
  RateLimitSnapshotInfo,
  RateLimitWindow,
} from "../../../../shared/adapter.types";

export interface CodexUsageRow {
  key: string;
  group: string;
  label: string;
  usedPercent: number;
  resetsAt?: number;
}

export interface CodexResetCreditSummary {
  label: string;
  value: string;
  description?: string;
}

function humanizeIdentifier(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function reserveModelName(modelSlug: string): string {
  const modelParts = modelSlug
    .split("-")
    .filter(
      (part) =>
        part && part.toLowerCase() !== "gpt" && !/^\d+(?:\.\d+)*$/.test(part),
    );
  return humanizeIdentifier(modelParts.join(" ") || modelSlug);
}

export function codexUsageBucketLabel(
  limitId: string,
  snapshot: RateLimitSnapshotInfo,
): string {
  if (limitId === "codex") return "Advanced usage";

  const isReserve =
    limitId === "base_model_inference" || snapshot.limitName === "gpt-reserve";
  if (isReserve) {
    return snapshot.normalModelSlug
      ? `${reserveModelName(snapshot.normalModelSlug)} Reserve`
      : "Model Reserve";
  }

  return humanizeIdentifier(snapshot.limitName ?? limitId ?? "Usage");
}

export function usageLimitLabel(
  windowDurationMins: number | undefined,
  fallback: string,
): string {
  if (
    windowDurationMins === undefined ||
    !Number.isFinite(windowDurationMins) ||
    windowDurationMins <= 0
  ) {
    return fallback;
  }

  if (windowDurationMins === 7 * 24 * 60) return "Weekly usage limit";
  if (windowDurationMins === 24 * 60) return "Daily usage limit";
  if (windowDurationMins % (24 * 60) === 0) {
    return `${windowDurationMins / (24 * 60)} day usage limit`;
  }
  if (windowDurationMins % 60 === 0) {
    return `${windowDurationMins / 60} hour usage limit`;
  }
  return `${windowDurationMins} minute usage limit`;
}

function bucketPriority(
  limitId: string,
  snapshot: RateLimitSnapshotInfo,
): number {
  if (limitId === "codex") return 0;
  if (
    limitId === "base_model_inference" ||
    snapshot.limitName === "gpt-reserve"
  ) {
    return 1;
  }
  return 2;
}

function collectBuckets(
  rateLimits: RateLimitInfo,
): Array<[string, RateLimitSnapshotInfo]> {
  const buckets = new Map<string, RateLimitSnapshotInfo>(
    Object.entries(rateLimits.rateLimitsByLimitId ?? {}),
  );
  const rootLimitId = rateLimits.limitId ?? "codex";
  if (
    !buckets.has(rootLimitId) &&
    (rateLimits.primary || rateLimits.secondary)
  ) {
    buckets.set(rootLimitId, rateLimits);
  }

  return [...buckets.entries()].sort(([leftId, left], [rightId, right]) => {
    const priority =
      bucketPriority(leftId, left) - bucketPriority(rightId, right);
    if (priority !== 0) return priority;
    return codexUsageBucketLabel(leftId, left).localeCompare(
      codexUsageBucketLabel(rightId, right),
    );
  });
}

function usageRow(
  limitId: string,
  group: string,
  windowKey: "primary" | "secondary",
  window: RateLimitWindow,
): CodexUsageRow {
  return {
    key: `${limitId}:${windowKey}`,
    group,
    label: usageLimitLabel(
      window.windowDurationMins,
      windowKey === "primary" ? "Usage limit" : "Additional usage limit",
    ),
    usedPercent: window.usedPercent,
    ...(window.resetsAt !== undefined ? { resetsAt: window.resetsAt } : {}),
  };
}

export function buildCodexUsageRows(
  rateLimits: RateLimitInfo | null | undefined,
): CodexUsageRow[] {
  if (!rateLimits) return [];

  return collectBuckets(rateLimits).flatMap(([limitId, snapshot]) => {
    const group = codexUsageBucketLabel(limitId, snapshot);
    return [
      ...(snapshot.primary
        ? [usageRow(limitId, group, "primary", snapshot.primary)]
        : []),
      ...(snapshot.secondary
        ? [usageRow(limitId, group, "secondary", snapshot.secondary)]
        : []),
    ];
  });
}

function formatExpiryDate(expiresAt: number): string {
  return `Expires ${new Date(expiresAt * 1000).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  })}`;
}

export function buildCodexResetCreditSummary(
  rateLimits: RateLimitInfo | null | undefined,
): CodexResetCreditSummary | undefined {
  const resetCredits = rateLimits?.rateLimitResetCredits;
  if (!resetCredits) return undefined;

  const availableCredits = (resetCredits.credits ?? []).filter(
    (credit) => credit.status === "available",
  );
  const representativeCredit = availableCredits[0];
  const earliestExpiry = availableCredits.reduce<number | undefined>(
    (earliest, credit) => {
      if (credit.expiresAt === undefined) return earliest;
      return earliest === undefined
        ? credit.expiresAt
        : Math.min(earliest, credit.expiresAt);
    },
    undefined,
  );
  const description = [
    representativeCredit?.title,
    earliestExpiry !== undefined ? formatExpiryDate(earliestExpiry) : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  const availableCount = Math.max(0, resetCredits.availableCount);

  return {
    label: "Reset credits",
    value: `${availableCount.toLocaleString()} available`,
    ...(description ? { description } : {}),
  };
}

function snapshotOnly(rateLimits: RateLimitInfo): RateLimitSnapshotInfo {
  const {
    ordinaryUsageAllowed: _ordinaryUsageAllowed,
    rateLimitsByLimitId: _rateLimitsByLimitId,
    rateLimitResetCredits: _rateLimitResetCredits,
    ...snapshot
  } = rateLimits;
  return snapshot;
}

/** Merge a one-bucket push update without discarding the full pulled response. */
export function mergeCodexRateLimitUpdate(
  current: RateLimitInfo | null | undefined,
  update: RateLimitInfo,
): RateLimitInfo {
  const incomingSnapshot = snapshotOnly(update);
  if (!current) {
    return {
      ...update,
      ...(update.limitId
        ? {
            rateLimitsByLimitId: {
              ...update.rateLimitsByLimitId,
              [update.limitId]: incomingSnapshot,
            },
          }
        : {}),
    };
  }

  const buckets = {
    ...current.rateLimitsByLimitId,
    ...update.rateLimitsByLimitId,
  };
  if (update.limitId) {
    buckets[update.limitId] = {
      ...buckets[update.limitId],
      ...incomingSnapshot,
    };
  }

  const rootLimitId = current.limitId ?? "codex";
  const updatesRoot =
    update.limitId === undefined ||
    update.limitId === rootLimitId ||
    update.limitId === "codex";

  return {
    ...current,
    ...(updatesRoot ? incomingSnapshot : {}),
    ...(Object.keys(buckets).length > 0
      ? { rateLimitsByLimitId: buckets }
      : {}),
    ...("ordinaryUsageAllowed" in update
      ? { ordinaryUsageAllowed: update.ordinaryUsageAllowed }
      : {}),
    ...("rateLimitResetCredits" in update
      ? { rateLimitResetCredits: update.rateLimitResetCredits }
      : {}),
  };
}
