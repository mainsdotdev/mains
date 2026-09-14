import { describe, it, expect } from "vitest";
import {
  buildSubagentFlow,
  selectSubagentReport,
  toMs,
  type FlowToolCall,
} from "./subagent-flow";

function call(partial: Partial<FlowToolCall> & { id: number }): FlowToolCall {
  return {
    toolName: "Read",
    status: "done",
    toolCallId: null,
    parentToolCallId: null,
    input: null,
    createdAt: 100,
    ...partial,
  };
}

describe("buildSubagentFlow", () => {
  it("includes only children anchored to the spawn call", () => {
    const flow = buildSubagentFlow({
      subagentId: "toolu_spawn",
      toolCalls: [
        call({ id: 1, toolCallId: "toolu_spawn", toolName: "Agent" }),
        call({ id: 2, parentToolCallId: "toolu_spawn", toolName: "Bash" }),
        call({ id: 3, parentToolCallId: "other_agent", toolName: "Grep" }),
        call({ id: 4, toolName: "Read" }),
      ],
      artifacts: [],
    });

    expect(flow.map((item) => item.key)).toEqual(["tool-2"]);
  });

  it("folds SendMessage continuations in: prompt + their children + messages", () => {
    const flow = buildSubagentFlow({
      subagentId: "toolu_spawn",
      agentId: "agent-1",
      toolCalls: [
        call({ id: 2, parentToolCallId: "toolu_spawn", toolName: "Bash", createdAt: 100 }),
        call({
          id: 5,
          toolName: "SendMessage",
          toolCallId: "toolu_send",
          createdAt: 200,
          input: { to: "agent-1", message: "Re-check the diff" },
        }),
        call({ id: 6, parentToolCallId: "toolu_send", toolName: "Grep", createdAt: 300 }),
        // Addressed to a DIFFERENT agent — must not leak into this flow.
        call({
          id: 7,
          toolName: "SendMessage",
          toolCallId: "toolu_other",
          createdAt: 250,
          input: { to: "agent-2", message: "other agent" },
        }),
      ],
      artifacts: [
        {
          id: 10,
          content: "Final answer",
          metadata: { parentToolUseId: "toolu_send" },
          createdAt: 400,
        },
        {
          id: 11,
          content: "unrelated",
          metadata: { parentToolUseId: "someone_else" },
          createdAt: 350,
        },
      ],
    });

    expect(flow.map((item) => item.key)).toEqual([
      "tool-2",
      "prompt-5",
      "tool-6",
      "msg-10",
    ]);
  });

  it("breaks same-second ties by turn role: prompt → tool → message", () => {
    const flow = buildSubagentFlow({
      subagentId: "toolu_spawn",
      agentId: "agent-1",
      toolCalls: [
        call({ id: 2, parentToolCallId: "toolu_spawn", toolName: "Bash", createdAt: 100 }),
        call({
          id: 3,
          toolName: "SendMessage",
          toolCallId: "toolu_send",
          createdAt: 100,
          input: { to: "agent-1", message: "go" },
        }),
      ],
      artifacts: [
        {
          id: 9,
          content: "done",
          metadata: { parentToolUseId: "toolu_spawn" },
          createdAt: 100,
        },
      ],
    });

    expect(flow.map((item) => item.kind)).toEqual(["prompt", "tool", "message"]);
  });

  it("orders same-second same-kind items by row id, not input order", () => {
    const flow = buildSubagentFlow({
      subagentId: "toolu_spawn",
      toolCalls: [
        call({ id: 4, parentToolCallId: "toolu_spawn", toolName: "Read", createdAt: 100 }),
        call({ id: 2, parentToolCallId: "toolu_spawn", toolName: "Bash", createdAt: 100 }),
      ],
      artifacts: [],
    });

    expect(flow.map((item) => item.key)).toEqual(["tool-2", "tool-4"]);
  });

  it("parses string-encoded artifact metadata", () => {
    const flow = buildSubagentFlow({
      subagentId: "toolu_spawn",
      toolCalls: [],
      artifacts: [
        {
          id: 1,
          content: "hello",
          metadata: JSON.stringify({ parentToolUseId: "toolu_spawn" }),
          createdAt: 100,
        },
      ],
    });
    expect(flow).toHaveLength(1);
  });
});

describe("selectSubagentReport", () => {
  const flowWith = (content: string) =>
    buildSubagentFlow({
      subagentId: "toolu_spawn",
      toolCalls: [],
      artifacts: [
        { id: 1, content, metadata: { parentToolUseId: "toolu_spawn" }, createdAt: 100 },
      ],
    });

  it("suppresses a report identical to the flow's last message", () => {
    expect(selectSubagentReport("All done.", flowWith("All done."))).toBeUndefined();
  });

  it("keeps a report the flow doesn't already show", () => {
    expect(selectSubagentReport("Extra summary", flowWith("All done."))).toBe(
      "Extra summary",
    );
    expect(selectSubagentReport("Only report", [])).toBe("Only report");
  });

  it("returns undefined without a report", () => {
    expect(selectSubagentReport(undefined, [])).toBeUndefined();
  });
});

describe("toMs", () => {
  it("normalizes Date, epoch-seconds, and epoch-ms", () => {
    expect(toMs(new Date(5000))).toBe(5000);
    expect(toMs(1_700_000_000)).toBe(1_700_000_000_000); // seconds
    expect(toMs(1_700_000_000_000)).toBe(1_700_000_000_000); // already ms
    expect(toMs("bogus")).toBe(0);
  });
});
