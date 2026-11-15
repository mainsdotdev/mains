import type { CSSProperties } from "react";
import type { Assistant } from "@mains/contracts/assistants";
import { Button } from "@/components/ui";
import { ChevronLeft } from "@/components/ui/icons";
import { InvertedCorner } from "@/features/workspace/components/base-tab";
import { AssistantAvatar } from "./assistant-avatar";

export function AssistantProfileHeader({ assistant, isPanelOpen, onOpenDetails }: { assistant: Assistant; isPanelOpen: boolean; onOpenDetails(): void }) {
  return <div className="pointer-events-none absolute inset-0 flex min-w-0 items-end justify-center">
    <div className="relative flex h-full min-w-0 max-w-[50%] rounded-t-2xl bg-primary dark:bg-primary-950">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden rounded-t-2xl dark:block"
        style={{ boxShadow: "inset 0 1px 0 color-mix(in srgb, var(--color-primary) 20%, transparent)" }} />
      <InvertedCorner side="left" visible />
      <InvertedCorner side="right" visible />
      <Button id="assistant-profile-trigger" variant="bare" aria-label={`${assistant.name} profile`} aria-expanded={isPanelOpen} aria-controls="assistant-info-panel" onClick={onOpenDetails}
        onKeyDown={event => { if (event.key === "Escape" && isPanelOpen) { event.preventDefault(); onOpenDetails(); } }}
        className="group/profile pointer-events-auto relative flex h-full min-w-0 items-center rounded-t-2xl px-6 py-2 text-primary-900 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent dark:text-primary-100"
        style={{ WebkitAppRegion: "no-drag" } as CSSProperties}>
        <span className="flex min-w-0 items-center gap-2 transition-transform duration-200 ease-out motion-safe:group-hover/profile:-translate-x-1.5 motion-safe:group-focus-visible/profile:-translate-x-1.5 motion-safe:group-aria-expanded/profile:-translate-x-1.5 motion-reduce:transition-none">
          <AssistantAvatar avatar={assistant.avatar} className="size-6" />
          <span className="truncate text-sm font-medium">{assistant.name}</span>
        </span>
        <span aria-hidden="true" className="pointer-events-none absolute right-3 flex motion-safe:-translate-x-1 items-center opacity-0 transition-[translate,opacity] duration-200 ease-out motion-safe:group-hover/profile:translate-x-1 group-hover/profile:opacity-100 motion-safe:group-focus-visible/profile:translate-x-1 group-focus-visible/profile:opacity-100 motion-safe:group-aria-expanded/profile:translate-x-1 group-aria-expanded/profile:opacity-100 motion-reduce:transition-none"><ChevronLeft className="size-4 rotate-180 text-primary-500" /></span>
      </Button>
    </div>
  </div>;
}
