import { Button, Text } from "@/components/ui";
import { Close } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { useGetProviderByIdQuery } from "@/lib/redux/api";
import { PROVIDER_IDS } from "@mains/contracts/provider-ids";
import type { CodexAdapterConfig } from "../../../../shared/adapter.types";
import { useRealtimeVoice } from "../hooks/use-realtime-voice";
import { useIsVoiceChatVisible } from "../hooks/use-voice-chat-presence";
import { voiceOrbColorStyle } from "../lib/voice-orb-colors";
import { VoiceOrb } from "./voice-orb";
import { VoiceMuteButton } from "./voice-mute-button";

type RealtimeVoiceBarProps = {
  compact?: false;
  runId: string | null | undefined;
} | {
  compact: true;
  chatTitle: string;
  onOpenChat: () => void;
  openChatDisabled: boolean;
};

export function RealtimeVoiceBar(props: RealtimeVoiceBarProps) {
  const { state, stop, toggleMute, getAudioLevels } = useRealtimeVoice();
  const chatVisible = useIsVoiceChatVisible(state.runId);
  const { data: provider } = useGetProviderByIdQuery(PROVIDER_IDS.codex, { skip: state.phase === "idle" });
  const config = provider?.config as CodexAdapterConfig | undefined;
  if (state.phase === "idle" || (props.compact ? chatVisible : !chatVisible || props.runId !== state.runId)) return null;
  const connecting = state.phase === "connecting";
  const connected = state.phase === "connected";
  const stopFailed = state.phase === "stop_failed";
  const controls = (
    <div className="flex shrink-0 items-center gap-1">
      {state.phase !== "error" && !stopFailed && (
        <VoiceMuteButton muted={state.muted} disabled={!connected} onToggle={toggleMute} />
      )}
      <Button type="button" tooltip={stopFailed ? "Retry ending voice chat" : state.phase === "error" ? "Dismiss voice error" : "End voice chat"}
        aria-label={stopFailed ? "Retry ending voice chat" : state.phase === "error" ? "Dismiss voice error" : "End voice chat"}
        onClick={() => { void stop(); }} disabled={state.phase === "ending"}
        className="rounded-full px-2 py-1 text-xs text-primary-600 dark:text-primary-400 hover:bg-danger/10 hover:text-danger cursor-pointer">
        {stopFailed ? "Retry" : <Close className="size-3.5" />}
      </Button>
    </div>
  );
  const orb = (
    <span aria-hidden="true" data-connecting={connecting} style={voiceOrbColorStyle(config?.voiceOrbColor)}
      className={cn("voice-orb-connection relative block size-24 shrink-0 sm:size-40", props.compact && "size-10 sm:size-10")}>
      <span className="voice-orb-reveal block size-full">
        <VoiceOrb active={connected} getAudioLevels={getAudioLevels}
          color={config?.voiceOrbColor} orbStyle={config?.voiceOrbStyle}
          className={props.compact ? "size-10 shrink-0 sm:size-10" : undefined} />
      </span>
      <span className="voice-orb-loading pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className={cn("voice-orb-dot size-3 rounded-full sm:size-4", props.compact && "size-2 sm:size-2")} />
      </span>
    </span>
  );

  if (props.compact) {
    return (
      <div role="region" aria-label="Voice chat controls" aria-busy={connecting}
        className="fixed bottom-5 left-5 z-(--z-overlay) w-80 max-w-[calc(100vw-2.5rem)] rounded-2xl glass-surface p-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {orb}
          <Button type="button" onClick={props.onOpenChat} disabled={props.openChatDisabled}
            aria-label="Return to voice chat" tooltip="Return to voice chat"
            className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-lg text-left">
            <Text as="span" size="xs" weight="medium" className="w-full truncate" title={props.chatTitle}>{props.chatTitle}</Text>
          </Button>
          {controls}
        </div>
      </div>
    );
  }
  return (
    <div role="region" aria-label="Voice chat controls" aria-busy={connecting} className="relative z-(--z-base) mx-auto mb-3 w-full min-w-0 max-w-210 shrink-0 px-4 pt-2">
      <div className="flex min-w-0 justify-center">
        {orb}
      </div>
    </div>
  );
}
