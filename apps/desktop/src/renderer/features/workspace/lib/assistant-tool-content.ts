import { coerceToolOutput } from "./parse-tool-content";

export const ASSISTANT_TOOL_LABELS: Record<string, string> = {
  ListAssistants: "Listed assistants",
  ListAssistantTasks: "Listed assistant assignments",
  ReadAssistantTask: "Read assistant assignment",
  AssignAssistantTask: "Assigned assistant task",
  ReportAssistantTask: "Reported assistant task",
  SendAssistantTaskMessage: "Sent assignment message",
  RecallAssistantMemory: "Recalled assistant memory",
  SaveAssistantMemory: "Saved assistant memory",
  ListAssistantConversations: "Listed assistant chats",
  ReadAssistantHistory: "Read assistant chat history",
  ListAssistantRoutines: "Listed assistant routines",
  ReadAssistantRoutine: "Read assistant routine",
  CreateAssistantRoutine: "Created assistant routine",
  UpdateAssistantRoutine: "Updated assistant routine",
  DeleteAssistantRoutine: "Deleted assistant routine",
};

/** Unwrap both Codex inputText blocks and MCP text-content envelopes. */
export function assistantToolResult(output: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  const value = coerceToolOutput(output);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (value.length && value.every(item => item && typeof item === "object" && ["text", "inputText"].includes(item.type) && typeof item.text === "string")) {
      const items = value.map(item => assistantToolResult(item.text, depth + 1));
      return items.length === 1 ? items[0] : items;
    }
    return value;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.structuredContent != null) return assistantToolResult(record.structuredContent, depth + 1);
    if (record.contentItems != null || record.content != null && Array.isArray(record.content) && record.content.every(item => item?.type === "text")) {
      return assistantToolResult(record.contentItems ?? record.content, depth + 1);
    }
  }
  return value;
}
