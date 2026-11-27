import { useRef, useState } from "react";
import type { Assistant, AssistantAssignment } from "@mains/contracts/assistants";
import { AssistantAssignmentCard } from "./assistant-assignment-card";
import { AssistantAssignmentForm } from "./assistant-assignment-form";
import { AssistantPanelEmptyState, AssistantPanelSection } from "./assistant-panel-section";

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
    <AssistantPanelSection label="Assignments" viewportRef={listViewport}
      action={creating ? undefined : { label: "New assignment", onClick: openForm }}
      actionRef={button => {
        if (!button || !restoreFocus.current) return;
        restoreFocus.current = false;
        button.focus({ preventScroll: true });
      }}>
      {creating && <AssistantAssignmentForm assistant={assistant} onClose={closeForm} onAssigned={closeForm} />}
      {!assignments.length && !creating && <AssistantPanelEmptyState>No assignments yet.</AssistantPanelEmptyState>}
      {!!assignments.length && (
        <ul aria-label="Assignment list" className="space-y-2">
          {assignments.map(task => (
            <li key={task.id}>
              <AssistantAssignmentCard task={task} assignee={assistants.find(candidate => candidate.id === task.toAssistantId)} openAssistant={openAssistant} />
            </li>
          ))}
        </ul>
      )}
    </AssistantPanelSection>
  );
}
