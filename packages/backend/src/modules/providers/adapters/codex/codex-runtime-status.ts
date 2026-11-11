import type { WorkRunLogEvent } from "../../../../../shared/adapter.types";
import type { ModelSafetyBufferingUpdatedNotification } from "./codex-app-server-protocol/generated/v2/ModelSafetyBufferingUpdatedNotification";
import type { ModelVerificationNotification } from "./codex-app-server-protocol/generated/v2/ModelVerificationNotification";
import type { ItemGuardianApprovalReviewCompletedNotification } from "./codex-app-server-protocol/generated/v2/ItemGuardianApprovalReviewCompletedNotification";
import type { HookCompletedNotification } from "./codex-app-server-protocol/generated/v2/HookCompletedNotification";

interface StatusSnapshot {
  signature: string;
  event: WorkRunLogEvent;
}

export interface CodexRuntimeStatusState {
  turnId: string | null;
  runtimeStatuses?: Map<string, StatusSnapshot>;
  runtimeStatusesClosed?: boolean;
}

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};

/** Project native waiting/review states into the existing transcript log rows.
 * Statuses are informational: only turn/error lifecycle events finish a run. */
export function mapCodexRuntimeStatus(
  method: string,
  params: unknown,
  state: CodexRuntimeStatusState,
  ts: number,
): WorkRunLogEvent[] | undefined {
  const p = record(params);
  if (state.runtimeStatusesClosed && method !== "thread/closed" && method !== "turn/completed" && method !== "error") return [];
  const turnId = text(p.turnId ?? record(p.turn).id) ?? state.turnId ?? "thread";
  const snapshots = state.runtimeStatuses ??= new Map();

  function publish(kind: string, nativeId: string, phase: "start" | "complete", status: string,
    message: string, level: WorkRunLogEvent["level"] = "info", details: Record<string, unknown> = {}) {
    const statusId = kind === "hook" || kind === "review" ? `${kind}:${nativeId}` : `${turnId}:${kind}:${nativeId}`;
    const previous = snapshots.get(statusId);
    if (previous?.event.metadata?.phase === "complete" && phase === "start" && kind !== "buffering" && kind !== "verification") return [];
    const event: WorkRunLogEvent = { type: "log", level, message, ts,
      metadata: { source: "codex_runtime_status", statusId, phase, status, kind, providerTurnId: turnId, ...details } };
    const signature = JSON.stringify([message, level, event.metadata]);
    if (previous?.signature === signature) return [];
    snapshots.set(statusId, { signature, event });
    return [event];
  }

  switch (method) {
    case "model/safetyBuffering/updated": {
      const notice = p as Partial<ModelSafetyBufferingUpdatedNotification>;
      if (typeof notice.showBufferingUi !== "boolean") return [];
      const id = text(notice.model) ?? "response";
      if (!notice.showBufferingUi && !snapshots.has(`${turnId}:buffering:${id}`)) return [];
      return publish("buffering", id, notice.showBufferingUi ? "start" : "complete", notice.showBufferingUi ? "waiting" : "cleared",
        notice.showBufferingUi ? "Codex is checking the response before releasing it. This may take longer than usual." : "Codex finished waiting to release the response.", "info",
        { model: notice.model, fasterModel: notice.fasterModel, reasons: notice.reasons, useCases: notice.useCases });
    }
    case "model/verification": {
      const notice = p as Partial<ModelVerificationNotification>;
      if (!Array.isArray(notice.verifications)) return [];
      const verifications = notice.verifications.filter((value) => typeof value === "string");
      const required = verifications.length > 0;
      if (!required && !snapshots.has(`${turnId}:verification:account`)) return [];
      return publish("verification", "account", required ? "start" : "complete", required ? "required" : "cleared",
        required ? "This model requires additional account verification. Complete verification in Codex, then retry."
          : "Codex cleared the account verification request.", required ? "warn" : "info", { verifications });
    }
    case "item/autoApprovalReview/started":
    case "item/autoApprovalReview/completed": {
      const notice = p as Partial<ItemGuardianApprovalReviewCompletedNotification>;
      const reviewId = text(notice.reviewId);
      if (!reviewId) return [];
      const review = notice.review;
      const started = method.endsWith("/started");
      const status = started ? "inProgress" : review?.status === "inProgress" ? "unknown" : review?.status ?? "unknown";
      const messages: Record<string, string> = {
        inProgress: "Codex is reviewing whether this action can run.",
        approved: "The automatic safety review approved this action.",
        denied: "The automatic safety review denied this action.",
        timedOut: "The automatic safety review timed out.",
        aborted: "The automatic safety review was canceled.",
        unknown: "The automatic safety review ended without a decision.",
      };
      const rationale = text(review?.rationale);
      return publish("review", reviewId, started ? "start" : "complete", status,
        `${messages[status] ?? messages.unknown}${!started && rationale ? ` ${rationale}` : ""}`,
        status === "denied" || status === "timedOut" || status === "unknown" ? "warn" : "info",
        { reviewId, targetItemId: notice.targetItemId, riskLevel: review?.riskLevel,
          userAuthorization: review?.userAuthorization, rationale, decisionSource: notice.decisionSource });
    }
    case "autoApprovalReview/strictReviewRequired":
      return publish("strictReview", "required", "complete", "required",
        "Codex requires a stricter safety review before this action can continue.", "warn");
    case "hook/started":
    case "hook/completed": {
      const notice = p as Partial<HookCompletedNotification>;
      const run = notice.run;
      if (!run || !text(run.id)) return [];
      const labels: Record<string, string> = {
        preToolUse: "Before tool use", postToolUse: "After tool use", permissionRequest: "Permission request",
        preModelRequest: "Before model request", postModelRequest: "After model request",
        preCompact: "Before compaction", postCompact: "After compaction", sessionStart: "Session start",
        sessionEnd: "Session end", userPromptSubmit: "Prompt submission", subagentStart: "Subagent start",
        subagentStop: "Subagent stop", stop: "Stop", interrupt: "Interrupt",
      };
      const started = method === "hook/started";
      const status = started ? "running" : run.status === "running" ? "unknown" : run.status;
      const label = `${labels[run.eventName] ?? "Lifecycle"} hook`;
      const result: Record<string, string> = { running: "is running", completed: "completed", failed: "failed", blocked: "blocked the action", stopped: "was stopped" };
      return publish("hook", run.id, started ? "start" : "complete", status,
        `${label} ${result[status] ?? "ended without a result"}.${text(run.statusMessage) ? ` ${text(run.statusMessage)}` : ""}`,
        status === "failed" || status === "blocked" ? "warn" : "info", { hookId: run.id, eventName: run.eventName, statusMessage: run.statusMessage });
    }
    case "guardianWarning":
    case "warning":
    case "configWarning":
    case "deprecationNotice": {
      const message = text(p.message ?? p.summary);
      if (!message) return [];
      return publish("warning", `${method}:${message}`, "complete", "warning", message, "warn", { details: p.details });
    }
    case "turn/completed":
    case "error":
    case "thread/closed": {
      if (method === "error" && p.willRetry === true) return [];
      const events: WorkRunLogEvent[] = [];
      for (const [statusId, snapshot] of snapshots) {
        const meta = snapshot.event.metadata!;
        if (meta.phase !== "start" || method !== "thread/closed" && meta.providerTurnId !== turnId) continue;
        const messages: Record<string, string> = {
          buffering: "The turn ended while Codex was preparing the response.",
          verification: "The turn ended while account verification was still required.",
          review: "The safety review ended without a final decision.",
          hook: "The hook ended without a completion result.",
        };
        const kind = String(meta.kind);
        const event: WorkRunLogEvent = { ...snapshot.event, ts, level: kind === "buffering" ? "info" : "warn",
          message: messages[kind] ?? "The pending operation ended without a result.",
          metadata: { ...meta, phase: "complete", status: "interrupted" } };
        snapshots.set(statusId, { signature: JSON.stringify([event.message, event.level, event.metadata]), event });
        events.push(event);
      }
      return events;
    }
    default:
      return undefined;
  }
}
