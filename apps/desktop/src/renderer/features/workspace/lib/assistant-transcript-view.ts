import { readAssistantTaskInput } from "@mains/contracts/assistants";
import type { EventGroup } from "./group-events";
import type { RunEvent } from "../types";

function isConversationEvent(event: RunEvent): boolean {
  if (event.type === "artifact") {
    // Questions are answered in ComposerSlot. Their tool/receipt cards do not
    // belong in the conversation after the interaction has finished.
    if (event.metadata?.source === "codex_async_questions") return false;
    if (event.metadata?.outputSelected !== true && (event.metadata?.working === true || event.metadata?.viewed === true)) return false;
    const taskInput = readAssistantTaskInput(event.metadata?.assistantTaskInput);
    return !taskInput || taskInput.kind === "request";
  }
  // Keep failures actionable while omitting provider lifecycle diagnostics.
  if (event.type === "log") return event.metadata?.level === "warn" || event.metadata?.level === "error";
  return event.type === "tool_call" && !!event.metadata?.mcpApp;
}

/** Presentation only: the full transcript still backs tools, questions and history. */
export function assistantTranscriptGroups(groups: EventGroup[]): EventGroup[] {
  return groups.flatMap(group => {
    if (group.type === "tool_calls" || group.type === "context_compaction") return [];
    const events = group.events.filter(isConversationEvent);
    if (!events.length) return [];
    return events.length === group.events.length ? [group] : [{ ...group, events,
      startTime: events[0].timestamp, endTime: events[events.length - 1].timestamp }];
  });
}

/** A new action retires the previous text stream's writing indicator. */
export function isAssistantReplyStreaming(events: RunEvent[]): boolean {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event.metadata?.isFromSubagent || event.metadata?.parentToolCallId) continue;
    if (event.type === "tool_call") return false;
    if (event.type !== "artifact") continue;
    if (event.metadata?.kind === "user-prompt" || event.metadata?.kind === "thinking") return false;
    if (event.metadata?.kind === "report" && event.metadata?.source !== "codex_async_questions" && event.content.trim())
      return event.metadata.streaming === true;
  }
  return false;
}
