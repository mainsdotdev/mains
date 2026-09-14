import { describe, it, expect } from "vitest";
import type { ToolCall } from "@/lib/redux/api";
import { selectSessionSubagents, selectSubagentEntry } from "./select-subagents";
import { subagentStateOf } from "./subagent-identity";

function call(partial: Partial<ToolCall> & { id: number }): ToolCall {
  return {
    accountId: "acc",
    runId: "run-1",
    providerId: "claude_code",
    toolCallId: null,
    parentToolCallId: null,
    toolName: "Agent",
    status: "running",
    input: null,
    output: null,
    error: null,
    startedAt: null,
    endedAt: null,
    latencyMs: null,
    costMicros: null,
    metadata: null,
    createdAt: 0,
    ...partial,
  } as ToolCall;
}

describe("selectSessionSubagents", () => {
  it("reads the agent type and description off subagent + task metadata", () => {
    const [agent] = selectSessionSubagents([
      call({
        id: 1,
        metadata: {
          subagent: { phase: "running", agentType: "Explore" },
          task: { phase: "started", status: "running", description: "Find the API" },
        },
      }),
    ]);

    expect(agent).toEqual({
      id: 1,
      providerCallId: null,
      toolName: "Agent",
      agentType: "Explore",
      description: "Find the API",
      state: "running",
    });
  });

  it("falls back to the tool input when no lifecycle metadata landed", () => {
    const [agent] = selectSessionSubagents([
      call({
        id: 1,
        status: "done",
        input: { subagent_type: "general-purpose", description: "Audit deps" },
      }),
    ]);

    expect(agent).toMatchObject({
      agentType: "general-purpose",
      description: "Audit deps",
      state: "done",
    });
  });

  it("excludes backgrounded shell commands, which are tasks but not subagents", () => {
    const agents = selectSessionSubagents([
      call({
        id: 1,
        toolName: "Bash",
        metadata: { task: { phase: "started", taskType: "local_bash" } },
      }),
    ]);

    expect(agents).toEqual([]);
  });

  it("excludes ordinary tool calls", () => {
    expect(selectSessionSubagents([call({ id: 1, toolName: "Read" })])).toEqual([]);
  });

  // A failed task and a canceled tool call are distinct outcomes; both have to
  // beat the `done` status the tool call itself settles on.
  it.each([
    ["task error", { task: { error: "boom" } }, "failed"],
    ["task stopped", { task: { status: "stopped" } }, "stopped"],
    ["subagent failure", { subagent: { phase: "failed" } }, "failed"],
    // Run finalization settles lost agents as "stopped" (aborted run).
    ["subagent stopped", { subagent: { phase: "stopped" } }, "stopped"],
    ["completion", { task: { phase: "completed", status: "completed" } }, "done"],
  ])("maps %s to %s", (_label, metadata, expected) => {
    const [agent] = selectSessionSubagents([
      call({ id: 1, status: "done", metadata: metadata as Record<string, unknown> }),
    ]);
    expect(agent.state).toBe(expected);
  });

  // The CLI rewrites metadata.task.description with the live step while the
  // agent runs — the stable spawn title must win.
  it("keeps the spawn title as the name while task progress rewrites it", () => {
    const [running] = selectSessionSubagents([
      call({
        id: 1,
        status: "running",
        input: { subagent_type: "general-purpose", description: "Security review of branch" },
        metadata: {
          task: {
            subagentType: "general-purpose",
            status: "running",
            description: "Reading /tmp/full.diff",
          },
        },
      }),
    ]);

    expect(running).toMatchObject({
      description: "Security review of branch",
      state: "running",
    });

    const [done] = selectSessionSubagents([
      call({
        id: 1,
        status: "done",
        input: { subagent_type: "general-purpose", description: "Security review of branch" },
        metadata: {
          task: {
            subagentType: "general-purpose",
            status: "completed",
            description: "Reading /tmp/full.diff",
          },
        },
      }),
    ]);
    expect(done.description).toBe("Security review of branch");
  });

  it("returns subagents newest-first regardless of row order", () => {
    const agents = selectSessionSubagents([
      call({ id: 2, input: { subagent_type: "b" } }),
      call({ id: 7, input: { subagent_type: "c" } }),
      call({ id: 1, input: { subagent_type: "a" } }),
    ]);

    expect(agents.map((a) => a.agentType)).toEqual(["c", "b", "a"]);
  });

  // Codex's spawnAgent call returns as soon as the agent starts, so the call
  // going "done" says nothing about the agent — only the subagent lifecycle
  // patch may settle it. Claude's Agent call stays open for the agent's whole
  // life, so there "done" IS the agent's completion.
  it("keeps a detached spawn running until its subagent lifecycle settles", () => {
    const [running] = selectSessionSubagents([
      call({
        id: 1,
        toolName: "spawnAgent",
        status: "done",
        metadata: { subagent: { phase: "invoked", agentType: "Ada" } },
      }),
    ]);
    expect(running.state).toBe("running");

    const [done] = selectSessionSubagents([
      call({
        id: 1,
        toolName: "spawnAgent",
        status: "done",
        metadata: { subagent: { phase: "completed", agentType: "Ada" } },
      }),
    ]);
    expect(done.state).toBe("done");
  });

  // A SendMessage continuation is another turn of an existing agent — one
  // panel row, with the continuation (latest turn) deciding the state.
  it("folds a SendMessage continuation into its agent's row", () => {
    const agents = selectSessionSubagents([
      call({
        id: 1,
        toolCallId: "toolu_spawn",
        status: "done",
        input: { subagent_type: "general-purpose", description: "Test gap review" },
        metadata: {
          subagent: {
            phase: "completed",
            agentId: "a2e1ea6807f240562",
          },
        },
      }),
      call({
        id: 2,
        toolName: "SendMessage",
        toolCallId: "toolu_send",
        status: "done",
        input: { to: "a2e1ea6807f240562", message: "Please re-check the diff" },
        metadata: { task: { subagentType: "general-purpose", status: "running" } },
      }),
    ]);

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      providerCallId: "toolu_spawn",
      // The continuation is running, so the agent is running again.
      state: "running",
    });
  });

  it("matches the agentId from the persisted result text as a fallback", () => {
    const agents = selectSessionSubagents([
      call({
        id: 1,
        toolCallId: "toolu_spawn",
        status: "done",
        input: { subagent_type: "general-purpose" },
        metadata: {
          subagent: {
            phase: "completed",
            result: "Report done.\n\nagentId: abc123def456 (use SendMessage to continue)",
          },
        },
      }),
      call({
        id: 2,
        toolName: "SendMessage",
        toolCallId: "toolu_send",
        status: "done",
        input: { to: "abc123def456" },
        metadata: { task: { subagentType: "general-purpose", status: "completed" } },
      }),
    ]);

    expect(agents).toHaveLength(1);
    expect(agents[0].state).toBe("done");
  });

  // Row order from the repo must not matter: "latest turn" is decided by
  // monotonic row id, so an out-of-order (or descending) fetch still lets the
  // NEWEST continuation decide the state.
  it("lets the newest continuation win even when rows arrive out of order", () => {
    const agents = selectSessionSubagents([
      // Newest continuation FIRST in input (completed)…
      call({
        id: 9,
        toolName: "SendMessage",
        toolCallId: "toolu_send_2",
        status: "done",
        input: { to: "agent-1" },
        metadata: { task: { subagentType: "general-purpose", status: "completed" } },
      }),
      // …older continuation later in input (still running).
      call({
        id: 5,
        toolName: "SendMessage",
        toolCallId: "toolu_send_1",
        status: "done",
        input: { to: "agent-1" },
        metadata: { task: { subagentType: "general-purpose", status: "running" } },
      }),
      call({
        id: 1,
        toolCallId: "toolu_spawn",
        status: "done",
        input: { subagent_type: "general-purpose" },
        metadata: { subagent: { phase: "completed", agentId: "agent-1" } },
      }),
    ]);

    expect(agents).toHaveLength(1);
    expect(agents[0].state).toBe("done");
  });

  it("keeps an unmatched SendMessage agent task as its own row", () => {
    const agents = selectSessionSubagents([
      call({
        id: 2,
        toolName: "SendMessage",
        toolCallId: "toolu_send",
        status: "done",
        input: { to: "unknown-agent" },
        metadata: {
          task: {
            subagentType: "general-purpose",
            status: "completed",
            description: "Test gap review of subagent-display branch",
          },
        },
      }),
    ]);

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      toolName: "SendMessage",
      description: "Test gap review of subagent-display branch",
      state: "done",
    });
  });

  it("exposes the provider call id so the detail tab can find its data", () => {
    const [agent] = selectSessionSubagents([
      call({ id: 1, toolCallId: "item_5", input: { subagent_type: "a" } }),
    ]);
    expect(agent.providerCallId).toBe("item_5");
  });
});

describe("selectSubagentEntry", () => {
  // The stop-then-continue shape: the spawn was settled `stopped` when the run
  // was aborted, then a SendMessage revived the agent in the continued run.
  // The detail header reads through this lookup precisely so it cannot answer
  // differently from the list row the user clicked to open it.
  const revivedAgent: ToolCall[] = [
    call({
      id: 1,
      toolCallId: "toolu_spawn",
      status: "error",
      input: { subagent_type: "general-purpose", description: "Security review" },
      metadata: {
        subagent: { phase: "stopped", agentId: "a2e1ea68", agentType: "general-purpose" },
      },
    }),
    call({
      id: 2,
      toolName: "SendMessage",
      toolCallId: "toolu_send",
      status: "done",
      input: { to: "a2e1ea68", message: "Resume, finish the review" },
      metadata: { task: { subagentType: "general-purpose", status: "running" } },
    }),
  ];

  it("answers with the folded state, not the spawn row's own", () => {
    // What the spawn row alone says — the answer the detail used to render.
    expect(
      subagentStateOf({
        toolName: "Agent",
        callStatus: "error",
        subagent: { phase: "stopped" },
      }),
    ).toBe("stopped");

    expect(selectSubagentEntry(revivedAgent, "toolu_spawn")).toMatchObject({
      providerCallId: "toolu_spawn",
      state: "running",
    });
  });

  it("is the same entry the list renders for that row", () => {
    const fromList = selectSessionSubagents(revivedAgent).find(
      (agent) => agent.providerCallId === "toolu_spawn",
    );
    expect(selectSubagentEntry(revivedAgent, "toolu_spawn")).toEqual(fromList);
  });

  it("returns undefined for a call id with no agent", () => {
    expect(selectSubagentEntry(revivedAgent, "toolu_missing")).toBeUndefined();
  });
});
