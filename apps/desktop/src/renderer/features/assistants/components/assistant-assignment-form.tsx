import { useId, useState, type FormEvent } from "react";
import type { Assistant, AssistantAssignment } from "@mains/contracts/assistants";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { useAssignAssistantTaskMutation } from "@/lib/redux/api/assistantsApi";
import { errorText } from "../lib/assistant-ui";

type AssignmentTarget = { assistant: Assistant; team?: never } | { assistant?: never; team: { id: string; mates: Assistant[] } };

export function AssistantAssignmentForm({ assistant, team, onClose, onAssigned }: AssignmentTarget & {
  onClose(): void;
  onAssigned(task: AssistantAssignment): void;
}) {
  const mateLabelId = useId();
  const [mateId, setMateId] = useState(team?.mates.length === 1 ? team.mates[0].id : "");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [failure, setFailure] = useState("");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [assign, assigning] = useAssignAssistantTaskMutation();
  const assignee = assistant ?? team?.mates.find(mate => mate.id === mateId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assignee || assigning.isLoading) return;
    setFailure("");
    try {
      const task = await assign({
        accountId: assignee.accountId, toAssistantId: assignee.id, ...(team && { expectedTeamId: team.id }),
        taskKey: requestKey, title, prompt, execution: { mode: "work" },
      }).unwrap();
      onAssigned(task);
    } catch (error) {
      setFailure(errorText(error));
    }
  }

  return <form aria-label="New assignment" onSubmit={submit} className="glass-card space-y-3.5 rounded-2xl p-3.5">
    {team && <div className="flex flex-col gap-1.5">
      <Label as="span" id={mateLabelId}>Assign to</Label>
      <Select aria-labelledby={mateLabelId} value={assignee?.id ?? ""} placeholder="Choose a Mate" disabled={assigning.isLoading}
        options={team.mates.map(mate => ({ value: mate.id, label: mate.name }))}
        onChange={id => { setMateId(id); setRequestKey(crypto.randomUUID()); }} />
    </div>}
    <label className="flex flex-col gap-1.5">
      <Label as="span">{assistant ? `Assign to ${assistant.name}` : "Assignment title"}</Label>
      <Input autoFocus placeholder="What needs to happen?" required maxLength={200} disabled={assigning.isLoading}
        value={title} onChange={event => { setTitle(event.target.value); setRequestKey(crypto.randomUUID()); }} />
    </label>
    <label className="flex flex-col gap-1.5">
      <Label as="span">Scope and completion criteria</Label>
      <Textarea className="min-h-24 rounded-2xl" required maxLength={24000} disabled={assigning.isLoading}
        value={prompt} onChange={event => { setPrompt(event.target.value); setRequestKey(crypto.randomUUID()); }} />
    </label>
    {failure && <p role="alert" className="text-sm text-danger">{failure}</p>}
    <div className="flex justify-end gap-2">
      <Button variant="ghost" disabled={assigning.isLoading} onClick={onClose}>Cancel</Button>
      <Button variant="primary" type="submit" disabled={!assignee} isLoading={assigning.isLoading}>Assign task</Button>
    </div>
  </form>;
}
