import { describe, expect, it, vi } from "vitest";
import { hasComposerMessage } from "./composer-message";
import { composerControls, stopComposerActivity } from "./composer-controls";

const draft = {
  state: { phase: "idle" as const, runId: null, muted: false },
  runId: undefined, isNewRun: true, hasMessage: false, preparing: false, startDisabled: false,
  isRunning: false, canSendDuringRun: false, voiceEnabled: true, sendDisabled: false,
};

describe("single composer action", () => {
  it.each([["new", true, undefined], ["existing", false, "existing"]] as const)("uses the primary microphone for an empty %s chat, including whitespace", (_kind, isNewRun, runId) => {
    const empty = composerControls({ ...draft, isNewRun, runId, sendDisabled: true, hasMessage: hasComposerMessage("  ", 0, []) });
    expect(empty).toMatchObject({ primary: { kind: "voice", disabled: false, label: "Start voice chat" }, voiceActive: false });
    for (const hasMessage of [hasComposerMessage("hello", 0, []), hasComposerMessage("", 1, [])]) {
      expect(composerControls({ ...draft, isNewRun, runId, hasMessage })).toMatchObject({ primary: { kind: "send" } });
    }
  });

  it.each(["connecting", "connected", "ending", "stop_failed", "error"] as const)("keeps the owning chat's primary voice action during %s, even with draft text", (phase) => {
    const controls = composerControls({ ...draft, isNewRun: false, runId: "voice", hasMessage: true, canSendDuringRun: true,
      state: { phase, runId: "voice", muted: true } });
    expect(controls.primary.kind).toBe("stop");
    expect(controls.voiceActive).toBe(true);
    expect(controls.primary.disabled).toBe(phase === "ending");
    expect(controls.mute).toEqual(phase === "error" || phase === "stop_failed" ? undefined
      : { muted: true, disabled: phase !== "connected" });
    expect(controls.primary.label).toBe(phase === "stop_failed" ? "Retry ending voice chat"
      : phase === "error" ? "Dismiss voice error" : "End voice chat");
  });

  it("leaves another chat's Send usable and blocks a second microphone while a call is open", () => {
    const state = { phase: "connected" as const, runId: "voice", muted: false };
    expect(composerControls({ ...draft, state, isNewRun: false, runId: "worker", hasMessage: true }))
      .toMatchObject({ primary: { kind: "send", disabled: false }, voiceActive: false, mute: undefined });
    expect(composerControls({ ...draft, state, runId: "voice" }))
      .toMatchObject({ primary: { kind: "voice", disabled: true }, voiceActive: false, mute: undefined });
  });

  it("retains the microphone action while the newly created run becomes selected", () => {
    expect(composerControls({ ...draft, preparing: true, isNewRun: false, runId: "new-voice" }))
      .toMatchObject({ primary: { kind: "voice", disabled: true, label: "Starting voice chat" }, voiceActive: false });
  });

  it("preserves start availability for existing idle chats and respects readiness", () => {
    expect(composerControls({ ...draft, isNewRun: false, runId: "existing" }))
      .toMatchObject({ primary: { kind: "voice", disabled: false } });
    expect(composerControls({ ...draft, startDisabled: true }).primary.disabled).toBe(true);
  });

  it.each([false, true])("keeps a running turn's Stop with hasMessage=%s when its composer cannot queue messages", (hasMessage) => {
    expect(composerControls({ ...draft, isNewRun: false, runId: "work", isRunning: true,
      hasMessage, sendLabel: "Save queued message", startDisabled: true, sendDisabled: true }))
      .toMatchObject({ primary: { kind: "stop", label: "Stop run", disabled: false }, mute: undefined });
  });

  it.each([false, true])("uses Send for a running turn's queued draft and respects sendDisabled=%s", (sendDisabled) => {
    expect(composerControls({ ...draft, isNewRun: false, runId: "work", isRunning: true,
      canSendDuringRun: true, hasMessage: true, sendLabel: "Queue message", sendDisabled }))
      .toMatchObject({ primary: { kind: "send", label: "Queue message", disabled: sendDisabled }, mute: undefined });
  });

  it.each(["Save queued message", "Steer active turn"])("preserves the running draft action: %s", (sendLabel) => {
    expect(composerControls({ ...draft, isNewRun: false, runId: "work", isRunning: true,
      canSendDuringRun: true, hasMessage: true, sendLabel }))
      .toMatchObject({ primary: { kind: "send", label: sendLabel, disabled: false } });
  });

  it("returns to Stop for an empty running draft even when queuing is supported", () => {
    expect(composerControls({ ...draft, isNewRun: false, runId: "work", isRunning: true,
      canSendDuringRun: true, hasMessage: hasComposerMessage("  ", 0, []) }))
      .toMatchObject({ primary: { kind: "stop", label: "Stop run", disabled: false } });
  });

  it.each(["connected", "ending", "stop_failed"] as const)("keeps the combined Stop enabled while voice is %s and work is running", (phase) => {
    expect(composerControls({ ...draft, isNewRun: false, runId: "voice", isRunning: true, canSendDuringRun: true,
      state: { phase, runId: "voice", muted: false }, hasMessage: true, sendDisabled: true }))
      .toMatchObject({ primary: { kind: "stop", disabled: false, label: "Stop voice chat and run" }, voiceActive: true });
  });

  it("does not make a new draft stop the previously selected chat's work or call", () => {
    expect(composerControls({ ...draft, runId: "previous", isRunning: true,
      state: { phase: "connected", runId: "previous", muted: false } }))
      .toMatchObject({ primary: { kind: "voice", disabled: true }, voiceActive: false, mute: undefined });
  });

  it("keeps Send for clients without native voice and respects send readiness", () => {
    expect(composerControls({ ...draft, voiceEnabled: false, sendDisabled: true }))
      .toMatchObject({ primary: { kind: "send", disabled: true, label: "Send prompt" }, mute: undefined });
  });
});

describe("combined composer Stop", () => {
  it("starts both cancellations immediately while native voice closure is still pending", async () => {
    let closeVoice!: () => void;
    const stopVoice = vi.fn(() => new Promise<void>((resolve) => { closeVoice = resolve; }));
    const stopRun = vi.fn();
    const stopping = stopComposerActivity({ stopVoice, stopRun });
    expect(stopVoice).toHaveBeenCalledOnce();
    expect(stopRun).toHaveBeenCalledOnce();
    closeVoice();
    await stopping;
  });

  it.each(["voice", "run"] as const)("stops %s alone when only that activity belongs to the composer", async (activity) => {
    const stop = vi.fn();
    await stopComposerActivity(activity === "voice" ? { stopVoice: stop } : { stopRun: stop });
    expect(stop).toHaveBeenCalledOnce();
  });

  it.each(["voice", "run"] as const)("still cancels the other activity if %s throws", async (activity) => {
    const error = new Error("Stop failed");
    const failing = vi.fn(() => { throw error; });
    const other = vi.fn();
    await expect(stopComposerActivity(activity === "voice"
      ? { stopVoice: failing, stopRun: other }
      : { stopVoice: other, stopRun: failing })).rejects.toBe(error);
    expect(other).toHaveBeenCalledOnce();
  });
});
