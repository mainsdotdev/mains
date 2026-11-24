import { useId, useState, type FormEvent } from "react";
import type { Assistant, AssistantAssignment } from "@mains/contracts/assistants";
import { AgentMarkdown } from "@/components/agent-markdown";
import { Button, Input } from "@/components/ui";
import { ArrowUp } from "@/components/ui/icons";
import { plainActivityText } from "@/features/workspace/lib/run-activity";
import { cn } from "@/lib/cn";
import { useCancelAssistantTaskMutation, useFollowupAssistantTaskMutation, useReconcileAssistantTaskMutation } from "@/lib/redux/api/assistantsApi";
import { assignmentDisplayTitle, errorText, pullRequestReviewPresentation } from "../lib/assistant-ui";
import { AssistantAvatar } from "./assistant-avatar";
import { AssistantCardSection } from "./assistant-card-section";
import { ArchivedMateBadge, AssignmentStatusBadge } from "./assignment-status-badge";

const disclosureClassName = "grid grid-cols-[minmax(0,1fr)] transition-[grid-template-rows,opacity] duration-250 ease-in-out motion-reduce:transition-none";

export function AssistantAssignmentCard({ task, assignee, openAssistant, initiallyExpanded = false, showBrief = true }: {
  task: AssistantAssignment;
  assignee?: Assistant;
  openAssistant(id: string, runId: string): void;
  initiallyExpanded?: boolean;
  showBrief?: boolean;
}) {
  const titleId = useId();
  const detailsId = useId();
  const previewId = useId();
  const [disclosure, setDisclosure] = useState<"unopened" | "open" | "closed">(initiallyExpanded ? "open" : "unopened");
  const expanded = disclosure === "open";
  const title = assignmentDisplayTitle(task.title, task.taskKey);
  const assigneeName = assignee?.name ?? "Mate";
  const review = pullRequestReviewPresentation(task);
  const brief = review ? review.focus : showBrief ? task.prompt : "";
  const preview = plainActivityText((review?.result ?? task.result) || brief).replace(/\s+/g, " ");

  return (
    <article aria-labelledby={titleId} className="glass-card min-w-0 rounded-2xl">
      <div className="p-1">
        <Button variant="bare" fullWidth aria-expanded={expanded} aria-controls={detailsId} aria-describedby={preview && !expanded ? previewId : undefined}
          onClick={() => setDisclosure(expanded ? "closed" : "open")}
          className="block min-w-0 rounded-xl px-2 py-1.5 text-left hover:bg-primary-300/20 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent dark:hover:bg-primary/5">
          <span className="flex min-w-0 items-center gap-2">
            <AssistantAvatar avatar={assignee?.avatar} seed={task.toAssistantId} animated={false} className={cn("size-5", assignee?.isArchived && "grayscale")} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium" id={titleId} title={title}>{title}</span>
            <AssignmentStatusBadge status={task.status} />
            <ArrowUp aria-hidden="true" className={cn("size-3.5 shrink-0 text-primary-500 transition-transform duration-250 ease-in-out motion-reduce:transition-none", expanded ? "rotate-180" : "rotate-90")} />
          </span>
          <span className="mt-1.5 flex min-w-0 items-baseline gap-1.5 pl-7 text-xs text-primary-600 dark:text-primary-400">
            <span className="max-w-[45%] shrink-0 truncate">{assigneeName}</span>
            {assignee?.isArchived && <ArchivedMateBadge />}
            {preview && <span aria-hidden="true" className={cn(disclosureClassName, "min-w-0", expanded ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100")}>
              <span className="min-h-0 overflow-hidden">
                <span className="block truncate"><span aria-hidden="true">· </span><span id={previewId}>{preview}</span></span>
              </span>
            </span>}
          </span>
        </Button>
      </div>
      <div id={detailsId} role="group" aria-label="Assignment details" inert={!expanded} aria-hidden={!expanded || undefined}
        className={cn(disclosureClassName, expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
        <div className="min-h-0 overflow-hidden">
          {disclosure !== "unopened" && (
            <div className="px-2.5 pb-2.5 pt-0.5">
              <AssistantAssignmentDetails task={task} openAssistant={openAssistant} showBrief={showBrief} />
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function AssistantAssignmentDetails({ task, openAssistant, showBrief = true }: {
  task: AssistantAssignment;
  openAssistant?(id: string, runId: string): void;
  showBrief?: boolean;
}) {
  const review = pullRequestReviewPresentation(task);
  const result = review?.result ?? task.result;
  const evidence = review?.evidence ?? task.evidence;
  const canCancel = !["completed", "failed", "canceled"].includes(task.status);
  const canCheckDelivery = task.status === "uncertain" || (task.status === "completed" && !!task.error);

  return <div className="min-w-0 space-y-2.5">
    {!review && showBrief && <AssistantCardSection title="Task brief">
      <p className="whitespace-pre-wrap break-words text-sm leading-5">{task.prompt}</p>
    </AssistantCardSection>}
    {(result || evidence.length > 0) && (
      <AssistantCardSection title="Report">
        {result && <AgentMarkdown className="[&>.document-paragraph]:leading-5">{result}</AgentMarkdown>}
        {!!evidence.length && <ul aria-label="Task evidence" className={cn("text-xs text-primary-600 dark:text-primary-400", review ? "flex flex-wrap gap-x-3 gap-y-1" : "space-y-0.5")}>
          {evidence.map((entry, index) => <li key={index} className="break-words">{entry}</li>)}
        </ul>}
      </AssistantCardSection>
    )}
    {review?.focus && <AssistantCardSection title="Review focus">
      <p className="whitespace-pre-wrap break-words text-sm leading-5">{review.focus}</p>
    </AssistantCardSection>}
    {(task.error || task.status === "blocked") && (
      <AssistantCardSection title="Status details">
        {task.error && <p className="break-words text-sm leading-5">{errorText(task.error)}</p>}
        {task.status === "blocked" && <AssignmentFollowup task={task} />}
      </AssistantCardSection>
    )}
    {(task.workerRunId && openAssistant || canCheckDelivery || canCancel) && (
      <AssignmentActions task={task} openAssistant={openAssistant} canCheckDelivery={canCheckDelivery} canCancel={canCancel} />
    )}
  </div>;
}

function AssignmentActions({ task, openAssistant, canCheckDelivery, canCancel }: {
  task: AssistantAssignment;
  openAssistant?(id: string, runId: string): void;
  canCheckDelivery: boolean;
  canCancel: boolean;
}) {
  const [cancel, canceling] = useCancelAssistantTaskMutation();
  const [reconcile, reconciling] = useReconcileAssistantTaskMutation();
  const [failure, setFailure] = useState("");
  const busy = canceling.isLoading || reconciling.isLoading;
  const workerRunId = task.workerRunId;

  function run(operation: Promise<unknown>) {
    setFailure("");
    void operation.catch(error => setFailure(errorText(error)));
  }

  return (
    <div className="space-y-2">
      {failure && <p role="alert" className="px-1 text-sm text-danger">{failure}</p>}
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {canCancel && <Button variant="ghost" disabled={busy}
          onClick={() => run(cancel({ accountId: task.accountId, id: task.id }).unwrap())}>Cancel task</Button>}
        {canCheckDelivery && <Button variant="primary" disabled={busy}
          onClick={() => run(reconcile({ accountId: task.accountId, id: task.id }).unwrap())}>Check delivery</Button>}
        {workerRunId && openAssistant && <Button variant="secondary" onClick={() => openAssistant(task.toAssistantId, workerRunId)}>Open chat</Button>}
      </div>
    </div>
  );
}

function AssignmentFollowup({ task }: { task: AssistantAssignment }) {
  const [followup, following] = useFollowupAssistantTaskMutation();
  const [message, setMessage] = useState("");
  const [request, setRequest] = useState<{ message: string; messageId: string } | null>(null);
  const [failure, setFailure] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (following.isLoading) return;
    setFailure("");
    const input = request ?? { message, messageId: crypto.randomUUID() };
    setRequest(input);
    try {
      await followup({ accountId: task.accountId, id: task.id, ...input }).unwrap();
      setRequest(null);
      setMessage("");
    } catch (error) {
      setFailure(errorText(error));
    }
  }

  return (
    <form className="space-y-2 pt-1" onSubmit={submit}>
      <div className="flex items-stretch gap-2">
        <Input required maxLength={24000} aria-label="Task follow-up" placeholder="Add the missing information…" className="w-auto flex-1"
          value={request?.message ?? message} disabled={!!request || following.isLoading} onChange={event => setMessage(event.target.value)} />
        <Button type="submit" variant="primary" className="shrink-0 whitespace-nowrap" disabled={following.isLoading}>
          {request ? "Check delivery" : "Continue"}
        </Button>
      </div>
      {failure && <p role="alert" className="text-sm text-danger">{failure}</p>}
    </form>
  );
}
