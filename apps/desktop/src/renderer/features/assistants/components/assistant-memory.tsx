import { useId, useState, type FormEvent } from "react";
import type { Assistant, AssistantMemory } from "@mains/contracts/assistants";
import { useSaveAssistantMemoryMutation, useRemoveAssistantMemoryMutation } from "@/lib/redux/api/assistantsApi";
import { Button, Checkbox, Input, Label, Select, Textarea } from "@/components/ui";
import { AgentMarkdown } from "@/components/agent-markdown";
import { errorText } from "../lib/assistant-ui";
import { AssistantPanelEmptyState, AssistantPanelSection } from "./assistant-panel-section";

export function AssistantMemoryPanel({ assistant, memories }: {
    assistant: Assistant;
    memories: AssistantMemory[];
}) {
    const visibilityLabelId = useId();
    const [editing, setEditing] = useState<AssistantMemory | null>(null);
    const [creating, setCreating] = useState(false);
    const [id, setId] = useState("");
    const [title, setTitle] = useState("");
    const [content, setContent] = useState("");
    const [scope, setScope] = useState("assistant");
    const [pinned, setPinned] = useState(false);
    const [failure, setFailure] = useState("");
    const [save, saving] = useSaveAssistantMemoryMutation();
    const [remove, removing] = useRemoveAssistantMemoryMutation();
    const visible = memories.filter(m => m.accountId === assistant.accountId &&
        (m.assistantId ? m.assistantId === assistant.id : m.teamId !== null && m.teamId === assistant.teamId));
    const open = (memory: AssistantMemory | null) => {
        setEditing(memory);
        setCreating(!memory);
        setId(memory?.id ?? crypto.randomUUID());
        setTitle(memory?.title ?? "");
        setContent(memory?.content ?? "");
        setScope(!assistant.teamId || memory?.assistantId ? "assistant" : "team");
        setPinned(memory?.pinned ?? false);
        setFailure("");
    };
    async function submit(event: FormEvent) {
        event.preventDefault();
        setFailure("");
        try {
            await save({ id, accountId: assistant.accountId, teamId: assistant.teamId, assistantId: assistant.teamId && scope === "team" ? null : assistant.id, title, content, pinned,
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
    return <AssistantPanelSection label="Mate memory" action={{ label: "Add memory", onClick: () => open(null) }}>
    {(creating || editing) && <form onSubmit={submit} className="glass-card space-y-3.5 rounded-2xl p-3.5">
      <label className="flex flex-col gap-1.5">
        <Label as="span">Title</Label>
        <Input required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1.5">
        <Label as="span">Memory</Label>
        <Textarea className="min-h-28 rounded-2xl" required maxLength={6000} value={content} onChange={e => setContent(e.target.value)} />
      </label>
      {assistant.teamId && <div className="flex flex-col gap-1.5">
        <Label as="span" id={visibilityLabelId}>Visible to</Label>
        <Select aria-labelledby={visibilityLabelId} value={scope} disabled={!!editing} onChange={setScope}
          options={[{ value: "team", label: "Whole team" }, { value: "assistant", label: `Only ${assistant.name}` }]} />
      </div>}
      <label className="flex items-center gap-2.5">
        <Checkbox checked={pinned} onChange={setPinned} />
        <Label as="span">Keep in context</Label>
      </label>
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => { setCreating(false); setEditing(null); }}>Cancel</Button><Button type="submit" variant="primary" isLoading={saving.isLoading}>Save memory</Button></div>
    </form>}
    {failure && <p role="alert" className="text-sm text-danger">{failure}</p>}
    {!visible.length && !creating && <AssistantPanelEmptyState>Save something you want {assistant.teamId ? "this team" : assistant.name} to remember.</AssistantPanelEmptyState>}
    {visible.map(memory => <article key={memory.id} className="glass-card rounded-2xl p-5">
      <div className="mb-3 flex items-start justify-between gap-4"><div><div className="mb-1 text-xs text-primary-500">{memory.assistantId ? "Private note" : "Team memory"}{memory.pinned ? " · Kept in context" : ""}</div><h3 className="font-medium">{memory.title}</h3></div><div className="flex gap-1"><Button variant="ghost" onClick={() => open(memory)}>Edit</Button><Button variant="ghost" disabled={removing.isLoading} onClick={() => void forget(memory)}>Remove</Button></div></div>
      <AgentMarkdown>{memory.content}</AgentMarkdown>
      <p className="mt-4 text-xs text-primary-500">Revision {memory.revision} · {memory.updatedAt.toLocaleDateString()}{memory.sourceRunId ? ` · Source conversation ${memory.sourceRunId.slice(0, 8)}` : " · Added by you"}</p>
    </article>)}
  </AssistantPanelSection>;
}
