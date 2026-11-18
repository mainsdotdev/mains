import { useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, AsciiSpinner } from "@/components/ui";
import { ArrowUp } from "@/components/ui/icons";
import { AgentMarkdown } from "@/components/agent-markdown";
import { plainActivityText } from "@/features/workspace/lib/run-activity";
import { cn } from "@/lib/cn";
import { useGetAccountQuery, useGetWorkspaceQuery } from "@/lib/redux/api";
import { useAssistantOverviewQuery, useAssistantAssignmentQuery } from "@/lib/redux/api/assistantsApi";
import { useAssistantUpdates } from "../hooks/use-assistant-updates";
import { assistantHref } from "../lib/assistant-navigation";
import { AssistantAvatar } from "./assistant-avatar";

const activityLabels = { request: "Task request", followup: "Follow-up", status: "Status", result: "Report" };
const deliveryLabels = { queued: "Waiting to send", dispatching: "Sending", delivered: "Delivered", uncertain: "Needs attention", canceled: "Canceled" };
const sectionClassName = "min-w-0 space-y-1 rounded-xl bg-primary-200/55 px-3 py-2.5 dark:bg-primary-950/45";
const disclosureClassName = "grid grid-cols-[minmax(0,1fr)] transition-[grid-template-rows,opacity] duration-250 ease-in-out motion-reduce:transition-none";

function TaskSectionHeading({ label, deliveryStatus }: { label: string; deliveryStatus?: keyof typeof deliveryLabels }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-primary-600 dark:text-primary-400">
      <span className="font-medium text-primary-800 dark:text-primary-200">{label}</span>
      {deliveryStatus && <><span aria-hidden="true">·</span><span>{deliveryLabels[deliveryStatus]}</span></>}
    </div>
  );
}

export function AssistantTaskCard({ assignmentId, runId }: { assignmentId: string; runId?: string }) {
  useAssistantUpdates();
  const navigate = useNavigate();
  const detailsId = useId();
  const [disclosure, setDisclosure] = useState<{ taskKey: string; expanded: boolean }>();
  const { data: account } = useGetAccountQuery();
  const { currentData: overview } = useAssistantOverviewQuery(account?.id ?? "", { skip: !account });
  const { currentData: found, error, refetch } = useAssistantAssignmentQuery({ accountId: account?.id ?? "", id: assignmentId }, { skip: !account });
  const task = found && (found.fromRunId === runId || found.workerRunId === runId) ? found : undefined;
  const workspaceId = task?.execution.mode === "developer" ? task.execution.workspaceId : "";
  const { currentData: workspace } = useGetWorkspaceQuery(workspaceId, { skip: !workspaceId });
  const assistant = overview?.assistants.find(a => a.id === task?.toAssistantId);
  if (error) return <Button variant="ghost" onClick={() => void refetch()}>Retry assistant request</Button>;
  if (found === null) return <p className="py-3 text-xs text-primary-500">This assistant request is unavailable.</p>;
  if (found && !task) return <p className="py-3 text-xs text-primary-500">This task belongs to another conversation.</p>;
  if (!task) return <p className="py-3 text-xs text-primary-500">Loading assistant request…</p>;

  const taskKey = `${runId}:${task.id}`;
  const hasOpened = disclosure?.taskKey === taskKey;
  const expanded = hasOpened && disclosure.expanded;
  const name = assistant?.name ?? "Assistant";
  const scope = workspace?.name ?? (task.execution.mode === "work" ? "Work" : "");
  const running = task.status === "running" || task.status === "queued";
  const workerRunId = task.workerRunId;
  const canOpenChat = workerRunId && workerRunId !== runId && ["running", "blocked", "completed", "failed"].includes(task.status);
  const reportPreview = task.result ? plainActivityText(task.result).replace(/\s+/g, " ") : "";
  const activity = task.activity ?? [];
  const requestInActivity = activity.some(item => item.kind === "request" && item.content === task.prompt);
  const errorInActivity = activity.some(item => item.kind === "status" && item.content === task.error);
  const reportActivity = task.result ? activity.filter(item => item.kind === "result" && item.content === task.result).at(-1) : undefined;
  const activityRows = activity.filter(item => item.id !== reportActivity?.id);

  return (
    <article aria-label={`${name} task`} className="glass-card my-2 w-full min-w-0 max-w-transcript-bubble rounded-transcript-bubble text-primary-900 dark:text-primary-100">
      <div className="flex items-center gap-1.5 p-1.5">
        <Button variant="bare" aria-expanded={expanded} aria-controls={detailsId}
          onClick={() => setDisclosure({ taskKey, expanded: !expanded })}
          className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-primary-300/20 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent dark:hover:bg-primary/5">
          <AssistantAvatar avatar={assistant?.avatar} working={running} seed={task.toAssistantId} className="size-6" />
          <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
            <span className="truncate text-sm font-medium">{name}</span>
            {scope && <span className="truncate text-xs text-primary-600 dark:text-primary-400"><span aria-hidden="true">· </span>{scope}</span>}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-xs capitalize text-primary-600 dark:text-primary-400">
            {running && <AsciiSpinner variant={assistant?.providerId === "codex" ? "codex" : "claude"} kind="circle" />}
            {task.status}
          </span>
          <ArrowUp aria-hidden="true" className={cn("size-3.5 shrink-0 text-primary-500 transition-transform duration-250 ease-in-out motion-reduce:transition-none", expanded ? "rotate-180" : "rotate-90")} />
        </Button>
        {canOpenChat && (
          <Button variant="secondary" className="mr-1 shrink-0 whitespace-nowrap px-2.5 text-xs focus-visible:ring-2 focus-visible:ring-accent"
            onClick={() => navigate(assistantHref(task.toAssistantId, workerRunId))}>
            Open chat
          </Button>
        )}
      </div>
      <div aria-hidden={expanded || undefined} className={cn(disclosureClassName, expanded ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100")}>
        <div className="min-h-0 overflow-hidden">
          {reportPreview && <p className="truncate px-3.5 pb-2.5 text-xs text-primary-600 dark:text-primary-400">{reportPreview}</p>}
          {task.error && <div className="px-3.5 pb-2.5"><p role="alert" className="line-clamp-2 break-words text-xs text-danger">{task.error}</p></div>}
        </div>
      </div>
      <div id={detailsId} role="group" aria-label="Task details" aria-hidden={!expanded || undefined} inert={!expanded}
        className={cn(disclosureClassName, expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
        <div className="min-h-0 overflow-hidden">
          {hasOpened && <div className="space-y-2 px-2.5 pb-2.5 pt-0.5">
            {task.error && !errorInActivity && <p role="alert" className={cn(sectionClassName, "break-words text-xs text-danger")}>{task.error}</p>}
            {(task.result || task.evidence.length > 0) && <section aria-label="Task report" className={sectionClassName}>
              <TaskSectionHeading label="Report" deliveryStatus={reportActivity?.deliveryStatus} />
              {task.result && <AgentMarkdown className="[&>.document-paragraph]:leading-5">{task.result}</AgentMarkdown>}
              {!!task.evidence.length && <ul aria-label="Task evidence" className="space-y-0.5 text-xs text-primary-600 dark:text-primary-400">
                {task.evidence.map((item, index) => <li key={index} className="break-words">{item}</li>)}
              </ul>}
              {reportActivity?.error && <p className="break-words text-xs text-danger">{reportActivity.error}</p>}
            </section>}
            {task.prompt && !requestInActivity && <div className={sectionClassName}>
              <TaskSectionHeading label="Task request" />
              <p className="whitespace-pre-wrap break-words text-sm leading-5">{task.prompt}</p>
            </div>}
            {!!activityRows.length && <ol aria-label="Task activity" className="space-y-2">
              {activityRows.map(item => (
                <li key={item.id} className={sectionClassName}>
                  <TaskSectionHeading label={activityLabels[item.kind]} deliveryStatus={item.deliveryStatus} />
                  {!(item.kind === "result" && item.content === task.result) &&
                    <AgentMarkdown className="[&>.document-paragraph]:leading-5">{item.content}</AgentMarkdown>}
                  {item.error && <p className="break-words text-xs text-danger">{item.error}</p>}
                </li>
              ))}
            </ol>}
          </div>}
        </div>
      </div>
    </article>
  );
}
