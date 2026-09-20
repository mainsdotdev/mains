import type { Pulse } from "@/lib/redux/api/pulseApi";

/**
 * Pulse timestamps are typed as `Date` but only arrive as one over structured
 * clone; the WebSocket transport can hand back strings. Normalize rather than
 * trust either.
 */
function toEpochMs(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** Compact distance to a timestamp: `in 3h`, `2d ago`, `now`. */
export function formatRelative(value: unknown, now = Date.now()): string | null {
  const ms = toEpochMs(value);
  if (ms === null) return null;
  const delta = ms - now;
  const minutes = Math.floor(Math.abs(delta) / 60_000);
  if (minutes < 1) return "now";
  const span =
    minutes < 60
      ? `${minutes}m`
      : minutes < 24 * 60
        ? `${Math.floor(minutes / 60)}h`
        : `${Math.floor(minutes / (24 * 60))}d`;
  return delta > 0 ? `in ${span}` : `${span} ago`;
}

export type PulseState = "active" | "paused" | "failed";

export interface PulseStatus {
  state: PulseState;
  /** Short trailing label for the row's meta line; null when there is nothing to add. */
  label: string | null;
}

/**
 * What a pulse row says about itself. A failed last run outranks everything —
 * a paused pulse that failed still needs looking at — then paused, then when
 * it fires next.
 */
export function describePulseStatus(
  pulse: Pick<Pulse, "isActive" | "lastError" | "lastRunAt" | "nextRunAt">,
  now = Date.now(),
): PulseStatus {
  if (pulse.lastError) {
    const ago = formatRelative(pulse.lastRunAt, now);
    return {
      state: "failed",
      label: ago && ago !== "now" ? `Failed ${ago}` : "Last run failed",
    };
  }
  if (!pulse.isActive) return { state: "paused", label: "Paused" };

  const nextMs = toEpochMs(pulse.nextRunAt);
  if (nextMs === null) return { state: "active", label: null };
  if (nextMs <= now) return { state: "active", label: "Due now" };
  return { state: "active", label: `Next ${formatRelative(nextMs, now)}` };
}
