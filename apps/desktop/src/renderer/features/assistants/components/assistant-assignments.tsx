import { useRef, useState, type FormEvent } from "react";
import type { Assistant, AssistantAssignment } from "@mains/contracts/assistants";
import { useAssignAssistantTaskMutation } from "@/lib/redux/api/assistantsApi";
import { Button, Input, Label, Textarea } from "@/components/ui";
import { Plus } from "@/components/ui/icons";
import { errorText } from "../lib/assistant-ui";
import { AssistantAssignmentCard } from "./assistant-assignment-card";

export function AssistantAssignments({ assistant, assignments, assistants, openAssistant }: {
  assistant: Assistant;
  assignments: AssistantAssignment[];
  assistants: Assistant[];
  openAssistant(id: string, runId?: string | null): void;
}) {
  const [creating, setCreating] = useState(false);
  const restoreFocus = useRef(false);
  const listViewport = useRef<HTMLDivElement>(null);

  function openForm() {
    if (listViewport.current) listViewport.current.scrollTop = 0;
    setCreating(true);
  }

  function closeForm() {
    restoreFocus.current = true;
    setCreating(false);
  }

  return (
    <section aria-label="Assignments" className="flex min-h-0 flex-1 flex-col">
      {!creating && (
        <div className="flex shrink-0 justify-end px-5 pt-2">
          <Button variant="primary" className="inline-flex items-center gap-2" onClick={openForm}
            ref={button => {
              if (!button || !restoreFocus.current) return;
              restoreFocus.current = false;
              button.focus({ preventScroll: true });
            }}>
            <Plus aria-hidden="true" className="size-3.5" />
            New assignment
          </Button>
        </div>
      )}
      <div ref={listViewport} className="scroll-bounce min-h-0 flex-1 space-y-3 overflow-y-auto scroll-pt-4 px-5 pb-6 pt-4 [mask-image:linear-gradient(to_bottom,transparent,black_1rem)]">
        {creating && <AssignmentForm assistant={assistant} onClose={closeForm} />}
        {!assignments.length && !creating && (
          <p className="rounded-2xl glass-card px-3 py-6 text-center text-sm text-primary-600 dark:text-primary-400">No assignments yet.</p>
        )}
        {!!assignments.length && (
          <ul aria-label="Assignment list" className="space-y-2">
            {assignments.map(task => (
              <li key={task.id}>
                <AssistantAssignmentCard task={task} assignee={assistants.find(candidate => candidate.id === task.toAssistantId)} openAssistant={openAssistant} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function AssignmentForm({ assistant, onClose }: { assistant: Assistant; onClose(): void }) {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [failure, setFailure] = useState("");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [assign, assigning] = useAssignAssistantTaskMutation();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (assigning.isLoading) return;
    setFailure("");
    try {
      await assign({ accountId: assistant.accountId, toAssistantId: assistant.id, taskKey: requestKey, title, prompt, execution: { mode: "work" } }).unwrap();
      onClose();
    } catch (error) {
      setFailure(errorText(error));
    }
  }

  return (
    <form aria-label="New assignment" onSubmit={submit} className="glass-card space-y-3.5 rounded-2xl p-3.5">
      <label className="flex flex-col gap-1.5">
        <Label as="span">Assign to {assistant.name}</Label>
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
        <Button variant="primary" type="submit" isLoading={assigning.isLoading}>Assign task</Button>
      </div>
    </form>
  );
}
