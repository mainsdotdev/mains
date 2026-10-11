/** Provenance for an explicit goal action or an automatic lifecycle change. */
export type GoalMutationOrigin = "user" | "automatic";

/** Partial update: omitted goal fields remain unchanged. */
export interface GoalSetParams {
  objective?: string;
  status?: string;
  tokenBudget?: number;
  origin?: GoalMutationOrigin;
}
