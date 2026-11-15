import { useState, type FormEvent } from "react";
import type { Assistant, AssistantMemory } from "@mains/contracts/assistants";
import { useSaveAssistantMemoryMutation, useRemoveAssistantMemoryMutation } from "@/lib/redux/api/assistantsApi";
import { Button, Checkbox, Input, NativeSelect, Textarea } from "@/components/ui";
import { AgentMarkdown } from "@/components/agent-markdown";
import { control, errorText } from "../lib/assistant-ui";
export function AssistantMemoryPanel({ assistant, memories }: {
    assistant: Assistant;
    memories: AssistantMemory[];
}) {
    const [editing, setEditing] = useState<AssistantMemory | null>(null);
    const [creating, setCreating] = useState(false);
    const [id, setId] = useState("");
    const [title, setTitle] = useState("");
    const [content, setContent] = useState("");
    const [scope, setScope] = useState("team");
    const [pinned, setPinned] = useState(false);
    const [failure, setFailure] = useState("");
    const [save, saving] = useSaveAssistantMemoryMutation();
    const [remove, removing] = useRemoveAssistantMemoryMutation();
    const visible = memories.filter(m => m.teamId === assistant.teamId && (!m.assistantId || m.assistantId === assistant.id));
    const open = (memory: AssistantMemory | null) => {
        setEditing(memory);
        setCreating(!memory);
        setId(memory?.id ?? crypto.randomUUID());
        setTitle(memory?.title ?? "");
        setContent(memory?.content ?? "");
        setScope(memory?.assistantId ? "assistant" : "team");
        setPinned(memory?.pinned ?? false);
        setFailure("");
    };
    async function submit(event: FormEvent) {
        event.preventDefault();
        setFailure("");
        try {
            await save({ id, accountId: assistant.accountId, teamId: assistant.teamId, assistantId: scope === "team" ? null : assistant.id, title, content, pinned,
                ...(editing ? { expectedRevision: editing.revision } : {}),
            }).unwrap();
            setCreating(false);
            setEditing(null);
        }
        catch (error) {
            setFailure(errorText(error));
        }
    }
    async function forget(memory: AssistantMemory) {
        setFailure("");
        try {
            await remove({ accountId: assistant.accountId, id: memory.id, revision: memory.revision }).unwrap();
        }
        catch (error) {
            setFailure(errorText(error));
        }
    }
    return <section className="space-y-5" aria-label="Assistant memory">
    <div className="flex items-center justify-between"><div><h2 className="text-lg font-medium">What the team knows</h2><p className="mt-1 text-sm text-primary-500">Shared decisions and this assistant’s private notes, with their sources.</p></div><Button variant="ghost" onClick={() => open(null)}>Add memory</Button></div>
    {(creating || editing) && <form onSubmit={submit} className="glass-card space-y-3 rounded-2xl p-5">
      <label className="block text-sm">Title<Input className={`${control} mt-1`} required maxLength={200} value={title} onChange={e => setTitle(e.target.value)}/></label>
      <label className="block text-sm">Memory<Textarea className={`${control} mt-1 min-h-28`} required maxLength={6000} value={content} onChange={e => setContent(e.target.value)}/></label>
      <div className="flex flex-wrap items-center gap-4"><label className="text-sm">Visible to<NativeSelect className={`${control} mt-1`} value={scope} disabled={!!editing} onChange={e => setScope(e.target.value)}><option value="team">Whole team</option><option value="assistant">Only {assistant.name}</option></NativeSelect></label><label className="flex items-center gap-2 text-sm"><Checkbox checked={pinned} onChange={setPinned}/>Keep in context</label></div>
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => { setCreating(false); setEditing(null); }}>Cancel</Button><Button type="submit" variant="submit" disabled={saving.isLoading}>Save memory</Button></div>
    </form>}
    {failure && <p role="alert" className="text-sm text-danger">{failure}</p>}
    {!visible.length && !creating && <div className="rounded-2xl border border-dashed border-primary-300 px-6 py-12 text-center text-sm text-primary-500 dark:border-primary-700">Save the first decision you want this team to remember.</div>}
    {visible.map(memory => <article key={memory.id} className="glass-card rounded-2xl p-5">
      <div className="mb-3 flex items-start justify-between gap-4"><div><div className="mb-1 text-xs text-primary-500">{memory.assistantId ? "Private note" : "Team memory"}{memory.pinned ? " · Kept in context" : ""}</div><h3 className="font-medium">{memory.title}</h3></div><div className="flex gap-1"><Button variant="ghost" onClick={() => open(memory)}>Edit</Button><Button variant="ghost" disabled={removing.isLoading} onClick={() => void forget(memory)}>Remove</Button></div></div>
      <AgentMarkdown>{memory.content}</AgentMarkdown>
      <p className="mt-4 text-xs text-primary-500">Revision {memory.revision} · {memory.updatedAt.toLocaleDateString()}{memory.sourceRunId ? ` · Source conversation ${memory.sourceRunId.slice(0, 8)}` : " · Added by you"}</p>
    </article>)}
  </section>;
}
