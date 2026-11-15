import { useState, type FormEvent } from "react";
import type { Assistant, AssistantAssignment } from "@mains/contracts/assistants";
import { useAssignAssistantTaskMutation, useCancelAssistantTaskMutation, useReconcileAssistantTaskMutation, useFollowupAssistantTaskMutation } from "@/lib/redux/api/assistantsApi";
import { Button, Input, Textarea } from "@/components/ui";
import { AgentMarkdown } from "@/components/agent-markdown";
import { control, errorText } from "../lib/assistant-ui";
const activeTask = (task: AssistantAssignment) => !["completed", "failed", "canceled"].includes(task.status);
export function AssistantAssignments({ assistant, assignments, assistants, openAssistant }: {
    assistant: Assistant;
    assignments: AssistantAssignment[];
    assistants: Assistant[];
    openAssistant(id: string, runId?: string | null): void;
}) {
    const [title, setTitle] = useState("");
    const [prompt, setPrompt] = useState("");
    const [failure, setFailure] = useState("");
    const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
    const [assign, assigning] = useAssignAssistantTaskMutation();
    const [cancel, canceling] = useCancelAssistantTaskMutation();
    const [reconcile, reconciling] = useReconcileAssistantTaskMutation();
    async function submit(event: FormEvent) { event.preventDefault(); setFailure(""); try {
        await assign({ accountId: assistant.accountId, toAssistantId: assistant.id, taskKey: requestKey, title, prompt }).unwrap();
        setTitle("");
        setPrompt("");
        setRequestKey(crypto.randomUUID());
    }
    catch (error) {
        setFailure(errorText(error));
    } }
    const run = (operation: Promise<unknown>) => { setFailure(""); void operation.catch(e => setFailure(errorText(e))); };
    return <section className="space-y-5" aria-label="Team assignments"><div><h2 className="text-lg font-medium">Work, with an owner</h2><p className="mt-1 text-sm text-primary-500">Your team’s assignments and their reported results.</p></div>
    <form onSubmit={submit} className="glass-card space-y-3 rounded-2xl p-5"><label className="block text-sm">Assign to {assistant.name}<Input className={`${control} mt-1`} placeholder="What needs to happen?" required maxLength={200} value={title} onChange={e => { setTitle(e.target.value); setRequestKey(crypto.randomUUID()); }}/></label><label className="block text-sm">Scope and completion criteria<Textarea className={`${control} mt-1 min-h-24`} required maxLength={24000} value={prompt} onChange={e => { setPrompt(e.target.value); setRequestKey(crypto.randomUUID()); }}/></label><div className="flex justify-end"><Button variant="submit" type="submit" disabled={assigning.isLoading}>Assign task</Button></div></form>
    {failure && <p role="alert" className="text-sm text-danger">{failure}</p>}
    {!assignments.length && <p className="py-8 text-center text-sm text-primary-500">Assignments will appear here as your team works together.</p>}
    {assignments.map(task => <article key={task.id} className="glass-card rounded-2xl p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="mb-1 text-xs text-primary-500">{assistants.find(a => a.id === task.toAssistantId)?.name} · {task.status}</p><h3 className="font-medium">{task.title}</h3></div><div className="flex flex-wrap gap-1">{task.workerRunId && <Button variant="ghost" onClick={() => openAssistant(task.toAssistantId, task.workerRunId)}>Open chat</Button>}{(task.status === "uncertain" || task.status === "completed" && !!task.error) && <Button variant="ghost" disabled={reconciling.isLoading} onClick={() => run(reconcile({ accountId: assistant.accountId, id: task.id }).unwrap())}>Check delivery</Button>}{activeTask(task) && <Button variant="ghost" disabled={canceling.isLoading} onClick={() => run(cancel({ accountId: assistant.accountId, id: task.id }).unwrap())}>Cancel</Button>}</div></div><details className="mt-3 text-sm"><summary className="cursor-pointer text-primary-500">Task brief</summary><p className="mt-2 whitespace-pre-wrap">{task.prompt}</p></details>{task.result && <div className="mt-4 border-t border-primary-200 pt-4 dark:border-primary-800"><AgentMarkdown>{task.result}</AgentMarkdown>{task.evidence.map((e, i) => <p key={i} className="mt-2 break-all text-xs text-primary-500">{e}</p>)}</div>}{task.error && <p className="mt-3 text-sm text-danger">{task.error}</p>}{task.status === "blocked" && <AssignmentFollowup task={task}/>}</article>)}
  </section>;
}
function AssignmentFollowup({ task }: {
    task: AssistantAssignment;
}) {
    const [followup, following] = useFollowupAssistantTaskMutation();
    const [message, setMessage] = useState("");
    const [request, setRequest] = useState<{
        message: string;
        messageId: string;
    } | null>(null);
    const [error, setError] = useState("");
    return <form className="mt-3 space-y-2" onSubmit={e => {
            e.preventDefault();
            setError("");
            const input = request ?? { message, messageId: crypto.randomUUID() };
            setRequest(input);
            void followup({ accountId: task.accountId, id: task.id, ...input }).unwrap().then(() => { setRequest(null); setMessage(""); }).catch(e => setError(errorText(e)));
        }}><div className="flex gap-2"><Input required maxLength={24000} aria-label="Task follow-up" placeholder="Add the missing information…" className={control} value={request?.message ?? message} disabled={!!request || following.isLoading} onChange={e => setMessage(e.target.value)}/><Button type="submit" variant="ghost" disabled={following.isLoading}>{request ? "Check delivery" : "Continue"}</Button></div>{error && <p role="alert" className="text-sm text-danger">{error}</p>}</form>;
}
