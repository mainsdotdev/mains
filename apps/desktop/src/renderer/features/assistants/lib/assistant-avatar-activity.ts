import type { RunStatus } from "@mains/contracts/runs";

export type AssistantAvatarState = "idle" | "queued" | "thinking" | "replying" | "waiting" | "done" | "failed";

export function isAvatarWorking(state: AssistantAvatarState): boolean {
  return state === "queued" || state === "thinking" || state === "replying";
}

export function conversationAvatarState({ status, awaitingInput, streamingReply, observedRun }: {
  status: RunStatus;
  awaitingInput: boolean;
  streamingReply: boolean;
  observedRun: boolean;
}): AssistantAvatarState {
  if (awaitingInput) return "waiting";
  if (status === "queued") return "queued";
  if (status === "running") return streamingReply ? "replying" : "thinking";
  // Opening a finished conversation does not repeat its completion gesture.
  if (observedRun && status === "succeeded") return "done";
  if (observedRun && status === "failed") return "failed";
  return "idle";
}
