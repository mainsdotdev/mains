import { useGetRunByIdQuery } from "@/lib/redux/api";
import { useJumpToRun } from "../hooks/use-jump-to-run";
import { useRealtimeVoice } from "../hooks/use-realtime-voice";
import { RealtimeVoiceBar } from "./realtime-voice-bar";

/** Navigation changes only the call's presentation, never its media owner. */
export function RealtimeVoiceDock() {
  const { state } = useRealtimeVoice();
  const { currentData: run } = useGetRunByIdQuery(state.runId ?? "", {
    skip: state.phase === "idle" || !state.runId,
  });
  const jumpToRun = useJumpToRun();

  return <RealtimeVoiceBar compact chatTitle={run?.title || "Voice chat"}
    openChatDisabled={!run || run.isArchived}
    onOpenChat={() => { if (run && !run.isArchived) void jumpToRun(run); }} />;
}
