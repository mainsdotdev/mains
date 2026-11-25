import { coerceToolOutput } from "./parse-tool-content";

export const ASSISTANT_TOOL_LABELS: Record<string, string> = {
  AskAssistantQuestion: "Asked a question",
  ListAssistants: "Listed mates",
  ListAssistantTasks: "Listed mate assignments",
  ReadAssistantTask: "Read mate assignment",
  AssignAssistantTask: "Assigned mate task",
  ReportAssistantTask: "Reported mate task",
  SendAssistantTaskMessage: "Sent assignment message",
  RecallAssistantMemory: "Recalled mate memory",
  SaveAssistantMemory: "Saved mate memory",
  ListAssistantConversations: "Listed mate chats",
  ReadAssistantHistory: "Read mate chat history",
  ListAssistantRoutines: "Listed mate routines",
  ReadAssistantRoutine: "Read mate routine",
  CreateAssistantRoutine: "Created mate routine",
  UpdateAssistantRoutine: "Updated mate routine",
  DeleteAssistantRoutine: "Deleted mate routine",
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
