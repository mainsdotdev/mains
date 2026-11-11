import { isPlanToolName, planDecisionMessageId, readPlanStatus, type PlanDecisionPayload, type PlanDecisionResult } from "@mains/contracts/plan-decision";
import { isRunInputDeliveryUncertain } from "@mains/contracts/run-input";
import type { RunInputStatusPayload } from "@mains/contracts/runs";
import type { ContinueRunPayload } from "./runs.dto";
import { admitAnswer } from "./async-answer-lifecycle";
import { runsRepo } from "./runs.repo";
import { handleToolApprovalResponse, listPendingApprovals } from "./user-input-broker";
import { emit } from "../../ipc-kit";
import { CHANNELS } from "@mains/contracts/channels";

interface Operations {
  continueRun(payload: ContinueRunPayload): Promise<unknown>;
  getInputStatus(payload: RunInputStatusPayload): Promise<{ accepted: boolean }>;
}
interface Decision {
  action: PlanDecisionPayload["decision"];
  accepted: boolean;
  uncertain: boolean;
  result?: Promise<PlanDecisionResult>;
}
const decisions = new Map<string, Decision>();
const continuationOwners = new Map<string, () => void>();
const continuationKey = (runId: string, messageId: string) => JSON.stringify([runId, messageId]);

/** A high-level continuation may await attachments/settings before native send. */
export function assertPlanContinuationCurrent(runId: string, messageId?: string): void {
  if (messageId) continuationOwners.get(continuationKey(runId, messageId))?.();
}

/** Native acceptance precedes the durable marker. Retain the accepted
 * checkpoint on marker failure; retries finish persistence without re-sending. */
export function decidePlan(payload: PlanDecisionPayload, operations: Operations): Promise<PlanDecisionResult> {
  return admitAnswer(payload.runId, -payload.toolCallId, async (assertCurrent) => {
    if (!Number.isSafeInteger(payload.toolCallId) || payload.toolCallId <= 0 || !["apply", "dismiss"].includes(payload.decision)) throw new Error("Invalid plan decision");
    const run = await runsRepo.findRunById(payload.runId);
    if (!run || run.accountId !== payload.accountId) throw new Error("Plan does not belong to this account or conversation");
    if (run.isArchived || run.isReplica) throw new Error("Open an owned, unarchived conversation before deciding this plan");
    const calls = await runsRepo.findToolCallsByRun(run.id);
    const plan = calls.find((call) => call.id === payload.toolCallId);
    if (!plan || !isPlanToolName(plan.toolName) || plan.parentToolCallId || plan.metadata?.isFromSubagent === true) throw new Error("Plan not found in this conversation");
    const status = readPlanStatus(plan.metadata ?? undefined, plan.output && typeof plan.output === "object" ? plan.output as Record<string, unknown> : null);
    const desired = payload.decision === "apply" ? "applied" : "dismissed";
    if (status === desired) return { status: desired };
    if (status !== "pending" || plan.status === "error") throw new Error("This plan has already been decided or failed");
    if (calls.filter((call) => isPlanToolName(call.toolName) && !call.parentToolCallId && call.metadata?.isFromSubagent !== true).at(-1)?.id !== plan.id) throw new Error("A newer plan replaced this plan");
    const key = JSON.stringify([run.id, plan.id]);
    const previous = decisions.get(key);
    if (previous && previous.action !== payload.decision) throw new Error("The previous plan decision is still being delivered. Retry that decision first.");
    if (previous?.result) return previous.result;
    const owner: Decision = previous ?? { action: payload.decision, accepted: false, uncertain: false };
    decisions.set(key, owner);
    const message = "Execute the plan above.", clientUserMessageId = planDecisionMessageId(plan.id);
    owner.result = (async (): Promise<PlanDecisionResult> => {
      let invoked = false;
      try {
        if (payload.decision === "apply" && !owner.accepted) {
          if (await runsRepo.findInputArtifact(run.id, clientUserMessageId)) owner.accepted = true;
          else if (!payload.approvalRequestId || owner.uncertain) {
            owner.accepted = (await operations.getInputStatus({ runId: run.id, accountId: run.accountId, clientUserMessageId, input: { message } })).accepted;
            if (owner.uncertain && !owner.accepted) throw new Error("Plan delivery is unknown. Retry to check delivery before sending again.");
          }
        }
        if (!owner.accepted) {
          assertCurrent();
          const current = await runsRepo.findRunById(run.id);
          if (!current || current.isArchived) throw new Error("This conversation is no longer available");
          assertCurrent();
          if (current.status === "running" || current.status === "queued") {
            const approval = listPendingApprovals(run.id).find((request) => request.requestId === payload.approvalRequestId && request.toolName.replace(/[_\s-]/g, "").toLowerCase() === "exitplanmode");
            if (!approval || approval.approvalToken !== payload.approvalToken) throw new Error("The live plan approval changed or is not ready. Refresh and try again.");
            handleToolApprovalResponse({ requestId: approval.requestId, approvalToken: approval.approvalToken, approved: payload.decision === "apply" });
            owner.accepted = true;
          } else if (payload.approvalRequestId) {
            throw new Error("The live plan approval ended. Refresh before deciding it again.");
          } else if (payload.decision === "apply") {
            invoked = true;
            const inputKey = continuationKey(run.id, clientUserMessageId);
            continuationOwners.set(inputKey, assertCurrent);
            try {
              await operations.continueRun({ runId: run.id, accountId: run.accountId, message, clientUserMessageId });
            } finally {
              if (continuationOwners.get(inputKey) === assertCurrent) continuationOwners.delete(inputKey);
            }
            owner.accepted = true;
          } else owner.accepted = true;
        }
        await runsRepo.updateToolCall(plan.id, { metadata: { planStatus: desired } });
        emit(CHANNELS.runs.eventPersisted, { runId: run.id });
        if (decisions.get(key) === owner) decisions.delete(key);
        return { status: desired };
      } catch (error) {
        if (owner.accepted) throw new Error("The plan decision was accepted, but saving its status failed. Retry to finish saving.");
        if (owner.uncertain || invoked && isRunInputDeliveryUncertain(error instanceof Error ? error.message : String(error))) {
          owner.uncertain = true;
          throw new Error("Plan delivery is unknown. Retry to check delivery before sending again.");
        }
        if (decisions.get(key) === owner) decisions.delete(key);
        throw error;
      } finally { owner.result = undefined; }
    })();
    return owner.result;
  });
}

export function clearPlanDecisions(): void { decisions.clear(); continuationOwners.clear(); }
