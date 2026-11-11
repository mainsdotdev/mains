import { waitForConversationSettings } from "./conversation-settings-writer";
import { createDecisionOwner } from "@mains/contracts/decision-owner";
import { CHANNELS } from "@mains/contracts/channels";
import { readPlanStatus, type PlanStatus, type PlanDecisionPayload, type PlanDecisionResult } from "@mains/contracts/plan-decision";
import { getTransport, onTransportChange, type Transport } from "@/lib/transport";
export type { PlanStatus } from "@mains/contracts/plan-decision";
interface ToolApprovalLike {
  requestId: string;
  toolName: string;
}

type RespondToToolApproval = (
  requestId: string,
  approved: boolean,
  answer?: string,
) => void;

export type PlanInteractionMode = "live-approval" | "follow-up";

export const getPersistedPlanStatus = readPlanStatus;

/** Bind the settings barrier and native plan decision to one backend. */
export async function submitPlanDecision(payload: PlanDecisionPayload, prepare?: () => Promise<void>, transport: Transport = getTransport()): Promise<PlanDecisionResult> {
  let retired = false;
  const off = onTransportChange(() => { retired = true; });
  const current = () => {
    if (retired || getTransport() !== transport || transport.status() !== "connected") throw new Error("The plan backend changed. Reopen the plan to continue.");
  };
  try {
    current(); await prepare?.(); current();
    await waitForConversationSettings(transport, payload.runId); current();
    const result = await transport.invoke(CHANNELS.runs.decidePlan, [payload]);
    current();
    if (!result.success) throw new Error(result.error);
    return result.data as PlanDecisionResult;
  } finally { off(); }
}

export const createPlanViewLifecycle = createDecisionOwner;

export function shouldShowPlanActions({
  status,
  interactionMode,
  hasPendingApproval,
  isRunActive,
}: {
  status: PlanStatus;
  interactionMode: PlanInteractionMode;
  hasPendingApproval: boolean;
  isRunActive: boolean;
}): boolean {
  if (status !== "pending") return false;
  if (interactionMode === "live-approval") return hasPendingApproval;
  return !isRunActive;
}

export function isExitPlanApproval(
  approval: ToolApprovalLike | undefined,
): approval is ToolApprovalLike {
  if (!approval) return false;
  return approval.toolName.replace(/[_\s-]/g, "").toLowerCase() === "exitplanmode";
}

/**
 * Resolve Claude's pending ExitPlanMode permission from the inline plan card.
 * Returns false when the active approval belongs to another tool so the
 * caller can keep using the standard approval dialog/follow-up flow.
 */
export function respondToExitPlanApproval(
  approval: ToolApprovalLike | undefined,
  approved: boolean,
  respond: RespondToToolApproval,
): boolean {
  if (!isExitPlanApproval(approval)) return false;
  respond(approval.requestId, approved);
  return true;
}
