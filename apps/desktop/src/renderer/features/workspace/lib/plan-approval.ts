interface ToolApprovalLike {
  requestId: string;
  toolName: string;
}

type RespondToToolApproval = (
  requestId: string,
  approved: boolean,
  answer?: string,
) => void;

export type PlanStatus = "pending" | "applied" | "dismissed" | "failed";
export type PlanInteractionMode = "live-approval" | "follow-up";

function isPlanStatus(value: unknown): value is PlanStatus {
  return (
    value === "pending" ||
    value === "applied" ||
    value === "dismissed" ||
    value === "failed"
  );
}

export function getPersistedPlanStatus(
  metadata: Record<string, unknown> | undefined,
  legacyOutput: Record<string, unknown> | null,
): PlanStatus {
  if (isPlanStatus(metadata?.planStatus)) return metadata.planStatus;
  if (isPlanStatus(legacyOutput?.planStatus)) return legacyOutput.planStatus;
  if (metadata?.status === "error") return "failed";
  return "pending";
}

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
