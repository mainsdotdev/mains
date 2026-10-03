/**
 * Known reasoning-effort levels, low → high, for fallback ordering and providers
 * with a fixed vocabulary. Codex's app-server owns its effort identifiers;
 * pickers use each model's `supportedEffortLevels`. "" means reasoning off.
 */
export const EFFORT_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** Provider-defined identifier; Codex can advertise new values via model/list. */
export type EffortLevel = string;

export function isEffortLevel(value: string): value is (typeof EFFORT_LEVELS)[number] {
  return (EFFORT_LEVELS as readonly string[]).includes(value);
}
