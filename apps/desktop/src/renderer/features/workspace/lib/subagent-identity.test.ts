import { describe, it, expect } from "vitest";
import { humanizeAgentName, subagentDisplay, subagentStateOf } from "./subagent-identity";

describe("humanizeAgentName", () => {
  it.each([
    ["security_review", "Security review"],
    ["test-gaps-review", "Test gaps review"],
    ["generalPurpose", "General purpose"],
    ["general-purpose", "General purpose"],
    ["Explore", "Explore"],
    // Idempotent — an already-human title passes through unchanged.
    ["Security review", "Security review"],
  ])("%s → %s", (input, expected) => {
    expect(humanizeAgentName(input)).toBe(expected);
  });
});

describe("subagentDisplay", () => {
  it("prefers the task description for Claude's attached Agent/Task calls", () => {
    expect(
      subagentDisplay({
        toolName: "Agent",
        agentType: "general-purpose",
        description: "Security review of subagent-display branch",
      }),
    ).toEqual({
      name: "Security review of subagent-display branch",
      detail: "General purpose",
    });
  });

  it("keeps the humanized nickname primary for detached spawns (Codex)", () => {
    expect(
      subagentDisplay({
        toolName: "spawnAgent",
        agentType: "Security review",
        description: "Review the branch for security issues in depth",
      }),
    ).toEqual({
      name: "Security review",
      detail: "Review the branch for security issues in depth",
    });
  });

  it("falls back to the humanized type when Claude sent no description", () => {
    expect(
      subagentDisplay({ toolName: "Task", agentType: "general-purpose" }),
    ).toEqual({ name: "General purpose", detail: undefined });
  });

  it("titles SendMessage continuations by their task description too", () => {
    expect(
      subagentDisplay({
        toolName: "SendMessage",
        agentType: "general-purpose",
        description: "Test gap review of subagent-display branch",
      }),
    ).toEqual({
      name: "Test gap review of subagent-display branch",
      detail: "General purpose",
    });
  });
});

describe("subagentStateOf", () => {
  // The exact shape that broke: a SendMessage continuation carries only task
  // metadata — no metadata.subagent — and its call returns immediately.
  it("settles a SendMessage continuation from its task metadata", () => {
    expect(
      subagentStateOf({
        toolName: "SendMessage",
        callStatus: "done",
        task: { status: "completed" },
        subagent: undefined,
      }),
    ).toBe("done");
  });

  it("keeps a SendMessage continuation running while its task runs", () => {
    expect(
      subagentStateOf({
        toolName: "SendMessage",
        callStatus: "done",
        task: { status: "running" },
      }),
    ).toBe("running");
  });

  // Finalizing a canceled run marks still-open calls "error" AND settles the
  // agent "stopped" — the explicit lifecycle must win over the inferred call
  // status, or every stopped agent renders as failed.
  it("prefers the explicit stopped phase over an inferred error status", () => {
    expect(
      subagentStateOf({
        toolName: "spawnAgent",
        callStatus: "error",
        subagent: { phase: "stopped" },
      }),
    ).toBe("stopped");
    // A genuinely errored call without lifecycle info still reads failed.
    expect(
      subagentStateOf({ toolName: "spawnAgent", callStatus: "error" }),
    ).toBe("failed");
  });

  // A backgrounded Agent call is "done" as soon as the launch ack returns —
  // while its task still runs. The task is authoritative whenever present.
  it("keeps a backgrounded agent running while its task runs", () => {
    expect(
      subagentStateOf({
        toolName: "Agent",
        callStatus: "done",
        task: { status: "running" },
      }),
    ).toBe("running");
    expect(
      subagentStateOf({
        toolName: "Agent",
        callStatus: "done",
        task: { status: "completed" },
      }),
    ).toBe("done");
  });

  it("trusts the call status only for attached spawns (Agent/Task)", () => {
    expect(
      subagentStateOf({ toolName: "Agent", callStatus: "done" }),
    ).toBe("done");
    expect(
      subagentStateOf({ toolName: "spawnAgent", callStatus: "done" }),
    ).toBe("running");
  });
});
