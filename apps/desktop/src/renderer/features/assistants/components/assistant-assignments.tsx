import { useRef, useState } from "react";
import type { Assistant, AssistantAssignment } from "@mains/contracts/assistants";
import { Button } from "@/components/ui";
import { Plus } from "@/components/ui/icons";
import { AssistantAssignmentCard } from "./assistant-assignment-card";
import { AssistantAssignmentForm } from "./assistant-assignment-form";

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
        {creating && <AssistantAssignmentForm assistant={assistant} onClose={closeForm} onAssigned={closeForm} />}
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
