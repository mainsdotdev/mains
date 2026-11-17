import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { canAccessAssistantAssignment, type Assistant, type AssistantConversation, type AssistantOverview } from "@mains/contracts/assistants";
import { Button, Label, Select, SegmentedTabs } from "@/components/ui";
import { Close } from "@/components/ui/icons";
import { AgentMarkdown } from "@/components/agent-markdown";
import { usePanelAnimation } from "@/hooks/use-panel-animation";
import { ResizeHandle } from "@/components/layout/resize-handle";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setAssistantInfoPanelWidth } from "@/lib/redux/slices/appSettingsSlice";
import { useChangeAssistantTeamMutation } from "@/lib/redux/api/assistantsApi";
import { ASSISTANT_INFO_PANEL_WIDTH_DEFAULT, ASSISTANT_INFO_PANEL_WIDTH_MIN, ASSISTANT_INFO_PANEL_WIDTH_MAX, clamp } from "@/lib/layout";
import { formatEffortLevel } from "@/lib/format";
import { formatModelDisplayName } from "@/lib/model-display";
import { getProviderVariantById } from "@/lib/provider-variants";
import { AssistantAvatar } from "./assistant-avatar";
import { AssistantMemoryPanel } from "./assistant-memory";
import { AssistantAssignments } from "./assistant-assignments";
import { AssistantChatsPanel } from "./assistant-chats-panel";
import { AssistantRoutines } from "./assistant-routines";
import { AssistantTeamEditor } from "./assistant-team-editor";
import { errorText, isAssistantWorking } from "../lib/assistant-ui";

function AssistantTeamSelect({ assistant, teams, disabled }: { assistant: Assistant; teams: AssistantOverview["teams"]; disabled: boolean }) {
  const [changeTeam, { isLoading, error }] = useChangeAssistantTeamMutation();
  const [creating, setCreating] = useState(false);
  const id = `assistant-${assistant.id}-team`;
  const options = [{ value: "", label: "No team" }, ...teams.filter(team => team.accountId === assistant.accountId).map(team => ({ value: team.id, label: team.name }))];
  const unavailable = disabled || isLoading || assistant.isArchived;
  function selectTeam(teamId: string | null) {
    if (teamId !== assistant.teamId) void changeTeam({ accountId: assistant.accountId, id: assistant.id, teamId });
  }
  return <div className="rounded-2xl glass-card px-4 py-3.5">
    <div className="flex items-center justify-between gap-3">
      <Label id={`${id}-label`} as="span" className="shrink-0" size="xs" tone="secondary">Team</Label>
      <div className="flex min-w-0 items-stretch gap-2">
        <div className="min-w-0">
          <Select id={id} aria-labelledby={`${id}-label`} size="sm" value={assistant.teamId ?? ""} disabled={unavailable || creating}
            options={options} onChange={teamId => selectTeam(teamId || null)} />
        </div>
        <Button className="inline-flex shrink-0 whitespace-nowrap" type="button" variant="primary" disabled={unavailable || creating}
          aria-expanded={creating} onClick={() => setCreating(true)}>New team</Button>
      </div>
    </div>
    {creating && <div className="mt-3"><AssistantTeamEditor accountId={assistant.accountId} onCancel={() => setCreating(false)}
      onCreated={team => { setCreating(false); selectTeam(team.id); }} /></div>}
    {isLoading && <p role="status" className="mt-3 text-xs text-primary-600 dark:text-primary-300">Changing team…</p>}
    {!!error && <p role="alert" className="mt-3 text-sm text-danger">{errorText(error)}</p>}
  </div>;
}

export function AssistantInfoPanel({ assistant, overview, chats, selectedRunId, chatsError, onSelectChat, onRetryChats, isOpen, tab, onTabChange, onClose, onToggleArchive, archiving, error, openAssistant }: {
  assistant: Assistant;
  overview: AssistantOverview;
  chats?: AssistantConversation[];
  selectedRunId: string | null;
  chatsError?: unknown;
  onSelectChat(runId: string): void;
  onRetryChats(): void;
  isOpen: boolean;
  tab: "profile" | "chats" | "memory" | "tasks" | "routines";
  onTabChange(tab: "profile" | "chats" | "memory" | "tasks" | "routines"): void;
  onClose(): void;
  onToggleArchive(): void;
  archiving: boolean;
  error: string;
  openAssistant(id: string, runId?: string | null): void;
}) {
  const { isVisible, isAnimatedIn } = usePanelAnimation(isOpen);
  const dispatch = useAppDispatch();
  const savedWidth = useAppSelector(state => state.appSettings.assistantInfoPanelWidth);
  const width = clamp(Number.isFinite(savedWidth) ? savedWidth : ASSISTANT_INFO_PANEL_WIDTH_DEFAULT, ASSISTANT_INFO_PANEL_WIDTH_MIN, ASSISTANT_INFO_PANEL_WIDTH_MAX);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { if (isOpen && isVisible) closeRef.current?.focus({ preventScroll: true }); }, [isOpen, isVisible]);
  const tasks = overview.assignments.filter(task => canAccessAssistantAssignment(assistant, task));
  const activeTasks = tasks.filter(task => !["completed", "failed", "canceled"].includes(task.status)).length;
  if (!isVisible) return null;
  // Size the canvas against the route, so clipping the opening panel never reflows its text.
  return <div ref={panelRef} data-assistant-info-panel="" className="absolute inset-y-0 right-0 z-(--z-panel) shrink-0 overflow-hidden transition-[width] duration-150 ease-out [--assistant-info-gap:0px] [--assistant-info-width:100cqw] motion-reduce:transition-none md:relative md:inset-auto md:[--assistant-info-gap:calc(var(--spacing)*1.25)] md:[--assistant-info-width:min(var(--assistant-info-preferred-width),65cqw)]"
    style={{ "--assistant-info-preferred-width": `${width}px`, width: isAnimatedIn ? "calc(var(--assistant-info-width) + var(--assistant-info-gap))" : "0px" } as CSSProperties}>
    <aside id="assistant-info-panel" aria-label={`About ${assistant.name}`} aria-hidden={!isOpen || undefined} inert={!isOpen}
      onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); onClose(); } }}
      className={`relative ms-(--assistant-info-gap) flex h-full w-(--assistant-info-width) min-w-0 flex-col overflow-hidden rounded-2xl bg-primary text-primary-900 transition-[translate,opacity] duration-150 ease-out motion-reduce:translate-x-0 motion-reduce:transition-none dark:bg-primary-950 dark:text-primary-100 ${isAnimatedIn ? "translate-x-0 opacity-100" : "translate-x-6 opacity-0"}`}>
      <ResizeHandle edge="left" value={width} min={ASSISTANT_INFO_PANEL_WIDTH_MIN} max={ASSISTANT_INFO_PANEL_WIDTH_MAX}
        computeWidth={clientX => (panelRef.current?.getBoundingClientRect().right ?? clientX + width) - clientX}
        onPreview={next => panelRef.current?.style.setProperty("--assistant-info-preferred-width", `${next}px`)}
        onCommit={next => dispatch(setAssistantInfoPanelWidth(next))}
        onReset={() => dispatch(setAssistantInfoPanelWidth(ASSISTANT_INFO_PANEL_WIDTH_DEFAULT))}
        ariaLabel="Resize assistant panel" />
      <div className={`flex h-full min-h-0 flex-col transition-[translate,opacity] ease-out motion-reduce:translate-y-0 motion-reduce:transition-none ${isAnimatedIn ? "translate-y-0 opacity-100 duration-200 delay-75" : "translate-y-3 opacity-0 duration-100 delay-0"}`}>
      <div className="flex shrink-0 items-start gap-3 px-5 pb-4 pt-5">
        <AssistantAvatar avatar={assistant.avatar} working={isAssistantWorking(overview, assistant.id)} seed={assistant.id} className="size-10" />
        <div className="min-w-0 flex-1"><h2 className="truncate text-base font-medium text-primary-950 dark:text-primary-50">{assistant.name}</h2>{assistant.description && <p className="mt-1.5 text-sm leading-relaxed text-primary-700 dark:text-primary-300">{assistant.description}</p>}</div>
        <Button ref={closeRef} variant="icon" aria-label="Close assistant panel" tooltip="Close assistant panel" onClick={onClose}><Close className="size-4" /></Button>
      </div>
      <div className="shrink-0 overflow-x-auto px-4 pb-4 noscrollbar">
        <SegmentedTabs aria-label="Assistant information" variant="plain" panelId="assistant-info-content" value={tab} onChange={onTabChange}
          options={[{ value: "profile", label: "Details" }, { value: "chats", label: "Chats" }, { value: "memory", label: "Memory" }, { value: "tasks", label: activeTasks ? `Assignments · ${activeTasks}` : "Assignments" }, { value: "routines", label: "Routines" }]} />
      </div>
      <div id="assistant-info-content" role="tabpanel" aria-label={tab === "routines" ? "Routines" : tab === "chats" ? "Chats" : tab === "memory" ? "Memory" : tab === "tasks" ? "Assignments" : "Details"} className="scroll-bounce min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {tab === "routines" ? <AssistantRoutines assistant={assistant} onOpenChat={onSelectChat} />
          : tab === "chats" ? <AssistantChatsPanel chats={chats} selectedRunId={selectedRunId} error={chatsError} disabled={assistant.isArchived} onSelect={onSelectChat} onRetry={onRetryChats} />
          : tab === "memory" ? <AssistantMemoryPanel key={assistant.id} assistant={assistant} memories={overview.memories} />
          : tab === "tasks" ? <AssistantAssignments assistant={assistant} assignments={tasks} assistants={overview.assistants} openAssistant={openAssistant} />
          : <div className="space-y-5 pt-2">
            <AssistantTeamSelect key={assistant.id} assistant={assistant} teams={overview.teams} disabled={archiving} />
            <dl className="rounded-2xl glass-card px-4 text-sm">
              {[["Space", assistant.spaceSnapshot.name], ["Model", formatModelDisplayName(assistant.model, getProviderVariantById(assistant.providerId)?.variant)], ["Effort", formatEffortLevel(assistant.effort || "Default")]].map(([label, value]) => <div key={label} className="flex items-baseline justify-between gap-4 border-b border-primary-200/70 py-3.5 last:border-b-0 dark:border-primary-800/60"><dt className="shrink-0 text-xs font-medium text-primary-600 dark:text-primary-300">{label}</dt><dd className={`min-w-0 max-w-[70%] break-words text-right font-medium leading-6 text-primary-950 dark:text-primary-50 ${label === "Effort" ? "capitalize" : ""}`}>{value}</dd></div>)}
            </dl>
            <div className="rounded-2xl glass-card p-4">
              <h3 className="mb-3 text-sm font-semibold text-primary-950 dark:text-primary-50">Instructions</h3>
              <AgentMarkdown className="leading-6 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">{assistant.instructions}</AgentMarkdown>
            </div>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="flex justify-end">
              <Button variant={assistant.isArchived ? "primary" : "danger"} className="inline-flex min-h-9" disabled={archiving} isLoading={archiving} onClick={onToggleArchive}>{assistant.isArchived ? "Restore assistant" : "Archive assistant"}</Button>
            </div>
          </div>}
      </div>
      </div>
    </aside>
  </div>;
}
