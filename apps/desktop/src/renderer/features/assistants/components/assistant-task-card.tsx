import { useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, AsciiSpinner } from "@/components/ui";
import { ChevronLeft, External } from "@/components/ui/icons";
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

export function AssistantTaskCard({ assignmentId, runId }: { assignmentId: string; runId?: string }) {
  useAssistantUpdates();
  const navigate = useNavigate();
  const detailsId = useId();
  const [expandedTask, setExpandedTask] = useState<string>();
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
  const expanded = expandedTask === taskKey;
  const name = assistant?.name ?? "Assistant";
  const scope = workspace?.name ?? (task.execution.mode === "work" ? "Work" : "");
  const running = task.status === "running" || task.status === "queued";
  const workerRunId = task.workerRunId;
  const canOpenChat = workerRunId && workerRunId !== runId && ["running", "blocked", "completed", "failed"].includes(task.status);
  const reportPreview = !expanded && task.result ? plainActivityText(task.result).replace(/\s+/g, " ") : "";
  const activity = task.activity ?? [];
  const requestInActivity = activity.some(item => item.kind === "request" && item.content === task.prompt);

  return (
    <article aria-label={`${name} task`} className="glass-card my-2 w-full max-w-md rounded-xl text-primary-900 dark:text-primary-100">
      <div className="flex items-center gap-0.5 p-1">
        <Button variant="bare" aria-expanded={expanded} aria-controls={detailsId}
          onClick={() => setExpandedTask(expanded ? undefined : taskKey)}
          className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-primary-300/20 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent dark:hover:bg-primary/5">
          <AssistantAvatar avatar={assistant?.avatar} working={running} seed={task.toAssistantId} className="size-6" />
          <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
            <span className="truncate text-sm font-medium">{name}</span>
            {scope && <span className="truncate text-xs text-primary-600 dark:text-primary-400"><span aria-hidden="true">· </span>{scope}</span>}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-xs capitalize text-primary-600 dark:text-primary-400">
            {running && <AsciiSpinner variant={assistant?.providerId === "codex" ? "codex" : "claude"} kind="circle" />}
            {task.status}
          </span>
          <ChevronLeft aria-hidden="true" className={cn("size-3.5 shrink-0 text-primary-500 transition-transform motion-reduce:transition-none", expanded ? "-rotate-90" : "rotate-180")} />
        </Button>
        {canOpenChat && (
          <Button variant="icon" iconSize="sm" aria-label="Open chat" tooltip="Open chat"
            onClick={() => navigate(assistantHref(task.toAssistantId, workerRunId))}>
            <External aria-hidden="true" />
          </Button>
        )}
      </div>
      {reportPreview && <p className="truncate px-3 pb-2 text-xs text-primary-600 dark:text-primary-400">{reportPreview}</p>}
      {task.error && <p role="alert" className={cn("break-words px-3 pb-2 text-xs text-danger", !expanded && "line-clamp-1")}>{task.error}</p>}
      <div id={detailsId} hidden={!expanded}>
        {expanded && (
          <div className="space-y-2 border-t border-primary-200/70 px-3 py-2.5 dark:border-primary-800/70">
            {task.result && <AgentMarkdown className="[&>.document-paragraph]:leading-5">{task.result}</AgentMarkdown>}
            {!!task.evidence.length && <ul aria-label="Task evidence" className="space-y-0.5 text-xs text-primary-600 dark:text-primary-400">
              {task.evidence.map((item, index) => <li key={index} className="break-words">{item}</li>)}
            </ul>}
            {task.prompt && !requestInActivity && <div className="space-y-0.5">
              <p className="text-xs font-medium text-primary-600 dark:text-primary-400">Task request</p>
              <p className="whitespace-pre-wrap break-words text-sm leading-5">{task.prompt}</p>
            </div>}
            {!!activity.length && <ol aria-label="Task activity" className="divide-y divide-primary-200/70 dark:divide-primary-800/70">
              {activity.map(item => (
                <li key={item.id} className="space-y-0.5 py-1.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-primary-600 dark:text-primary-400">
                    <span className="font-medium">{activityLabels[item.kind]}</span>
                    <span aria-hidden="true">·</span>
                    <span>{deliveryLabels[item.deliveryStatus]}</span>
                  </div>
                  {!(item.kind === "result" && item.content === task.result) &&
                    <AgentMarkdown className="[&>.document-paragraph]:leading-5">{item.content}</AgentMarkdown>}
                  {item.error && <p className="break-words text-xs text-danger">{item.error}</p>}
                </li>
              ))}
            </ol>}
          </div>
        )}
      </div>
    </article>
  );
}
