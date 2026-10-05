import { useId, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence, LazyMotion, domAnimation, m, useIsPresent } from "motion/react";
import { Button, DropdownMenu, DropdownMenuItem, Text } from "@/components/ui";
import { Close, MicrophoneToggle, OpenWith } from "@/components/ui/icons";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { cn } from "@/lib/cn";
import { useGetProviderByIdQuery } from "@/lib/redux/api";
import { PROVIDER_IDS } from "@mains/contracts/provider-ids";
import type { CodexAdapterConfig } from "../../../../shared/adapter.types";
import { useRealtimeVoice } from "../hooks/use-realtime-voice";
import { useIsVoiceChatVisible } from "../hooks/use-voice-chat-presence";
import { voiceOrbColorStyle } from "../lib/voice-orb-colors";
import { VoiceOrb } from "./voice-orb";

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
  const voice = useRealtimeVoice();
  const { state } = voice;
  const chatVisible = useIsVoiceChatVisible(state.runId);
  const { data: provider } = useGetProviderByIdQuery(PROVIDER_IDS.codex, { skip: state.phase === "idle" });
  const config = provider?.config as CodexAdapterConfig | undefined;
  // Route changes move the call immediately; only closure retains an exit visual.
  if (state.phase !== "idle" && (props.compact ? chatVisible : !chatVisible || props.runId !== state.runId)) return null;
  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence initial={false}>
        {state.phase !== "idle" && <RealtimeVoicePresentation key="voice" props={props} voice={voice} config={config} />}
      </AnimatePresence>
    </LazyMotion>
  );
}

function RealtimeVoicePresentation({ props, voice, config }: {
  props: RealtimeVoiceBarProps;
  voice: ReturnType<typeof useRealtimeVoice>;
  config: CodexAdapterConfig | undefined;
}) {
  const { state, getAudioLevels } = voice;
  const isPresent = useIsPresent();
  const reducedMotion = usePrefersReducedMotion();
  const connecting = state.phase === "connecting";
  const closing = !isPresent || state.phase === "ending";
  const connected = state.phase === "connected";
  const exitTransition = { duration: reducedMotion ? 0.075 : 0.28, ease: "easeIn" as const };
  const orb = (
    <span aria-hidden="true" data-connecting={connecting} data-closing={closing} style={voiceOrbColorStyle(config?.voiceOrbColor)}
      className={cn("voice-orb-connection relative block size-24 shrink-0 sm:size-40", props.compact && "size-8 sm:size-8")}>
      <span className="voice-orb-reveal block size-full">
        <VoiceOrb active={connected} getAudioLevels={getAudioLevels}
          color={config?.voiceOrbColor} orbStyle={config?.voiceOrbStyle}
          className={props.compact ? "size-8 shrink-0 sm:size-8" : undefined} />
      </span>
      <span className="voice-orb-loading pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className={cn("voice-orb-dot size-3 rounded-full sm:size-4", props.compact && "size-2 sm:size-2")} />
      </span>
    </span>
  );

  if (props.compact) {
    return (
      <m.div role="region" aria-label="Voice chat controls" aria-busy={connecting}
        inert={!isPresent} aria-hidden={!isPresent || undefined}
        initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={exitTransition}
        className="flex shrink-0 flex-col items-center gap-2 pb-1">
        <VoiceDockMenu options={props} voice={voice} isPresent={isPresent}>{orb}</VoiceDockMenu>
        <div className="w-8 shrink-0 border-b border-primary-300/50 dark:border-primary-800" aria-hidden="true" />
      </m.div>
    );
  }
  return (
    <m.div role="region" aria-label="Voice chat controls" aria-busy={connecting} data-voice-orb-overlay=""
      inert={!isPresent} aria-hidden={!isPresent || undefined}
      initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={exitTransition}
      className="pointer-events-none absolute inset-x-0 bottom-3 z-(--z-base) mx-auto w-full min-w-0 max-w-210 px-4">
      <div className="flex min-w-0 justify-center">
        {orb}
      </div>
    </m.div>
  );
}

function VoiceDockMenu({ options, voice, isPresent, children }: {
  options: Extract<RealtimeVoiceBarProps, { compact: true }>;
  voice: ReturnType<typeof useRealtimeVoice>;
  isPresent: boolean;
  children: ReactNode;
}) {
  const { state, stop, toggleMute } = voice;
  const location = useLocation();
  const triggerId = useId();
  const [menu, setMenu] = useState<{
    locationKey: string;
    connectionId: string | null;
    position: { x: number; y: number; anchorTop: number };
  } | null>(null);
  // Portaled controls must close immediately when the route or call changes.
  const isOpen = isPresent && menu !== null && menu.locationKey === location.key && menu.connectionId === state.connectionId;
  const muteLabel = state.muted ? "Unmute microphone" : "Mute microphone";
  const endLabel = state.phase === "stop_failed" ? "Retry ending voice chat" : state.phase === "error" ? "Dismiss voice error" : "End voice chat";

  return <>
    <Button id={triggerId} type="button" variant="bare"
      aria-label="Open voice chat controls" aria-haspopup="menu" aria-expanded={isOpen}
      tooltip={options.chatTitle} tooltipPosition="right" disabled={!isPresent}
      className="flex size-8 shrink-0 items-center justify-center rounded-full"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setMenu(isOpen ? null : { locationKey: location.key, connectionId: state.connectionId,
          position: { x: rect.right + 8, y: rect.top, anchorTop: rect.top } });
      }}>
      {children}
    </Button>
    <DropdownMenu isOpen={isOpen} aria-label="Voice chat options" position={menu?.position ?? { x: 0, y: 0 }}
      onClose={() => setMenu(null)} minWidth={224} className="w-56 max-w-[calc(100vw-1rem)]">
      <Text as="div" size="xs" tone="muted" className="truncate px-2 py-1.5" title={options.chatTitle}>{options.chatTitle}</Text>
      <DropdownMenuItem disabled={options.openChatDisabled || !isPresent} onClick={() => {
        setMenu(null);
        options.onOpenChat();
      }}>
        <OpenWith className="size-4" aria-hidden="true" />Return to voice chat
      </DropdownMenuItem>
      {state.phase !== "error" && state.phase !== "stop_failed" && <Button type="button" variant="bare"
        role="menuitemcheckbox" tabIndex={-1} aria-label={muteLabel} aria-checked={state.muted}
        disabled={state.phase !== "connected" || !isPresent} onClick={toggleMute}
        className="flex w-full items-center gap-3 rounded-[10px] px-2 py-1.5 text-s text-primary-700 hover:bg-primary-200/40 dark:text-primary-300 dark:hover:bg-primary/5">
        <MicrophoneToggle muted={state.muted} className="size-4" aria-hidden="true" />{muteLabel}
      </Button>}
      <DropdownMenuItem variant="danger" disabled={state.phase === "ending" || !isPresent} onClick={() => {
        setMenu(null);
        void stop();
      }}>
        <Close className="size-4" aria-hidden="true" />{endLabel}
      </DropdownMenuItem>
    </DropdownMenu>
  </>;
}
