import { useNavigate } from "react-router-dom";
import { Button, AsciiSpinner } from "@/components/ui";
import { AgentMarkdown } from "@/components/agent-markdown";
import { useGetAccountQuery, useGetWorkspaceQuery } from "@/lib/redux/api";
import { useAssistantOverviewQuery, useAssistantAssignmentQuery } from "@/lib/redux/api/assistantsApi";
import { useAssistantUpdates } from "../hooks/use-assistant-updates";
import { assistantHref } from "../lib/assistant-navigation";
import { AssistantAvatar } from "./assistant-avatar";

export function AssistantTaskCard({ assignmentId, runId }: { assignmentId: string; runId?: string }) {
  useAssistantUpdates();
  const navigate = useNavigate();
  const { data: account } = useGetAccountQuery();
  const { currentData: overview } = useAssistantOverviewQuery(account?.id ?? "", { skip: !account });
  const { currentData: found, error, refetch } = useAssistantAssignmentQuery({ accountId: account?.id ?? "", id: assignmentId }, { skip: !account });
  const task = found?.fromRunId === runId ? found : undefined;
  const workspaceId = task?.execution.mode === "developer" ? task.execution.workspaceId : "";
  const { currentData: workspace } = useGetWorkspaceQuery(workspaceId, { skip: !workspaceId });
  const assistant = overview?.assistants.find(a => a.id === task?.toAssistantId);
  if (error) return <Button variant="ghost" onClick={() => void refetch()}>Retry assistant request</Button>;
  if (found === null) return <p className="py-3 text-xs text-primary-500">This assistant request is unavailable.</p>;
  if (!task) return <p className="py-3 text-xs text-primary-500">Loading assistant request…</p>;
  const running = task.status === "running" || task.status === "queued";
  return <article aria-label={`${assistant?.name ?? "Assistant"} task`} className="my-3 space-y-3 rounded-2xl border border-primary-200/70 p-4 text-primary-900 dark:border-primary-800/70 dark:text-primary-100">
    <div className="flex items-center gap-3"><AssistantAvatar avatar={assistant?.avatar} working={running} seed={task.toAssistantId} className="size-8" /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{assistant?.name ?? "Assistant"}</p><p className="flex items-center gap-1.5 text-xs capitalize text-primary-600 dark:text-primary-400">{running && <AsciiSpinner variant={assistant?.providerId === "codex" ? "codex" : "claude"} kind="circle" />}{task.status}{workspace ? ` · ${workspace.name}` : task.execution.mode === "work" ? " · Work" : ""}</p></div>
      {task.workerRunId && ["running", "blocked", "completed", "failed"].includes(task.status) && <Button variant="ghost" onClick={() => navigate(assistantHref(task.toAssistantId, task.workerRunId))}>Open chat</Button>}
    </div>
    {task.result ? <AgentMarkdown>{task.result}</AgentMarkdown> : <p className="text-sm text-primary-600 dark:text-primary-400">{task.prompt}</p>}
    {!!task.evidence.length && <div className="space-y-1">{task.evidence.map((item, i) => <p key={i} className="break-words text-xs text-primary-600 dark:text-primary-400">{item}</p>)}</div>}
    {task.error && <p role="alert" className="text-xs text-danger">{task.error}</p>}
  </article>;
}
