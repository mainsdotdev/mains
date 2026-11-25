/** Provenance for an explicit goal action or an automatic lifecycle change. */
export type GoalMutationOrigin = "user" | "automatic";

export const MOBILE_GOAL_SUMMARY_CAPABILITY = "mobileGoalSummary";
export const MOBILE_GOAL_CONTROLS_CAPABILITY = "mobileGoalControls";

export interface MobileGoalSummary {
  objective: string;
  status: string;
  tokensUsed?: number;
  timeUsedSeconds?: number;
  revision?: string;
  objectiveTruncated?: boolean;
}

export type MobileGoalChange = { expectedRevision: string } & (
  | { action: "edit"; objective: string }
  | { action: "pause" | "resume" | "clear" }
);

/** Partial update: omitted goal fields remain unchanged. */
export interface GoalSetParams {
  objective?: string;
  status?: string;
  tokenBudget?: number;
  origin?: GoalMutationOrigin;
}
