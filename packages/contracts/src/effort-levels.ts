/**
 * Reasoning-effort levels, low → high — what the drivers accept and what the
 * effort pickers offer. A model advertises the subset it supports
 * (`ModelInfo.supportedEffortLevels`); "" means reasoning off.
 */
export const EFFORT_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export function isEffortLevel(value: string): value is EffortLevel {
  return (EFFORT_LEVELS as readonly string[]).includes(value);
}
