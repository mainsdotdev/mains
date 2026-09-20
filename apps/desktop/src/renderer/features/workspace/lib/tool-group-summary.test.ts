import { describe, it, expect } from "vitest";
import { summarizeToolCalls } from "./tool-group-summary";
import type { RunEvent } from "../types";

function call(id: string, content: string): RunEvent {
  return {
    id,
    type: "tool_call",
    content,
    timestamp: new Date(0),
    metadata: { toolName: content.split(":")[0] },
  };
}

describe("summarizeToolCalls", () => {
  it("counts each kind of work once, in sentence form", () => {
    expect(
      summarizeToolCalls([
        call("t1", "Edit: {}"),
        call("t2", "Bash: {}"),
        call("t3", "Bash: {}"),
      ]),
    ).toBe("Edited a file, ran commands");
  });

  // Ordering by rank, not by arrival: a group that streams Bash in last must
  // not reshuffle the clauses in front of it on every new call.
  it("orders clauses by rank rather than by when the call happened", () => {
    const order = summarizeToolCalls([
      call("t1", "Bash: {}"),
      call("t2", "Read: {}"),
      call("t3", "Edit: {}"),
    ]);
    const reverse = summarizeToolCalls([
      call("t1", "Edit: {}"),
      call("t2", "Read: {}"),
      call("t3", "Bash: {}"),
    ]);

    expect(order).toBe("Edited a file, read a file, ran a command");
    expect(reverse).toBe(order);
  });

  // The same tool returning later is the same work, not a new clause.
  it("merges a kind of work that appears more than once", () => {
    expect(
      summarizeToolCalls([
        call("t1", "Bash: {}"),
        call("t2", "Edit: {}"),
        call("t3", "Bash: {}"),
      ]),
    ).toBe("Edited a file, ran commands");
  });

  it("names the integrations once instead of per call", () => {
    expect(
      summarizeToolCalls([
        call("t1", "mcp__cua_repl__js: {}"),
        call("t2", "mcp__cua_repl__js: {}"),
        call("t3", "Bash: {}"),
      ]),
    ).toBe("Used the Computer use integration, ran a command");
  });

  it("lists several integrations in one clause", () => {
    const summary = summarizeToolCalls([
      call("t1", "mcp__cua_repl__js: {}"),
      call("t2", "mcp__linear__list_issues: {}"),
    ]);

    expect(summary).toBe("Used the Computer use and Linear integrations");
  });

  it("limits the summary to three kinds of work", () => {
    expect(
      summarizeToolCalls([
        call("t1", "Edit: {}"),
        call("t2", "Read: {}"),
        call("t3", "Glob: {}"),
        call("t4", "WebSearch: {}"),
        call("t5", "Bash: {}"),
      ]),
    ).toBe("Edited a file, read a file, looked for files");
  });

  // An unregistered tool must still reach the header — duller, never missing.
  it("falls back to the tool's own label", () => {
    expect(summarizeToolCalls([call("t1", "Frobnicate: {}")])).toBe(
      "Used Frobnicate",
    );
  });

  it("returns an empty string for no calls", () => {
    expect(summarizeToolCalls([])).toBe("");
  });
});
