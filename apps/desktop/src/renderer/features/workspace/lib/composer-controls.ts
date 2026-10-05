import type { RealtimeVoiceState } from "./realtime-voice-controller";

export interface ComposerPrimaryAction {
  kind: "voice" | "send" | "stop";
  label: string;
  disabled: boolean;
}

/** Resolve the single primary button: Stop takes priority over draft content. */
export function composerControls({ state, runId, isNewRun, isRunning, voiceEnabled, hasMessage, preparing, startDisabled, sendDisabled, sendLabel = "Send prompt" }: {
  state: Pick<RealtimeVoiceState, "phase" | "runId" | "muted">;
  runId: string | undefined;
  isNewRun: boolean;
  isRunning: boolean;
  voiceEnabled: boolean;
  hasMessage: boolean;
  preparing: boolean;
  startDisabled: boolean;
  sendDisabled: boolean;
  sendLabel?: string;
}) {
  const voiceActive = voiceEnabled && !isNewRun && !!runId && state.runId === runId && state.phase !== "idle";
  const running = !isNewRun && isRunning;
  const busy = state.phase !== "idle" && state.phase !== "error";
  let primary: ComposerPrimaryAction;
  if (running || voiceActive) {
    primary = {
      kind: "stop",
      label: running ? voiceActive ? "Stop voice chat and run" : "Stop run"
        : state.phase === "stop_failed" ? "Retry ending voice chat"
        : state.phase === "error" ? "Dismiss voice error" : "End voice chat",
      // A pending voice close must not disable stopping the work turn.
      disabled: !running && state.phase === "ending",
    };
  } else if (voiceEnabled && !hasMessage) {
    primary = { kind: "voice", disabled: busy || preparing || startDisabled,
      label: preparing ? "Starting voice chat" : "Start voice chat" };
  } else {
    primary = { kind: "send", disabled: sendDisabled, label: sendLabel };
  }
  return {
    primary,
    voiceActive,
    mute: voiceActive && state.phase !== "error" && state.phase !== "stop_failed"
      ? { muted: state.muted, disabled: state.phase !== "connected" } : undefined,
  };
}

/** Close media and stop work independently; neither waits for the other's RPC. */
export async function stopComposerActivity({ stopVoice, stopRun }: {
  stopVoice?: () => void | Promise<void>;
  stopRun?: () => void | Promise<void>;
}): Promise<void> {
  const actions = [stopVoice, stopRun].filter((action) => action !== undefined);
  const results = await Promise.allSettled(actions.map(async (action) => action()));
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}
