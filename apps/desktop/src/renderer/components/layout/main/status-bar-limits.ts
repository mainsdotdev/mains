import type { RateLimitInfo, RateLimitWindow } from "../../../../shared/adapter.types";

export interface StatusBarLimit {
  key: string;
  group: string;
  label: string;
  remainingPercent: number;
  resetsAt?: number;
}

function windowLabel(window: RateLimitWindow, fallback: string): string {
  if (window.label) return window.label;
  const minutes = window.windowDurationMins;
  if (!minutes || !Number.isFinite(minutes) || minutes <= 0) return fallback;
  if (minutes === 10080) return "Weekly";
  if (minutes === 1440) return "Daily";
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}

/** Keep each provider bucket distinct; unknown usage must never become 100% left. */
export function statusBarLimits(info: RateLimitInfo | null | undefined): StatusBarLimit[] {
  if (!info) return [];
  const buckets = new Map(Object.entries(info.rateLimitsByLimitId ?? {}));
  const rootId = info.limitId ?? "codex";
  if (!buckets.has(rootId) && (info.primary || info.secondary)) buckets.set(rootId, info);
  return [...buckets.entries()]
    .sort(([a], [b]) => Number(b === rootId) - Number(a === rootId))
    .flatMap(([id, bucket]) => (["primary", "secondary"] as const).flatMap((key) => {
      const window = bucket[key];
      if (!window || !Number.isFinite(window.usedPercent)) return [];
      return [{
        key: `${id}:${key}`,
        group: bucket.limitName ?? id,
        label: windowLabel(window, key === "primary" ? "Primary" : "Secondary"),
        remainingPercent: Math.max(0, Math.min(100, 100 - window.usedPercent)),
        resetsAt: window.resetsAt,
      }];
    }));
}
