import { useState, type FormEvent } from "react";
import type { Assistant } from "@mains/contracts/assistants";
import { Alert, AsciiSpinner, Button, Input, Label, Select, Textarea, Toggle } from "@/components/ui";
import { Edit, Trash } from "@/components/ui/icons";
import { useListProjectsQuery, useListWorkspacesQuery } from "@/lib/redux/api";
import { useCreateAssistantRoutineMutation, useDeletePulseMutation, useGetPulsesQuery, useRunPulseNowMutation, useTogglePulseMutation, useUpdatePulseMutation, type Pulse, type PulseFrequency } from "@/lib/redux/api/pulseApi";
import { SchedulePicker } from "@/features/pulse/components/pulse-pickers";
import { formatSchedule } from "@/features/pulse/lib/format-schedule";
import { formatAbsoluteDate } from "@/lib/format-date";
import { errorText } from "../lib/assistant-ui";
import { AssistantPanelEmptyState, AssistantPanelSection } from "./assistant-panel-section";

export function AssistantRoutines({ assistant, onOpenChat }: { assistant: Assistant; onOpenChat(runId: string): void }) {
  const { currentData, error, refetch } = useGetPulsesQuery(undefined, { pollingInterval: 15_000, skipPollingIfUnfocused: true });
  const routines = currentData?.filter(pulse => pulse.accountId === assistant.accountId && pulse.assistantId === assistant.id);
  const [editing, setEditing] = useState<Pulse | null | undefined>();
  const [deleting, setDeleting] = useState<Pulse | null>(null);
  const [failure, setFailure] = useState("");
  const [remove, removing] = useDeletePulseMutation();
  return <AssistantPanelSection label="Mate routines" action={editing === undefined ? {
    label: "New routine", disabled: assistant.isArchived, onClick: () => setEditing(null),
  } : undefined}>
    {editing !== undefined && <RoutineForm key={editing?.id ?? "new"} assistant={assistant} pulse={editing} onClose={() => setEditing(undefined)} />}
    {!!error && <div role="alert" className="text-sm text-danger">{errorText(error)}<Button variant="ghost" onClick={() => void refetch()}>Retry</Button></div>}
    {failure && <p role="alert" className="text-sm text-danger">{failure}</p>}
    {!currentData && !error && <div role="status" className="flex items-center gap-2 text-sm text-primary-500"><AsciiSpinner variant="inherit" />Loading routines…</div>}
    {routines?.length === 0 && !error && <AssistantPanelEmptyState>No routines yet. Add one here or in chat.</AssistantPanelEmptyState>}
    {routines?.map(pulse => <RoutineRow key={pulse.id} pulse={pulse} disabled={assistant.isArchived} onEdit={() => setEditing(pulse)} onDelete={() => { setFailure(""); setDeleting(pulse); }} onOpenChat={onOpenChat} />)}
    <Alert isOpen={!!deleting} title="Delete routine?" description="Future scheduled runs stop. Tasks already queued or running continue; their chats stay in history."
      primaryButtonText="Delete" secondaryButtonText="Cancel" primaryButtonVariant="danger" isPrimaryLoading={removing.isLoading}
      onPrimary={() => { if (deleting) void remove(deleting.id).unwrap().then(() => setDeleting(null)).catch(e => { setFailure(errorText(e)); setDeleting(null); }); }} onSecondary={() => setDeleting(null)} />
  </AssistantPanelSection>;
}

function RoutineForm({ assistant, pulse, onClose }: { assistant: Assistant; pulse: Pulse | null; onClose(): void }) {
  const [title, setTitle] = useState(pulse?.title ?? "");
  const [prompt, setPrompt] = useState(pulse?.prompt ?? "");
  const [workspaceId, setWorkspaceId] = useState(pulse?.workspaceId ?? "");
  const [schedule, setSchedule] = useState({ frequency: pulse?.frequency ?? "daily" as PulseFrequency, hour: pulse?.hour ?? 9, minute: pulse?.minute ?? 0, dayOfWeek: pulse?.dayOfWeek ?? null });
  const timezone = pulse?.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [failure, setFailure] = useState("");
  const { currentData: workspaces } = useListWorkspacesQuery();
  const { currentData: projects } = useListProjectsQuery();
  const options = (workspaces ?? []).filter(workspace => workspace.accountId === assistant.accountId && !workspace.isArchived && !workspace.isReplica).map(workspace => {
    const project = projects?.find(project => project.id === workspace.projectId && project.accountId === assistant.accountId);
    return { value: workspace.id, label: [project?.name, workspace.name].filter((name, index, names) => name && names.indexOf(name) === index).join(" / ") };
  });
  const [create, creating] = useCreateAssistantRoutineMutation();
  const [update, updating] = useUpdatePulseMutation();
  const busy = creating.isLoading || updating.isLoading;
  const valid = !assistant.isArchived && !!title.trim() && !!prompt.trim() && (!workspaceId || !!pulse || options.some(option => option.value === workspaceId));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !valid) return;
    setFailure("");
    const input = { title: title.trim(), prompt: prompt.trim(), ...schedule, timezone };
    try {
      if (pulse) await update({ id: pulse.id, input }).unwrap();
      else await create({ accountId: assistant.accountId, assistantId: assistant.id, input: { ...input, mode: workspaceId ? "developer" : "work", workspaceId: workspaceId || null } }).unwrap();
      onClose();
    } catch (e) { setFailure(errorText(e)); }
  }
  return <form aria-label={pulse ? "Edit routine" : "New routine"} onSubmit={event => void submit(event)} className="glass-card space-y-3.5 rounded-2xl p-3.5">
    <label className="flex flex-col gap-1.5"><Label as="span">Routine name</Label><Input required autoFocus maxLength={200} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} placeholder="Morning release check" /></label>
    <label className="flex flex-col gap-1.5"><Label as="span">Task and completion criteria</Label><Textarea required maxLength={24000} value={prompt} disabled={busy} onChange={event => setPrompt(event.target.value)} className="min-h-28 rounded-2xl" placeholder="What should happen, and what should the mate report?" /></label>
    <div role="group" aria-label="Routine schedule" className="space-y-1.5">
      <Label as="span">Schedule</Label>
      <fieldset disabled={busy} className="min-w-0"><SchedulePicker {...schedule} onChange={setSchedule} /></fieldset>
      <p className="text-xs text-primary-500">{timezone}</p>
    </div>
    <div className="space-y-1.5">
      <Label id="routine-location-label" as="span">Run in</Label>
      {pulse ? <p className="text-sm text-primary-600 dark:text-primary-300">{pulse.mode === "developer" ? options.find(option => option.value === workspaceId)?.label ?? "Workspace unavailable" : "Work"}</p>
        : <Select aria-labelledby="routine-location-label" value={workspaceId} disabled={busy} options={[{ value: "", label: "Work · No repository" }, ...options]} onChange={setWorkspaceId} />}
    </div>
    <p className="text-xs leading-relaxed text-primary-500">Uses this mate’s model and memory.</p>
    {failure && <p role="alert" className="text-sm text-danger">{failure}</p>}
    <div className="flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={busy || !valid} isLoading={busy}>{pulse ? "Save routine" : "Create routine"}</Button></div>
  </form>;
}

function RoutineRow({ pulse, disabled, onEdit, onDelete, onOpenChat }: { pulse: Pulse; disabled: boolean; onEdit(): void; onDelete(): void; onOpenChat(runId: string): void }) {
  const [toggle, toggling] = useTogglePulseMutation();
  const [run, running] = useRunPulseNowMutation();
  const [failure, setFailure] = useState("");
  const act = (operation: Promise<unknown>) => { setFailure(""); void operation.catch(e => setFailure(errorText(e))); };
  return <article aria-label={pulse.title} className="space-y-3 rounded-2xl glass-card p-4">
    <div className="flex items-start justify-between gap-3"><h4 className="min-w-0 break-words text-sm font-medium">{pulse.title}</h4><Toggle aria-label={`${pulse.isActive ? "Pause" : "Resume"} ${pulse.title}`} enabled={pulse.isActive} disabled={disabled || toggling.isLoading} onChange={isActive => act(toggle({ id: pulse.id, isActive }).unwrap())} className="shrink-0 py-0" /></div>
    <p className="text-xs leading-relaxed text-primary-600 dark:text-primary-400">{formatSchedule(pulse)} · {pulse.timezone}</p>
    <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed">{pulse.prompt}</p>
    <p className="text-xs text-primary-500">{pulse.isActive && pulse.nextRunAt ? `Next: ${formatAbsoluteDate(pulse.nextRunAt)}` : "Paused"}{pulse.lastAssignmentStatus ? ` · Last task: ${pulse.lastAssignmentStatus}` : ""}</p>
    {(failure || pulse.lastError) && <p role="alert" className="text-xs leading-relaxed text-danger">{failure || pulse.lastError}</p>}
    <div className="flex flex-wrap items-center justify-end gap-1">
      {pulse.lastRunId && <Button variant="ghost" onClick={() => onOpenChat(pulse.lastRunId!)}>Open last chat</Button>}
      <Button variant="ghost" disabled={disabled || running.isLoading} isLoading={running.isLoading} onClick={() => act(run(pulse.id).unwrap())}>Run now</Button>
      <Button variant="icon" aria-label={`Edit ${pulse.title}`} tooltip="Edit routine" disabled={disabled} onClick={onEdit}><Edit className="size-4" /></Button>
      <Button variant="icon" aria-label={`Delete ${pulse.title}`} tooltip="Delete routine" onClick={onDelete}><Trash className="size-4" /></Button>
    </div>
  </article>;
}
