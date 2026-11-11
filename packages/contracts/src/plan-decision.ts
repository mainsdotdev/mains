export type PlanStatus = "pending" | "applied" | "dismissed" | "failed";
export interface PlanDecisionPayload {
  runId: string;
  accountId: string;
  toolCallId: number;
  decision: "apply" | "dismiss";
  approvalRequestId?: string;
  approvalToken?: string;
}
export interface PlanDecisionResult { status: "applied" | "dismissed" }
export const planDecisionMessageId = (toolCallId: number) => `plan-decision-${toolCallId}`;
export const isPlanToolName = (name: string) => ["plan", "exitplanmode", "createplan"].includes(name.replace(/[_\s-]/g, "").toLowerCase());
export function readPlanStatus(metadata: Record<string, unknown> | undefined, output?: Record<string, unknown> | null): PlanStatus {
  const status = metadata?.planStatus ?? output?.planStatus;
  if (status === "pending" || status === "applied" || status === "dismissed" || status === "failed") return status;
  return metadata?.status === "error" ? "failed" : "pending";
}
/** Generic tool edits cannot bypass the authoritative native decision path. */
export function assertNoPlanDecisionPatch(payload: { metadata?: Record<string, unknown>; output?: unknown }): void {
  const contains = (value: unknown) => !!value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "planStatus");
  if (contains(payload.metadata) || contains(payload.output)) throw new Error("Use the plan decision action to change a plan's status.");
}
