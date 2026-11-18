import { useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { Assistant, AssistantAvatar as Avatar } from "@mains/contracts/assistants";
import { Button } from "@/components/ui";
import { ChevronLeft, Close } from "@/components/ui/icons";
import { InvertedCorner } from "@/features/workspace/components/base-tab";
import { useSetMainHeader } from "@/hooks/use-main-header";
import { cn } from "@/lib/cn";
import { AssistantAvatar } from "./assistant-avatar";
import type { AssistantAvatarState } from "../lib/assistant-avatar-activity";

const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;

function AssistantHeaderTab({ children, chatColumnRef, className = "max-w-[50%]" }: {
  children: ReactNode;
  chatColumnRef?: RefObject<HTMLDivElement | null>;
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const track = trackRef.current;
    const chatColumn = chatColumnRef?.current;
    if (!track || !chatColumn) return;
    const syncWidth = () => {
      const width = chatColumn.getBoundingClientRect().width;
      track.style.width = width > 0 ? `${width}px` : "";
    };
    // Track the laid-out column on every frame of the panel transition and drag.
    syncWidth();
    const observer = new ResizeObserver(syncWidth);
    observer.observe(chatColumn, { box: "border-box" });
    return () => {
      observer.disconnect();
      track.style.width = "";
    };
  }, [chatColumnRef]);
  return <div ref={trackRef} data-assistant-header-track="" className="pointer-events-none absolute inset-y-0 left-0 flex w-full min-w-0 items-end justify-center">
    <div className={cn("relative flex h-full min-w-0 rounded-t-2xl bg-primary dark:bg-primary-950", className)}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden rounded-t-2xl dark:block"
        style={{ boxShadow: "inset 0 1px 0 color-mix(in srgb, var(--color-primary) 20%, transparent)" }} />
      <InvertedCorner side="left" visible />
      <InvertedCorner side="right" visible />
      {children}
    </div>
  </div>;
}

export function AssistantProfileHeader({ assistant, chatColumnRef, isPanelOpen, working = false, avatarState, pending = false, onOpenDetails }: {
  assistant?: Assistant; isPanelOpen: boolean; working?: boolean; avatarState?: AssistantAvatarState; pending?: boolean; onOpenDetails(): void;
  chatColumnRef: RefObject<HTMLDivElement | null>;
}) {
  const header = useMemo(() => assistant ? (
    <AssistantHeaderTab chatColumnRef={chatColumnRef}>
      {/* Balance the avatar's transparent left edge while keeping the tab width fixed. */}
      <Button id="assistant-profile-trigger" variant="bare" aria-label={`${assistant.name} profile`} aria-expanded={isPanelOpen} aria-controls="assistant-info-panel" onClick={onOpenDetails}
        aria-description={avatarState === "waiting" ? "Waiting for your input" : undefined}
        onKeyDown={event => { if (event.key === "Escape" && isPanelOpen) { event.preventDefault(); onOpenDetails(); } }}
        className="group/profile pointer-events-auto relative flex h-full min-w-0 items-center rounded-t-2xl py-2 pl-5.5 pr-6.5 text-primary-900 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent dark:text-primary-100"
        style={noDrag}>
        <span className="flex min-w-0 items-center gap-2 transition-transform duration-200 ease-out motion-safe:group-hover/profile:-translate-x-1.5 motion-safe:group-focus-visible/profile:-translate-x-1.5 motion-safe:group-aria-expanded/profile:-translate-x-1.5 motion-reduce:transition-none">
          <AssistantAvatar avatar={assistant.avatar} working={working} robotState={avatarState} animateRobotState seed={assistant.id} className="size-6" />
          <span className="truncate text-sm font-medium">{assistant.name}</span>
        </span>
        <span aria-hidden="true" className="pointer-events-none absolute right-3 flex motion-safe:-translate-x-1 items-center opacity-0 transition-[translate,opacity] duration-200 ease-out motion-safe:group-hover/profile:translate-x-1 group-hover/profile:opacity-100 motion-safe:group-focus-visible/profile:translate-x-1 group-focus-visible/profile:opacity-100 motion-safe:group-aria-expanded/profile:translate-x-1 group-aria-expanded/profile:opacity-100 motion-reduce:transition-none"><ChevronLeft className="size-4 rotate-180 text-primary-500" /></span>
      </Button>
    </AssistantHeaderTab>
  ) : null, [assistant, chatColumnRef, isPanelOpen, working, avatarState, onOpenDetails]);
  useSetMainHeader(header, false, pending);
  return null;
}

export function AssistantCreationHeader({ name, avatar, onClose }: { name: string; avatar: Avatar; onClose(): void }) {
  const title = name.trim() || "New mate";
  const header = useMemo(() => (
    <AssistantHeaderTab className="max-w-[65%] sm:max-w-[50%]">
      <div className="group/creation pointer-events-auto relative flex h-full min-w-0 items-center rounded-t-2xl py-2 pr-9 pl-7 text-primary-900 dark:text-primary-100" style={noDrag}>
        <div className="flex min-w-0 items-center gap-2 transition-transform duration-200 ease-out motion-safe:group-hover/creation:-translate-x-1.5 motion-safe:group-focus-within/creation:-translate-x-1.5 motion-reduce:transition-none">
          <AssistantAvatar avatar={avatar} seed="creation-preview" className="size-6" />
          <h1 className="truncate text-sm font-medium">{title}</h1>
        </div>
        <Button variant="bare" aria-label="Close new mate" onClick={onClose}
          className={cn(
            "pointer-events-none absolute right-2 flex size-6 items-center justify-center rounded-lg text-primary-500 opacity-0",
            "hover:bg-primary-300/20 hover:text-primary-900 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent dark:hover:bg-primary/10 dark:hover:text-primary-100",
            "group-hover/creation:pointer-events-auto group-hover/creation:opacity-100 group-focus-within/creation:pointer-events-auto group-focus-within/creation:opacity-100",
            "transition-[translate,opacity,background-color] duration-200 ease-out motion-safe:-translate-x-1 motion-safe:group-hover/creation:translate-x-0 motion-safe:group-focus-within/creation:translate-x-0 motion-reduce:transition-none",
            "[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:translate-x-0",
          )}>
          <Close className="size-3.5" />
        </Button>
      </div>
    </AssistantHeaderTab>
  ), [avatar, onClose, title]);
  useSetMainHeader(header);
  return null;
}
