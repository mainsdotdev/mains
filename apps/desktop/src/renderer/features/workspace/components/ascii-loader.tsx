import { AsciiSpinner, Text } from "@/components/ui";
import type { RunEvent } from "../types";
import { resolveTool } from "../lib/resolve-tool";
import { coerceToolOutput, parseToolContent, previewParams } from "../lib/parse-tool-content";
import { shortFileName } from "../lib/path-utils";
import { toPresentTense } from "./tools/_shared";

export { AsciiSpinner };

/** Strip markdown formatting for plain-text display */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")  // **bold**
    .replace(/\*(.+?)\*/g, "$1")       // *italic*
    .replace(/__(.+?)__/g, "$1")       // __bold__
    .replace(/_(.+?)_/g, "$1")         // _italic_
    .replace(/`(.+?)`/g, "$1")         // `code`
    .replace(/^#+\s*/gm, "");          // # headings
}

const TOOL_ACTIONS: Record<string, string> = {
  read: "Reading",
  edit: "Editing",
  write: "Writing",
  create: "Creating",
  delete: "Deleting",
  apply_patch: "Applying patch",
  bash: "Running",
  shell: "Running",
  sql: "Querying",
  glob: "Searching files",
  grep: "Searching",
  search: "Searching",
  websearch: "Searching the web",
  webfetch: "Fetching",
  toolsearch: "Searching tools",
  imageview: "Viewing",
  view: "Viewing",
  skill: "Using skill",
  agent: "Running agent",
  task: "Running task",
  workflow: "Running workflow",
  askuserquestion: "Waiting for input",
  "task-plan": "Updating plan",
};

const FILE_TOOLS = new Set(["read", "edit", "write", "create", "delete", "imageview", "view"]);

function ToolActivity({ event }: { event: RunEvent }) {
  const parsed = parseToolContent(event.content);
  const resolved = resolveTool(typeof event.metadata?.toolName === "string"
    ? event.metadata.toolName : parsed.toolName);
  const rawInput = coerceToolOutput(event.metadata?.input);
  const params = rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
    ? rawInput as Record<string, unknown> : parsed.params;
  const filePath = params?.file_path ?? params?.path ?? params?.filePath;
  const detail = FILE_TOOLS.has(resolved.groupKey) && typeof filePath === "string"
    ? shortFileName(filePath)
    : previewParams(params) || (parsed.summary !== parsed.toolName ? parsed.summary : "");
  const action = TOOL_ACTIONS[resolved.groupKey] ??
    (resolved.vendorId ? toPresentTense(resolved.displayName) : `Using ${resolved.displayName}`);

  return (
    <>
      <span className="shrink-0 text-primary-500">{resolved.icon}</span>
      <Text as="span" size="sm" tone="inherit" className="shine-text min-w-0 truncate max-w-120">
        {action}{detail ? ` ${detail}` : ""}
      </Text>
    </>
  );
}

export function AsciiLoader({
  className,
  thinkingText,
  activeTool,
}: {
  className?: string;
  variant?: "claude" | "copilot" | "codex" | "cursor";
  thinkingText?: string;
  activeTool?: RunEvent;
}) {
  return (
    <div className={`flex min-w-0 items-center gap-2 ${className || ""}`}>
      {activeTool ? <ToolActivity event={activeTool} /> : (
        <Text as="span" size="sm" tone="inherit" className="shine-text truncate max-w-120">
          {thinkingText ? stripMarkdown(thinkingText) : "Thinking"}
        </Text>
      )}
    </div>
  );
}
