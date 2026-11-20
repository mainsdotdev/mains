import { useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui";
import { ArrowUp } from "@/components/ui/icons";
import { AgentMarkdown } from "@/components/agent-markdown";
import { plainActivityText } from "@/features/workspace/lib/run-activity";
import { cn } from "@/lib/cn";
import { useGetAccountQuery, useGetWorkspaceQuery } from "@/lib/redux/api";
import { useAssistantOverviewQuery, useAssistantAssignmentQuery } from "@/lib/redux/api/assistantsApi";
import { useAssistantUpdates } from "../hooks/use-assistant-updates";
import { assistantHref } from "../lib/assistant-navigation";
import { errorText, pullRequestReviewPresentation } from "../lib/assistant-ui";
import { AssistantAvatar } from "./assistant-avatar";
import { AssistantCardSection } from "./assistant-card-section";
import { AssignmentStatusBadge } from "./assignment-status-badge";

const activityLabels = { request: "Task request", followup: "Follow-up", status: "Status", result: "Report" };
const deliveryLabels = { queued: "Waiting to send", dispatching: "Sending", delivered: undefined, uncertain: "Needs attention", canceled: "Canceled" };
const disclosureClassName = "grid grid-cols-[minmax(0,1fr)] transition-[grid-template-rows,opacity] duration-250 ease-in-out motion-reduce:transition-none";

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
  if (error) return <Button variant="ghost" onClick={() => void refetch()}>Retry mate request</Button>;
  if (found === null) return <p className="py-3 text-xs text-primary-500">This mate request is unavailable.</p>;
  if (found && !task) return <p className="py-3 text-xs text-primary-500">This task belongs to another conversation.</p>;
  if (!task) return <p className="py-3 text-xs text-primary-500">Loading mate request…</p>;

  const taskKey = `${runId}:${task.id}`;
  const hasOpened = disclosure?.taskKey === taskKey;
  const expanded = hasOpened && disclosure.expanded;
  const review = pullRequestReviewPresentation(task);
  const name = assistant?.name ?? "Mate";
  const scope = review ? "PR review" : workspace?.name ?? (task.execution.mode === "work" ? "Work" : "");
  const running = task.status === "running" || task.status === "queued";
  const workerRunId = task.workerRunId;
  const canOpenChat = workerRunId && workerRunId !== runId && ["running", "blocked", "completed", "failed"].includes(task.status);
  const result = review?.result ?? task.result;
  const evidence = review?.evidence ?? task.evidence;
  const reportPreview = result ? plainActivityText(result).replace(/\s+/g, " ") : "";
  const activity = task.activity ?? [];
  const taskError = task.error ? errorText(task.error) : "";
  const requestInActivity = activity.some(item => item.kind === "request" && item.content === task.prompt);
  const errorInActivity = activity.some(item => item.kind === "status" && item.content === task.error);
  const reportActivity = task.result ? activity.filter(item => item.kind === "result" && item.content === task.result).at(-1) : undefined;
  const activityRows = activity.filter(item => item.id !== reportActivity?.id && (!review || item.kind !== "request"));

  return (
    <article aria-label={`${name} task`} className="my-2 flex w-full min-w-0 max-w-transcript-bubble flex-col gap-2 text-primary-900 dark:text-primary-100">
      <div className="glass-card rounded-transcript-bubble">
        <div className="p-1.5">
          <Button variant="bare" aria-expanded={expanded} aria-controls={detailsId}
            onClick={() => setDisclosure({ taskKey, expanded: !expanded })}
            className="flex min-h-9 w-full min-w-0 items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-primary-300/20 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent dark:hover:bg-primary/5">
            <AssistantAvatar avatar={assistant?.avatar} working={running} seed={task.toAssistantId} className="size-6" />
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
              <span className="truncate text-sm font-medium">{name}</span>
              {scope && <span className="truncate text-xs text-primary-600 dark:text-primary-400"><span aria-hidden="true">· </span>{scope}</span>}
            </span>
            <AssignmentStatusBadge status={task.status} />
            <ArrowUp aria-hidden="true" className={cn("size-3.5 shrink-0 text-primary-500 transition-transform duration-250 ease-in-out motion-reduce:transition-none", expanded ? "rotate-180" : "rotate-90")} />
          </Button>
        </div>
        <div aria-hidden={expanded || undefined} className={cn(disclosureClassName, expanded ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100")}>
          <div className="min-h-0 overflow-hidden">
            {reportPreview && <p className="truncate px-3.5 pb-2.5 text-xs text-primary-600 dark:text-primary-400">{reportPreview}</p>}
            {taskError && <div className="px-3.5 pb-2.5"><p role="alert" className="line-clamp-2 break-words text-xs text-danger">{taskError}</p></div>}
          </div>
        </div>
        <div id={detailsId} role="group" aria-label="Task details" aria-hidden={!expanded || undefined} inert={!expanded}
          className={cn(disclosureClassName, expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
          <div className="min-h-0 overflow-hidden">
            {hasOpened && <div className="space-y-2.5 px-2.5 pb-2.5 pt-0.5">
              {taskError && !errorInActivity && <p role="alert" className="min-w-0 break-words rounded-xl bg-primary-200/55 px-3 py-2.5 text-xs text-danger dark:bg-primary-950/45">{taskError}</p>}
              {(result || evidence.length > 0) && <AssistantCardSection title="Report" label="Task report" status={reportActivity && deliveryLabels[reportActivity.deliveryStatus]}>
                {result && <AgentMarkdown className="[&>.document-paragraph]:leading-5">{result}</AgentMarkdown>}
                {!!evidence.length && <ul aria-label="Task evidence" className={cn("text-xs text-primary-600 dark:text-primary-400", review ? "flex flex-wrap gap-x-3 gap-y-1" : "space-y-0.5")}>
                  {evidence.map((item, index) => <li key={index} className="break-words">{item}</li>)}
                </ul>}
                {reportActivity?.error && <p className="break-words text-xs text-danger">{errorText(reportActivity.error)}</p>}
              </AssistantCardSection>}
              {review && <AssistantCardSection title="Review scope">
                <p className="break-words text-xs">
                  {review.reference} <span aria-hidden="true">·</span> <code>{review.commit}</code>
                  {review.truncated && " · Partial diff"}
                </p>
              </AssistantCardSection>}
              {review?.focus && <AssistantCardSection title="Review focus">
                <p className="whitespace-pre-wrap break-words text-sm leading-5">{review.focus}</p>
              </AssistantCardSection>}
              {!review && task.prompt && !requestInActivity && <AssistantCardSection title="Task request">
                <p className="whitespace-pre-wrap break-words text-sm leading-5">{task.prompt}</p>
              </AssistantCardSection>}
              {!!activityRows.length && <ol aria-label="Task activity" className="space-y-2.5">
                {activityRows.map(item => {
                  const showMessage = item.kind !== "result" || item.content !== task.result;
                  return <AssistantCardSection key={item.id} as="li" title={activityLabels[item.kind]} status={deliveryLabels[item.deliveryStatus]}>
                    {(showMessage || item.error) ? <>
                      {showMessage && <AgentMarkdown className="[&>.document-paragraph]:leading-5">{item.kind === "status" ? errorText(item.content) : item.kind === "result" && review ? review.formatText(item.content) : item.content}</AgentMarkdown>}
                      {item.error && <p className="break-words text-xs text-danger">{errorText(item.error)}</p>}
                    </> : null}
                  </AssistantCardSection>;
                })}
              </ol>}
            </div>}
          </div>
        </div>
      </div>
      {canOpenChat && (
        <Button variant="secondary" className="self-end whitespace-nowrap px-2.5 text-xs focus-visible:ring-2 focus-visible:ring-accent"
          onClick={() => navigate(assistantHref(task.toAssistantId, workerRunId))}>
          Open chat
        </Button>
      )}
    </article>
  );
}
