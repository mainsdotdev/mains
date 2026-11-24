import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { Assistant, AssistantAssignment, AssistantTeamWorkItem } from "@mains/contracts/assistants";
import { AsciiSpinner, Button, StatusBadge, Text, type StatusTone } from "@/components/ui";
import { ChevronLeft, Close, External, Plus } from "@/components/ui/icons";
import { CONTENT_COLUMN_GUTTER, CONTENT_COLUMN_WIDTH } from "@/features/workspace/lib/content-column";
import { useRunActivity } from "@/features/workspace/hooks/use-run-activity";
import { useToolApproval } from "@/features/workspace/hooks/use-tool-approval";
import { lastActivityLine } from "@/features/workspace/lib/background-runs";
import { plainActivityText } from "@/features/workspace/lib/run-activity";
import { cn } from "@/lib/cn";
import { formatAbsoluteDate, formatCompactRelativeDate } from "@/lib/format-date";
import { useAssistantAssignmentQuery, useAssistantOverviewQuery, useAssistantTeamWorkQuery } from "@/lib/redux/api/assistantsApi";
import { getTransport, onTransportChange } from "@/lib/transport";
import { assistantHref } from "../lib/assistant-navigation";
import { assignmentDisplayTitle, assistantsReadyForWork, errorText, pullRequestReviewPresentation } from "../lib/assistant-ui";
import { AssistantAssignmentDetails } from "./assistant-assignment-card";
import { AssistantAssignmentForm } from "./assistant-assignment-form";
import { AssistantAvatar } from "./assistant-avatar";
import { AssistantCardSection } from "./assistant-card-section";

const sections: { title: string; statuses: AssistantTeamWorkItem["status"][] }[] = [
  { title: "Needs you", statuses: ["needs_you"] },
  { title: "Needs attention", statuses: ["needs_attention"] },
  { title: "In progress", statuses: ["running", "waiting_for_teammate"] },
  { title: "Queued", statuses: ["queued"] },
  { title: "Recent", statuses: ["completed", "canceled"] },
];

const statusLabels: Record<AssistantTeamWorkItem["status"], { label: string; tone: StatusTone }> = {
  needs_you: { label: "Input needed", tone: "warning" },
  needs_attention: { label: "Needs attention", tone: "danger" },
  running: { label: "Working", tone: "info" },
  waiting_for_teammate: { label: "Waiting for teammate", tone: "neutral" },
  queued: { label: "Queued", tone: "neutral" },
  completed: { label: "Completed", tone: "success" },
  canceled: { label: "Canceled", tone: "neutral" },
};

function workStatus(item: AssistantTeamWorkItem) {
  const { label, tone } = statusLabels[item.status];
  if (item.status !== "needs_you" || item.pendingKinds.length !== 1) return { label, tone };
  if (item.pendingKinds[0] === "ask_user") return { label: "Question", tone };
  if (item.pendingKinds[0] === "tool_approval") return { label: "Approval", tone };
  return { label, tone };
}

export function AssistantTeamWork({ accountId, teamId }: { accountId: string; teamId: string }) {
  const transport = useSyncExternalStore(onTransportChange, getTransport);
  const subscribe = useCallback((refresh: () => void) => transport.onStatusChange(refresh), [transport]);
  const connected = useSyncExternalStore(subscribe, () => transport.status() === "connected");
  const { currentData: overview } = useAssistantOverviewQuery(accountId);
  const { currentData: work, error, isFetching, refetch } = useAssistantTeamWorkQuery({ accountId, teamId }, {
    skip: !connected, refetchOnMountOrArgChange: true,
  });
  const [selected, setSelected] = useState<AssistantTeamWorkItem>();
  const [creating, setCreating] = useState(false);
  const newAssignmentRef = useRef<HTMLButtonElement>(null);
  const lastSelectedRow = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const openChat = (assistantId: string, runId: string) => navigate(assistantHref(assistantId, runId));
  const activeItem = selected && work?.items.find(item => item.kind === selected.kind && item.id === selected.id);
  const selectedItem = activeItem ?? selected;
  const teamName = work?.team.name ?? overview?.teams.find(team => team.id === teamId)?.name;
  const mates = new Map(overview?.assistants.map(mate => [mate.id, mate]));
  const belongsToTeam = (mate: Assistant) => mate.accountId === accountId && mate.teamId === teamId;
  const members = overview?.assistants.filter(mate => belongsToTeam(mate) && !mate.isArchived) ?? [];
  const eligible = assistantsReadyForWork(overview).filter(belongsToTeam);

  function closeDetails() {
    setSelected(undefined);
    requestAnimationFrame(() => (lastSelectedRow.current?.isConnected ? lastSelectedRow.current : newAssignmentRef.current)?.focus());
  }

  function closeForm() {
    setCreating(false);
    requestAnimationFrame(() => newAssignmentRef.current?.focus());
  }

  function selectAssigned(task: AssistantAssignment) {
    setCreating(false);
    lastSelectedRow.current = null;
    setSelected({ id: task.id, kind: "assignment", assistantId: task.toAssistantId, title: task.title,
      status: "queued", runId: null, pendingKinds: [], pullRequestKey: null, updatedAt: task.updatedAt });
  }

  return <div className={cn("scroll-bounce h-full min-h-0 overflow-y-auto rounded-2xl bg-primary text-primary-900 dark:bg-primary-950 dark:text-primary-100", CONTENT_COLUMN_GUTTER)}>
    <section aria-label="Team assignments" className={cn("@container/team-work w-full space-y-6 pb-12 pt-10", CONTENT_COLUMN_WIDTH)}>
      <header className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 space-y-1">
            {teamName && <Text as="p" size="s" tone="secondary" className="wrap-anywhere">{teamName}</Text>}
            <Text as="h1" size="xl" weight="semibold">Team assignments</Text>
          </div>
          {connected && work && !creating && <Button ref={newAssignmentRef} variant="primary" className="shrink-0 gap-2"
            disabled={!eligible.length} onClick={() => setCreating(true)}><Plus aria-hidden="true" className="size-3.5" />New assignment</Button>}
        </div>
        {!!members.length && <TeamMembers mates={members} items={work?.items} />}
      </header>
      {connected && creating && <AssistantAssignmentForm team={{ id: teamId, mates: eligible }} onClose={closeForm} onAssigned={selectAssigned} />}
      {!connected ? <Text as="p" size="s" tone="secondary" role="status">Connect to the backend to see team assignments.</Text>
        : error ? <TeamWorkError error={error} loading={isFetching} retry={() => void refetch()} />
        : !work ? <TeamWorkLoading label="Loading team assignments…" />
        : <div className={cn("grid items-start gap-4", selectedItem && "@min-[40rem]/team-work:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]")}>
          <div className={cn("min-w-0 space-y-4", selectedItem && "hidden @min-[40rem]/team-work:block")}>
            {!work.items.length && <Text as="p" size="s" tone="secondary" align="center" className="glass-card rounded-2xl px-4 py-8">No team assignments yet.</Text>}
            {sections.map(({ title, statuses }) => {
              const rows = work.items.filter(item => statuses.includes(item.status));
              if (!rows.length) return null;
              return <section key={title} aria-label={title} className="space-y-2">
                <Text as="h2" size="s" weight="medium" className="px-1">{title}</Text>
                <ul className="glass-card divide-y divide-primary-500/15 overflow-hidden rounded-2xl">
                  {rows.map(item => <li key={`${item.kind}:${item.id}`}>
                    <TeamWorkRow item={item} mate={mates.get(item.assistantId)} selected={activeItem === item} onOpen={event => {
                      lastSelectedRow.current = event.currentTarget;
                      setSelected(item);
                    }} />
                  </li>)}
                </ul>
              </section>;
            })}
          </div>
          {selectedItem && <TeamWorkDetails key={`${selectedItem.kind}:${selectedItem.id}`} accountId={accountId} teamId={teamId}
            item={selectedItem} mate={mates.get(selectedItem.assistantId)} stillListed={!!activeItem} onClose={closeDetails} openChat={openChat} />}
        </div>}
    </section>
  </div>;
}

function TeamMembers({ mates, items }: { mates: Assistant[]; items?: AssistantTeamWorkItem[] }) {
  const visible = mates.slice(0, 6);
  return <ul className="flex flex-wrap items-center gap-1.5" aria-label="Team members">
    {visible.map(mate => {
      const needsYou = items?.some(item => item.assistantId === mate.id && item.status === "needs_you");
      const working = items?.some(item => item.assistantId === mate.id && item.status === "running");
      const queued = !needsYou && !working && items?.some(item => item.assistantId === mate.id && item.status === "queued");
      return <li key={mate.id} className="glass-card inline-flex max-w-full items-center gap-1.5 rounded-lg px-2 py-1">
        <AssistantAvatar avatar={mate.avatar} seed={mate.id} animated={false} className="size-4 shrink-0" />
        <Text as="span" size="xs" weight="medium" className="truncate" title={mate.name}>{mate.name}</Text>
        {needsYou && <Text as="span" size="xs" tone="warning" className="shrink-0">Needs you</Text>}
        {!needsYou && working && <Text as="span" size="xs" tone="secondary" className="shrink-0">Working</Text>}
        {queued && <Text as="span" size="xs" tone="secondary" className="shrink-0">Queued</Text>}
      </li>;
    })}
    {mates.length > visible.length && <li><Text as="span" size="xs" tone="secondary">+{mates.length - visible.length} more</Text></li>}
  </ul>;
}

function TeamWorkRow({ item, mate, selected, onOpen }: {
  item: AssistantTeamWorkItem; mate?: Assistant; selected: boolean; onOpen(event: MouseEvent<HTMLButtonElement>): void;
}) {
  const { label, tone } = workStatus(item);
  const reference = item.pullRequestKey?.slice(item.pullRequestKey.indexOf(":") + 1);
  return <Button variant="bare" fullWidth aria-pressed={selected} onClick={onOpen}
    className="flex min-w-0 items-center gap-2 px-3 py-3 text-left hover:bg-primary-950/5 aria-pressed:bg-primary-950/7 dark:hover:bg-primary/8 dark:aria-pressed:bg-primary/10 @min-[40rem]/team-work:px-3.5">
    <AssistantAvatar avatar={mate?.avatar} seed={item.assistantId} animated={false} className="size-7 shrink-0" />
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-medium" title={item.title}>{item.title}</span>
      <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-primary-600 dark:text-primary-400">
        <span className="truncate">{mate?.name ?? "Mate"}</span>
        {reference && <><span aria-hidden="true">·</span><span className="truncate" title={reference}>{reference}</span></>}
      </span>
    </span>
    <StatusBadge tone={tone}>{label}</StatusBadge>
    <time className="hidden min-w-8 text-right text-xs text-primary-600 tabular-nums dark:text-primary-400 @min-[40rem]/team-work:block"
      dateTime={new Date(item.updatedAt).toISOString()}>{formatCompactRelativeDate(item.updatedAt)}</time>
    <ChevronLeft className="hidden size-3.5 shrink-0 rotate-180 text-primary-500 @min-[30rem]/team-work:block" aria-hidden="true" />
  </Button>;
}

function TeamWorkDetails({ accountId, teamId, item, mate, stillListed, onClose, openChat }: {
  accountId: string; teamId: string; item: AssistantTeamWorkItem; mate?: Assistant; stillListed: boolean;
  onClose(): void; openChat(assistantId: string, runId: string): void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const { currentData, error, isFetching, refetch } = useAssistantAssignmentQuery({ accountId, id: item.id }, { skip: item.kind !== "assignment" });
  const task = currentData?.teamId === teamId && currentData.accountId === accountId ? currentData : undefined;
  const status = item.kind === "conversation" && !stillListed ? { label: "Conversation", tone: "neutral" as const } : workStatus(item);
  const reference = item.pullRequestKey?.slice(item.pullRequestKey.indexOf(":") + 1);
  const runId = item.runId;
  const streams = useRunActivity(stillListed && item.status === "running" ? runId : null);
  const progress = streams.slice().reverse().find(stream => stream.kind === "tool_progress");
  const progressLine = progress && lastActivityLine(plainActivityText(progress.content));
  const latest = task?.activity?.slice().reverse().find(update => update.kind === "status" || update.kind === "followup");
  const activity = latest?.content && latest.content !== task?.error ? latest : undefined;

  return <aside aria-label="Assignment details" className="glass-card min-w-0 space-y-3 rounded-2xl p-3.5"
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <header className="flex items-start gap-2.5">
      <AssistantAvatar avatar={mate?.avatar} seed={item.assistantId} animated={false} className="mt-0.5 size-7 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Text ref={heading} tabIndex={-1} as="h2" size="base" weight="semibold" className="wrap-anywhere outline-none">{assignmentDisplayTitle(item.title, task?.taskKey)}</Text>
        <Text as="p" size="xs" tone="secondary" className="wrap-anywhere">{mate?.name ?? "Mate"}{reference && ` · ${reference}`}</Text>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </div>
      <Button variant="icon" iconSize="sm" aria-label="Close assignment details" tooltip="Close details" onClick={onClose}><Close aria-hidden="true" /></Button>
    </header>
    {stillListed && item.status === "needs_you" && runId && <TeamDecision runId={runId} />}
    {progressLine && <AssistantCardSection title="Current activity"><Text as="p" size="s" className="line-clamp-4 wrap-anywhere">{progressLine}</Text></AssistantCardSection>}
    {item.kind === "assignment" && (error ? <TeamWorkError error={error} loading={isFetching} retry={() => void refetch()} />
      : task ? <>
        {activity && <AssistantCardSection title="Latest update" status={formatCompactRelativeDate(activity.createdAt)}>
          <p className="line-clamp-4 whitespace-pre-wrap wrap-anywhere text-sm leading-5">{pullRequestReviewPresentation(task)?.formatText(activity.content) ?? activity.content}</p>
        </AssistantCardSection>}
        <AssistantAssignmentDetails task={task} />
      </> : currentData === undefined ? <TeamWorkLoading label="Loading assignment…" />
        : <Text as="p" size="s" tone="secondary" role="status">Assignment unavailable.</Text>)}
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-primary-500/15 pt-3">
      <Text as="p" size="xs" tone="secondary">{formatAbsoluteDate(item.updatedAt)}</Text>
      {runId && <Button variant="secondary" className="gap-1.5" onClick={() => openChat(item.assistantId, runId)}>
        Open chat<External aria-hidden="true" className="size-3.5" />
      </Button>}
    </div>
  </aside>;
}

function TeamDecision({ runId }: { runId: string }) {
  const { pendingApprovals } = useToolApproval([{ id: runId, status: "running" }]);
  const question = pendingApprovals.find(request => request.kind === "ask_user" && !request.isSecret && request.question)?.question;
  return <AssistantCardSection title="Needs you" status={pendingApprovals.length > 1 ? `${pendingApprovals.length} requests` : undefined}>
    <Text as="p" size="s" className="whitespace-pre-wrap wrap-anywhere">{question || "Open the Mate chat to respond."}</Text>
  </AssistantCardSection>;
}

function TeamWorkLoading({ label }: { label: string }) {
  return <div role="status" className="flex items-center gap-2 text-sm text-primary-500"><AsciiSpinner variant="inherit" />{label}</div>;
}

function TeamWorkError({ error, loading, retry }: { error: unknown; loading: boolean; retry(): void }) {
  return <div className="flex flex-wrap items-center gap-2">
    <p role="alert" className="text-sm text-danger">{errorText(error)}</p>
    <Button variant="ghost" isLoading={loading} onClick={retry}>Retry</Button>
  </div>;
}
