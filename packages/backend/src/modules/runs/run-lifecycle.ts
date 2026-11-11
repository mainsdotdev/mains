import type { StopReason, WorkRunEvent, WorkRunUsage } from "../../../shared/adapter.types";
import type { RunStatus } from "@mains/contracts/runs";
import { RUN_INPUT_ERRORS } from "@mains/contracts/run-input";

export type RunSessionPhase = "active" | "aborting" | "finalizing" | "closed";

export interface RunSessionResult {
  status: "succeeded" | "failed" | "canceled";
  summary?: string;
  stopReason?: StopReason | null;
  usage?: WorkRunUsage;
}

const startingResponses = new Set<string>();

export function startingRunResponseIds(): IterableIterator<string> { return startingResponses.values(); }

export function isRunResponseStarting(runId: string): boolean {
  return startingResponses.has(runId);
}

/** Synchronous claim covers preparation before a RunSession can be registered. */
export function claimRunResponse(runId: string): () => void {
  if (startingResponses.has(runId)) throw new Error(RUN_INPUT_ERRORS.responseStarting);
  startingResponses.add(runId);
  return () => { startingResponses.delete(runId); };
}

export function assertRunCanContinue(
  run: { status: RunStatus; isArchived?: boolean },
  sessionPhase: RunSessionPhase | undefined,
  voiceActive: boolean,
): void {
  if (voiceActive) throw new Error(RUN_INPUT_ERRORS.voiceActive);
  if (run.isArchived) throw new Error(RUN_INPUT_ERRORS.archived);
  if (sessionPhase && sessionPhase !== "closed" || run.status === "running" || run.status === "queued") {
    throw new Error(RUN_INPUT_ERRORS.responseActive);
  }
}

export function canSteerRun(status: RunStatus, sessionPhase: RunSessionPhase | undefined): boolean {
  return status === "running" && sessionPhase === "active";
}

/** Session ownership outlives the run row's terminal status until cleanup closes it. */
export function createRunSessionLifecycle() {
  let phase: RunSessionPhase = "active";
  return {
    get phase() { return phase; },
    get acceptsEvents() { return phase === "active"; },
    accepts(event: WorkRunEvent): boolean {
      if (phase === "active") return true;
      // An input already accepted by the native provider must retain its
      // receipt during Stop, even though subsequent output is discarded.
      return phase === "aborting" && event.type === "artifact" && event.kind === "user-prompt" &&
        !event.ephemeral && event.metadata?.isFromSubagent !== true &&
        typeof event.metadata?.clientUserMessageId === "string" && event.metadata.clientUserMessageId.length > 0;
    },
    abort(): boolean {
      if (phase !== "active") return false;
      phase = "aborting";
      return true;
    },
    finalize(result: RunSessionResult): RunSessionResult | null {
      if (phase === "finalizing" || phase === "closed") return null;
      const settled = phase === "aborting" ? { ...result, status: "canceled" as const } : result;
      phase = "finalizing";
      return settled;
    },
    close(): void {
      if (phase === "finalizing") phase = "closed";
    },
  };
}
