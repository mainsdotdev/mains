import { useLayoutEffect, useRef } from "react";
import type { Assistant, AssistantOverview } from "@mains/contracts/assistants";
import { Button, SegmentedTabs } from "@/components/ui";
import { Close } from "@/components/ui/icons";
import { AgentMarkdown } from "@/components/agent-markdown";
import { usePanelAnimation } from "@/hooks/use-panel-animation";
import { AssistantAvatar } from "./assistant-avatar";
import { AssistantMemoryPanel } from "./assistant-memory";
import { AssistantAssignments } from "./assistant-assignments";
import { isAssistantWorking } from "../lib/assistant-ui";

export function AssistantInfoPanel({ assistant, overview, isOpen, tab, onTabChange, onClose, onToggleArchive, archiving, error, openAssistant }: {
  assistant: Assistant;
  overview: AssistantOverview;
  isOpen: boolean;
  tab: "profile" | "memory" | "tasks";
  onTabChange(tab: "profile" | "memory" | "tasks"): void;
  onClose(): void;
  onToggleArchive(): void;
  archiving: boolean;
  error: string;
  openAssistant(id: string, runId?: string | null): void;
}) {
  const { isVisible, isAnimatedIn } = usePanelAnimation(isOpen);
  const closeRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { if (isOpen && isVisible) closeRef.current?.focus({ preventScroll: true }); }, [isOpen, isVisible]);
  const tasks = overview.assignments.filter(task => task.teamId === assistant.teamId);
  const activeTasks = tasks.filter(task => !["completed", "failed", "canceled"].includes(task.status)).length;
  if (!isVisible) return null;
  // Size the canvas against the route, so clipping the opening panel never reflows its text.
  return <div className="absolute inset-y-0 right-0 z-(--z-panel) shrink-0 overflow-hidden transition-[width] duration-150 ease-out [--assistant-info-width:min(26rem,100cqw)] motion-reduce:transition-none md:relative md:inset-auto md:[--assistant-info-width:min(26rem,65cqw)]"
    style={{ width: isAnimatedIn ? "var(--assistant-info-width)" : "0px" }}>
    <aside id="assistant-info-panel" aria-label={`About ${assistant.name}`} aria-hidden={!isOpen || undefined} inert={!isOpen}
      onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); onClose(); } }}
      className={`flex h-full w-(--assistant-info-width) min-w-0 flex-col overflow-hidden border-l border-primary-200/70 bg-primary text-primary-900 transition-[translate,opacity] duration-150 ease-out motion-reduce:translate-x-0 motion-reduce:transition-none dark:border-primary-800/70 dark:bg-primary-950 dark:text-primary-100 ${isAnimatedIn ? "translate-x-0 opacity-100" : "translate-x-6 opacity-0"}`}>
      <div className={`flex h-full min-h-0 flex-col transition-[translate,opacity] ease-out motion-reduce:translate-y-0 motion-reduce:transition-none ${isAnimatedIn ? "translate-y-0 opacity-100 duration-200 delay-75" : "translate-y-3 opacity-0 duration-100 delay-0"}`}>
      <div className="flex shrink-0 items-start gap-3 px-5 pb-4 pt-5">
        <AssistantAvatar avatar={assistant.avatar} working={isAssistantWorking(overview, assistant.id)} seed={assistant.id} className="size-10" />
        <div className="min-w-0 flex-1"><h2 className="truncate text-base font-medium text-primary-950 dark:text-primary-50">{assistant.name}</h2>{assistant.description && <p className="mt-1 text-xs leading-relaxed text-primary-600 dark:text-primary-400">{assistant.description}</p>}</div>
        <Button ref={closeRef} variant="icon" aria-label="Close assistant panel" tooltip="Close assistant panel" onClick={onClose}><Close className="size-4" /></Button>
      </div>
      <div className="shrink-0 overflow-x-auto px-4 pb-4 noscrollbar">
        <SegmentedTabs aria-label="Assistant information" variant="plain" panelId="assistant-info-content" value={tab} onChange={onTabChange}
          options={[{ value: "profile", label: "Details" }, { value: "memory", label: "Memory" }, { value: "tasks", label: activeTasks ? `Assignments · ${activeTasks}` : "Assignments" }]} />
      </div>
      <div id="assistant-info-content" role="tabpanel" aria-label={tab === "memory" ? "Memory" : tab === "tasks" ? "Assignments" : "Details"} className="scroll-bounce min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {tab === "memory" ? <AssistantMemoryPanel key={assistant.id} assistant={assistant} memories={overview.memories} />
          : tab === "tasks" ? <AssistantAssignments assistant={assistant} assignments={tasks} assistants={overview.assistants} openAssistant={openAssistant} />
          : <div className="space-y-6 pt-2">
            <dl className="grid grid-cols-2 gap-x-5 gap-y-5 text-sm">
              {[["Team", overview.teams.find(team => team.id === assistant.teamId)?.name ?? "—"], ["Space", assistant.spaceSnapshot.name], ["Model", assistant.model], ["Effort", assistant.effort || "Default"]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-primary-600 dark:text-primary-400">{label}</dt><dd className="mt-1.5 break-words font-medium text-primary-950 dark:text-primary-50">{value}</dd></div>)}
            </dl>
            <div><h3 className="mb-2 text-sm font-medium text-primary-950 dark:text-primary-50">Instructions</h3><AgentMarkdown>{assistant.instructions}</AgentMarkdown></div>
            <p className="text-xs leading-relaxed text-primary-600 dark:text-primary-400">This assistant keeps the Space, model and effort chosen at creation.</p>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <Button variant="ghost" disabled={archiving} onClick={onToggleArchive}>{assistant.isArchived ? "Restore assistant" : "Archive assistant"}</Button>
          </div>}
      </div>
      </div>
    </aside>
  </div>;
}
