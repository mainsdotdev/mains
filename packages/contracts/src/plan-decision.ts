import { PROVIDER_IDS, type ProviderId } from "./provider-ids";
import type { RunSettingConfig } from "./run-settings";

export const MOBILE_PLAN_DECISION_CAPABILITY = "mobilePlanDecision";
export const PLAN_DECISION_UNCONFIRMED = "Plan delivery has not been confirmed yet.";
export const PLAN_TOOL_NAMES = ["plan", "exitplanmode", "createplan"];
export interface PlanExitConfig { key: keyof RunSettingConfig; planValue: string | boolean; nextValue: string | boolean }
export const PLAN_EXIT_SETTINGS: Record<ProviderId, PlanExitConfig> = {
  [PROVIDER_IDS.claude]: { key: "permissionMode", planValue: "plan", nextValue: "acceptEdits" },
  [PROVIDER_IDS.copilot]: { key: "permissionMode", planValue: "plan", nextValue: "acceptEdits" },
  [PROVIDER_IDS.codex]: { key: "planMode", planValue: true, nextValue: false },
  [PROVIDER_IDS.cursor]: { key: "mode", planValue: "plan", nextValue: "agent" },
  [PROVIDER_IDS.opencode]: { key: "agent", planValue: "plan", nextValue: "build" },
};

export type PlanStatus = "pending" | "applied" | "dismissed" | "failed";
export interface PlanDecisionPayload {
  runId: string;
  accountId: string;
  toolCallId: number;
  decision: "apply" | "dismiss";
  approvalRequestId?: string;
  approvalToken?: string;
  checkOnly?: boolean;
}
export interface PlanDecisionResult { status: "applied" | "dismissed" }
export const planDecisionMessageId = (toolCallId: number) => `plan-decision-${toolCallId}`;
export const isPlanToolName = (name: string) => PLAN_TOOL_NAMES.includes(name.replace(/[_\s-]/g, "").toLowerCase());
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
