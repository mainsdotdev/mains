import { describe, expect, it } from "vitest";
import type { RunEvent } from "../types";
import { prepareToolCalls } from "./group-tool-calls";

function tool(
  id: string,
  content: string,
  metadata?: Record<string, unknown>,
): RunEvent {
  return {
    id,
    type: "tool_call",
    content,
    timestamp: new Date(Number(id.replace(/\D/g, "")) * 1000),
    metadata,
  };
}

describe("prepareToolCalls", () => {
  it("keeps consecutive calls of the same tool as separate rows", () => {
    const events = [
      tool("t1", 'Bash: {"command":"npm test"}'),
      tool("t2", 'Bash: {"command":"npm run typecheck"}'),
      tool("t3", 'mcp__cua_repl__js: {"title":"Inspect result"}'),
    ];

    expect(prepareToolCalls(events).map((event) => event.id)).toEqual([
      "t1",
      "t2",
      "t3",
    ]);
  });

  it("still collapses consecutive edits to the same file into one cumulative edit", () => {
    const events = [
      tool("t1", "Edit", {
        toolName: "Edit",
        input: {
          file_path: "src/app.ts",
          old_string: "before",
          new_string: "middle",
        },
      }),
      tool("t2", "Edit", {
        toolName: "Edit",
        input: {
          file_path: "src/app.ts",
          old_string: "middle",
          new_string: "after",
        },
      }),
    ];

    const [edit] = prepareToolCalls(events);
    expect(prepareToolCalls(events)).toHaveLength(1);
    expect(edit.metadata?.input).toEqual({
      file_path: "src/app.ts",
      old_string: "before",
      new_string: "after",
    });
  });

  it("filters task-plan mutations from the transcript", () => {
    const events = [
      tool("t1", "TaskCreate: first step"),
      tool("t2", 'Bash: {"command":"npm test"}'),
    ];

    expect(prepareToolCalls(events).map((event) => event.id)).toEqual(["t2"]);
  });
});
