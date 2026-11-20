import type { FindingSeverity } from "@/lib/redux/api";

/**
 * Inline accents for review-finding counts and diff summaries.
 */

export function asFindingSeverity(s: string): FindingSeverity {
  if (s === "critical" || s === "warning" || s === "info") return s;
  return "info";
}

/** Inline text accents for severity dots/counters. */
export const SEVERITY_TEXT: Record<FindingSeverity, string> = {
  critical: "text-danger",
  warning: "text-warning",
  info: "text-accent",
};

/** Diff insertion/deletion accents shared by every diff summary surface. */
export const DIFF_ADDED_TEXT = "text-success";
export const DIFF_REMOVED_TEXT = "text-danger";
