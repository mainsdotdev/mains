import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent } from "react";
import { canAccessAssistantAssignment, type Assistant, type AssistantConversation, type AssistantOverview, type AssistantProfile, type AssistantTeam } from "@mains/contracts/assistants";
import { Button, Input, Label, Select, SegmentedTabs, Textarea } from "@/components/ui";
import { Close } from "@/components/ui/icons";
import { AgentMarkdown } from "@/components/agent-markdown";
import { usePanelAnimation } from "@/hooks/use-panel-animation";
import { ResizeHandle } from "@/components/layout/resize-handle";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setAssistantInfoPanelWidth } from "@/lib/redux/slices/appSettingsSlice";
import { useUpdateAssistantProfileMutation } from "@/lib/redux/api/assistantsApi";
import { ASSISTANT_INFO_PANEL_WIDTH_DEFAULT, ASSISTANT_INFO_PANEL_WIDTH_MIN, ASSISTANT_INFO_PANEL_WIDTH_MAX, clamp } from "@/lib/layout";
import { formatEffortLevel } from "@/lib/format";
import { formatModelDisplayName } from "@/lib/model-display";
import { getProviderVariantById } from "@/lib/provider-variants";
import { AssistantAvatar } from "./assistant-avatar";
import { AssistantAvatarPicker } from "./assistant-avatar-picker";
import { AssistantMemoryPanel } from "./assistant-memory";
import { AssistantAssignments } from "./assistant-assignments";
import { AssistantChatsPanel } from "./assistant-chats-panel";
import { AssistantRoutines } from "./assistant-routines";
import { AssistantTeamEditor } from "./assistant-team-editor";
import { errorText, isAssistantWorking } from "../lib/assistant-ui";

type EditableProfile = AssistantProfile & Pick<Assistant, "teamId">;

function AssistantProfileDetails({ assistant, overview, archiving, error, onToggleArchive }: {
  assistant: Assistant;
  overview: AssistantOverview;
  archiving: boolean;
  error: string;
  onToggleArchive(): void;
}) {
  const [updateProfile, { isLoading }] = useUpdateAssistantProfileMutation();
  const [edit, setEdit] = useState<{ draft: EditableProfile; original: EditableProfile } | null>(null);
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [createdTeams, setCreatedTeams] = useState<AssistantTeam[]>([]);
  const [failure, setFailure] = useState("");
  const saving = useRef(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const canEdit = !assistant.isArchived && !overview.welcomes?.some(welcome =>
    welcome.assistantId === assistant.id && welcome.question?.profileSetup && !welcome.question.profileSetup.saved);
  const draft = edit?.draft;
  const teamLabelId = `assistant-${assistant.id}-team-label`;
  const teams = new Map([...createdTeams, ...overview.teams]
    .filter(team => team.accountId === assistant.accountId).map(team => [team.id, team.name]));
  const teamName = assistant.teamId === null ? "No team" : teams.get(assistant.teamId) ?? "Unavailable team";

  useLayoutEffect(() => {
    if (!edit && restoreFocus.current) {
      restoreFocus.current = false;
      editButton.current?.focus({ preventScroll: true });
    }
  }, [edit]);

  function beginEdit(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const { name, description, instructions, avatar, teamId } = assistant;
    const original = { name, description, instructions, avatar, teamId };
    setFailure("");
    setEdit({ original, draft: original });
  }
  function changeDraft(changes: Partial<EditableProfile>) {
    setEdit(current => current && { ...current, draft: { ...current.draft, ...changes } });
  }
  function onTeamCreated(team: AssistantTeam) {
    setCreatedTeams(current => [...current.filter(value => value.id !== team.id), team]);
    changeDraft({ teamId: team.id });
    setCreatingTeam(false);
  }
  function closeEditor() {
    restoreFocus.current = true;
    setEdit(null);
    setCreatingTeam(false);
    setFailure("");
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!edit || !canEdit || archiving || creatingTeam || saving.current) return;
    const { name, description, instructions, avatar, teamId } = edit.draft;
    if (!name.trim() || !instructions.trim()) return;
    const { teamId: expectedTeamId, ...expectedProfile } = edit.original;
    saving.current = true;
    setFailure("");
    try {
      await updateProfile({ accountId: assistant.accountId, id: assistant.id, expectedProfile,
        profile: { name: name.trim(), description: description.trim(), instructions: instructions.trim(), avatar },
        ...(teamId !== expectedTeamId && { teamChange: { teamId, expectedTeamId } }),
      }).unwrap();
      closeEditor();
    } catch (requestError) {
      setFailure(errorText(requestError));
    } finally {
      saving.current = false;
    }
  }

  return <form aria-label={draft ? "Edit mate profile" : undefined} onSubmit={save} className="space-y-4 pt-2">
    {draft && <fieldset disabled={isLoading} className="glass-card min-w-0 space-y-3.5 rounded-2xl p-3.5">
      <AssistantAvatarPicker avatar={draft.avatar} seed={assistant.id} compact onChange={avatar => changeDraft({ avatar })} />
      <label className="flex flex-col gap-1.5 text-sm">
        <span>Name</span>
        <Input value={draft.name} onChange={event => changeDraft({ name: event.target.value })} autoComplete="off" autoFocus required maxLength={100} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span>Description</span>
        <Textarea value={draft.description} onChange={event => changeDraft({ description: event.target.value })} rows={2} maxLength={1000} />
      </label>
    </fieldset>}
    {draft ? <div className="rounded-2xl glass-card p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <Label id={teamLabelId} as="span" className="shrink-0" size="xs" tone="secondary">Team</Label>
        <div className="ml-auto flex min-w-0 flex-wrap items-stretch justify-end gap-2">
          <Button className="inline-flex shrink-0 whitespace-nowrap" type="button" variant="primary"
            disabled={isLoading || creatingTeam} aria-expanded={creatingTeam} onClick={() => setCreatingTeam(true)}>New team</Button>
          <div className="min-w-0">
            <Select aria-labelledby={teamLabelId} value={draft.teamId ?? ""} disabled={isLoading || creatingTeam}
              options={[{ value: "", label: "No team" }, ...Array.from(teams, ([value, label]) => ({ value, label }))]}
              placeholder="Unavailable team" onChange={teamId => changeDraft({ teamId: teamId || null })} />
          </div>
        </div>
      </div>
      {creatingTeam && <AssistantTeamEditor inline accountId={assistant.accountId}
        onCancel={() => setCreatingTeam(false)} onCreated={onTeamCreated} />}
    </div> : <dl className="flex items-baseline justify-between gap-4 rounded-2xl glass-card p-3.5">
      <dt className="shrink-0 text-xs font-medium text-primary-600 dark:text-primary-300">Team</dt>
      <dd className="min-w-0 break-words text-right text-sm font-medium leading-6 text-primary-950 dark:text-primary-50">{teamName}</dd>
    </dl>}
    <dl className="rounded-2xl glass-card px-3.5 text-sm">
      {[["Space", assistant.spaceSnapshot.name], ["Model", formatModelDisplayName(assistant.model, getProviderVariantById(assistant.providerId)?.variant)], ["Effort", formatEffortLevel(assistant.effort || "Default")]].map(([label, value]) => <div key={label} className="flex items-baseline justify-between gap-4 border-b border-primary-200/70 py-3.5 last:border-b-0 dark:border-primary-800/60"><dt className="shrink-0 text-xs font-medium text-primary-600 dark:text-primary-300">{label}</dt><dd className={`min-w-0 max-w-[70%] break-words text-right font-medium leading-6 text-primary-950 dark:text-primary-50 ${label === "Effort" ? "capitalize" : ""}`}>{value}</dd></div>)}
    </dl>
    <div className="rounded-2xl glass-card p-3.5">
      {draft ? <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-semibold text-primary-950 dark:text-primary-50">Instructions</span>
        <Textarea value={draft.instructions} onChange={event => changeDraft({ instructions: event.target.value })}
          rows={6} maxLength={16000} required disabled={isLoading} />
      </label> : <>
        <h3 className="mb-3 text-sm font-semibold text-primary-950 dark:text-primary-50">Instructions</h3>
        <AgentMarkdown className="leading-6 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">{assistant.instructions}</AgentMarkdown>
      </>}
    </div>
    {!!(failure || error) && <p role="alert" className="text-sm text-danger">{failure || error}</p>}
    <div className="flex justify-end gap-2">
      {draft ? <Fragment key="editing">
        <Button variant="ghost" className="inline-flex min-h-9" disabled={isLoading} onClick={closeEditor}>Cancel</Button>
        <Button type="submit" variant="submit" className="inline-flex min-h-9" isLoading={isLoading}
          disabled={!canEdit || archiving || creatingTeam || !draft.name.trim() || !draft.instructions.trim()}>Save</Button>
      </Fragment> : <Fragment key="viewing">
        <Button variant={assistant.isArchived ? "primary" : "danger"} className="inline-flex min-h-9" disabled={archiving} isLoading={archiving} onClick={onToggleArchive}>{assistant.isArchived ? "Restore mate" : "Archive mate"}</Button>
        {canEdit && <Button ref={editButton} variant="primary" className="inline-flex min-h-9" disabled={archiving} onClick={beginEdit}>Edit</Button>}
      </Fragment>}
    </div>
  </form>;
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
        ariaLabel="Resize mate panel" />
      <div className={`flex h-full min-h-0 flex-col transition-[translate,opacity] ease-out motion-reduce:translate-y-0 motion-reduce:transition-none ${isAnimatedIn ? "translate-y-0 opacity-100 duration-200 delay-75" : "translate-y-3 opacity-0 duration-100 delay-0"}`}>
      {/* Match the title bar action's right inset after the content gutter. */}
      <div className="flex shrink-0 items-start gap-3 pt-5 pr-2.25 pb-4 pl-5">
        <AssistantAvatar avatar={assistant.avatar} working={isAssistantWorking(overview, assistant.id)} seed={assistant.id} className="size-10" />
        <div className="min-w-0 flex-1"><h2 className="truncate text-base font-medium text-primary-950 dark:text-primary-50">{assistant.name}</h2>{assistant.description && <p className="mt-1.5 text-sm leading-relaxed text-primary-700 dark:text-primary-300">{assistant.description}</p>}</div>
        <Button ref={closeRef} variant="icon" aria-label="Close mate panel" tooltip="Close mate panel"
          tooltipPosition="bottom-left" onClick={onClose}><Close className="size-4" /></Button>
      </div>
      <div className="shrink-0 overflow-x-auto px-4 pb-4 noscrollbar">
        <SegmentedTabs aria-label="Mate information" variant="plain" panelId="assistant-info-content" value={tab} onChange={onTabChange}
          options={[{ value: "profile", label: "Details" }, { value: "chats", label: "Chats" }, { value: "memory", label: "Memory" }, { value: "tasks", label: activeTasks ? `Assignments · ${activeTasks}` : "Assignments" }, { value: "routines", label: "Routines" }]} />
      </div>
      <div id="assistant-info-content" role="tabpanel" aria-label={tab === "routines" ? "Routines" : tab === "chats" ? "Chats" : tab === "memory" ? "Memory" : tab === "tasks" ? "Assignments" : "Details"} className="scroll-bounce min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {tab === "routines" ? <AssistantRoutines assistant={assistant} onOpenChat={onSelectChat} />
          : tab === "chats" ? <AssistantChatsPanel chats={chats} selectedRunId={selectedRunId} error={chatsError} disabled={assistant.isArchived} onSelect={onSelectChat} onRetry={onRetryChats} />
          : tab === "memory" ? <AssistantMemoryPanel key={assistant.id} assistant={assistant} memories={overview.memories} />
          : tab === "tasks" ? <AssistantAssignments key={assistant.id} assistant={assistant} assignments={tasks} assistants={overview.assistants} openAssistant={openAssistant} />
          : <AssistantProfileDetails key={assistant.id} assistant={assistant} overview={overview} archiving={archiving} error={error} onToggleArchive={onToggleArchive} />}
      </div>
      </div>
    </aside>
  </div>;
}
