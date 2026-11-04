import { describe, expect, it } from "vitest";
import {
  commandsFromUpdate,
  parseOpenCodeAuthList,
  mapStopReasonToOutcome,
  currentModelIdFromConfigOptions,
  effortLevelsFromConfigOptions,
  modelsFromConfigOptions,
  openCodeCliCompatibility,
  parseOpenCodeVersion,
  openCodeSessionTitle,
  projectSessionUpdate,
  selectPermissionOption,
  titleFromSessionList,
  type OpenCodeTurnProjection,
} from "./opencode-events";

function projection(): OpenCodeTurnProjection {
  return {
    runId: "run-1",
    text: "",
    thought: "",
    generation: 0,
    streamPrefix: "stream",
    tools: new Map(),
  };
}

describe("OpenCode version gate", () => {
  it("accepts OpenCode 2 and rejects 1.x", () => {
    expect(parseOpenCodeVersion("2.0.11\n")).toEqual({ version: "2.0.11", major: 2 });
    expect(openCodeCliCompatibility("1.18.31")).toBe("unsupported");
    expect(openCodeCliCompatibility("2.1.0")).toBe("supported");
    expect(openCodeCliCompatibility("not a version")).toBe("unknown");
  });
});

describe("OpenCode auth list", () => {
  it("keeps integrations that have a stored credential and drops the secrets", () => {
    const listed = parseOpenCodeAuthList(JSON.stringify([
      { id: "openai", name: "OpenAI", connections: [{ type: "credential", id: "cred_secret", label: "OpenAI", method: "oauth" }] },
      { id: "anthropic", name: "Anthropic", connections: [] },
    ]));
    expect(listed).toEqual([{ id: "openai", name: "OpenAI" }]);
  });
});

describe("OpenCode ACP projection", () => {
  it("reads models from the session config option", () => {
    const models = modelsFromConfigOptions([
      {
        id: "model",
        category: "model",
        currentValue: "anthropic/claude-sonnet-5",
        options: [
          { value: "anthropic/claude-sonnet-5", name: "Sonnet" },
          { value: "openai/gpt-5", name: "GPT-5" },
        ],
      },
    ], "openai/gpt-5");
    expect(models.map((model) => model.id)).toEqual(["anthropic/claude-sonnet-5", "openai/gpt-5"]);
    expect(models.find((model) => model.isDefault)?.id).toBe("openai/gpt-5");
  });

  it("attaches effort only to the model those variants belong to", () => {
    const options = [
      {
        id: "model",
        category: "model",
        currentValue: "openai/gpt-5",
        options: [
          { value: "openai/gpt-5", name: "GPT-5" },
          { value: "opencode/big-pickle", name: "Big Pickle" },
        ],
      },
      {
        id: "effort",
        category: "thought_level",
        currentValue: "default",
        options: [
          { value: "low", name: "Low" },
          { value: "high", name: "High" },
          { value: "default", name: "Default" },
        ],
      },
    ];
    expect(currentModelIdFromConfigOptions(options)).toBe("openai/gpt-5");
    expect(effortLevelsFromConfigOptions(options)).toEqual(["low", "high"]);
    const models = modelsFromConfigOptions(options);
    expect(models.find((model) => model.id === "openai/gpt-5")?.supportedEffortLevels).toEqual(["low", "high"]);
    expect(models.find((model) => model.id === "opencode/big-pickle")?.supportedEffortLevels).toBeUndefined();
    expect(effortLevelsFromConfigOptions([{ id: "mode", options: [{ value: "build" }] }])).toEqual([]);
  });

  it("streams text, then a tool call, and keeps the tool id stable", () => {
    const state = projection();
    const text = projectSessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Looking" },
    });
    expect(text[0]).toMatchObject({ type: "artifact", ephemeral: true, content: "Looking" });

    const tool = projectSessionUpdate(state, {
      sessionUpdate: "tool_call",
      toolCallId: "call-1",
      title: "Read src/app.ts",
      kind: "read",
      status: "in_progress",
      rawInput: { path: "src/app.ts" },
    });
    expect(tool.some((event) => event.type === "artifact" && event.metadata?.messagePhase === "commentary")).toBe(true);
    expect(tool.find((event) => event.type === "tool_call")).toMatchObject({
      toolName: "Read src/app.ts",
      metadata: { phase: "start", toolCallId: "call-1" },
    });

    const progress = projectSessionUpdate(state, {
      sessionUpdate: "tool_call_update",
      toolCallId: "call-1",
      status: "in_progress",
      rawInput: { path: "src/app.ts", offset: 1 },
    });
    expect(progress.filter((event) => event.type === "tool_call")).toEqual([]);

    const done = projectSessionUpdate(state, {
      sessionUpdate: "tool_call_update",
      toolCallId: "call-1",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "export const app = 1;" } }],
    });
    const edited = projectSessionUpdate(projection(), {
      sessionUpdate: "tool_call",
      toolCallId: "edit-1",
      title: "edit",
      kind: "edit",
      status: "completed",
      rawInput: { path: "src/app.ts", oldString: "a", newString: "b" },
    });
    expect(edited.find((event) => event.type === "tool_call" && event.metadata?.phase === "complete")).toMatchObject({
      input: { path: "src/app.ts", oldString: "a", newString: "b", old_string: "a", new_string: "b" },
    });

    expect(done.find((event) => event.type === "tool_call")).toMatchObject({
      toolName: "Read src/app.ts",
      terminalStatus: "done",
      input: { path: "src/app.ts", offset: 1 },
      output: "export const app = 1;",
      metadata: { phase: "complete", toolCallId: "call-1" },
    });
  });

  it("maps permission options", () => {
    const options = [
      { optionId: "once", kind: "allow_once" },
      { optionId: "always", kind: "allow_always" },
      { optionId: "reject", kind: "reject_once" },
    ];
    expect(selectPermissionOption(options, "allow_always")).toBe("always");
    expect(selectPermissionOption(undefined, "reject_once")).toBe("reject");
  });

  it("keeps a generated session title and drops OpenCode's placeholder", () => {
    expect(openCodeSessionTitle("Refactor the hero")).toBe("Refactor the hero");
    expect(openCodeSessionTitle("  ")).toBeNull();
    expect(openCodeSessionTitle("New session - 2026-11-02T21:26:27.000Z")).toBeNull();
    expect(openCodeSessionTitle("Child session - 2026-11-02T21:26:27.000Z")).toBeNull();
    expect(titleFromSessionList({
      sessions: [
        { sessionId: "other", title: "Somewhere else" },
        { sessionId: "ses_1", title: "Refactor the hero" },
      ],
    }, "ses_1")).toBe("Refactor the hero");
    expect(titleFromSessionList({ sessions: [] }, "ses_1")).toBeNull();
  });

  it("maps stop reasons and slash commands", () => {
    expect(mapStopReasonToOutcome("cancelled").status).toBe("canceled");
    expect(mapStopReasonToOutcome("end_turn").status).toBe("succeeded");
    expect(commandsFromUpdate({
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "compact", description: "Compact the session" }],
    })).toEqual([{ name: "compact", description: "Compact the session", userFacing: true }]);
  });
});
