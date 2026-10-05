import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkRunEvent, WorkRunEventHandler } from "../../../../shared/adapter.types";
import { createCursorDriver } from "./cursor.driver";
import { createWorkRunAdapter } from "./work-run-core";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), updateRun: vi.fn(), approval: vi.fn(), bridges: [] as Array<{ isRunning: boolean }> }));
vi.mock("node:child_process", async (original) => ({
  ...await original<typeof import("node:child_process")>(), spawn: mocks.spawn,
}));
vi.mock("../../runs/runs.repo", () => ({ runsRepo: { updateRun: mocks.updateRun } }));
vi.mock("../../runs/user-input-broker", () => ({ requestToolApproval: mocks.approval, cancelPendingRequests: vi.fn() }));
vi.mock("./mains-mcp-server", () => ({
  MainsMcpStdioServer: class {
    isRunning = true;
    constructor() { mocks.bridges.push(this); }
    mcpConfig = { name: "mains", command: "fixture", args: [], env: [] };
    async start() {}
    async stop() { this.isRunning = false; }
    setEventHandler() {}
  },
}));

type RpcMessage = { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown };

/** Replay wire messages through the production JSON-RPC reader and driver. */
class AcpFixture extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  calls: RpcMessage[] = [];
  sessions = 0;
  failMethod?: string;
  onPrompt: (message: RpcMessage) => void = () => {};
  stdin = new Writable({ write: (chunk, _encoding, done) => {
    const message = JSON.parse(chunk.toString()) as RpcMessage;
    this.calls.push(message);
    queueMicrotask(() => {
      if (this.failMethod && message.method === this.failMethod) this.send({ id: message.id, error: { code: -32000, message: "Session creation failed" } });
      else if (message.method === "initialize") this.respond(message.id!, { authMethods: [{ id: "cursor_login" }] });
      else if (message.method === "session/new") this.respond(message.id!, { sessionId: `session-${++this.sessions}` });
      else if (message.method === "session/prompt") this.onPrompt(message);
      else if (message.id !== undefined) this.respond(message.id, {});
    });
    done();
  } });

  send(message: object) { this.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n"); }
  respond(id: number, result: object) { this.send({ id, result }); }
  update(sessionId: string, update: object) { this.send({ method: "session/update", params: { sessionId, update } }); }
  text(sessionId: string, text: string) { this.update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text } }); }
  finish(message: RpcMessage) { this.respond(message.id!, { stopReason: "end_turn" }); }
  kill() { this.exitCode = 0; queueMicrotask(() => this.emit("close", 0, null)); return true; }
}

const diagnostic = "Error: RetriableError: WritableIterable is closed";
const reports = (events: WorkRunEvent[]) => events.filter((event) => event.type === "artifact" && event.kind === "report" && !event.ephemeral);

describe("Cursor ACP transcript", () => {
  let fixture: AcpFixture;
  let driver: ReturnType<typeof createCursorDriver>;
  beforeEach(() => {
    fixture = new AcpFixture();
    mocks.bridges.length = 0;
    mocks.spawn.mockReturnValue(fixture);
    mocks.updateRun.mockResolvedValue(undefined);
    mocks.approval.mockResolvedValue({ approved: true });
    driver = createCursorDriver({ binary: "/fixture/agent" });
  });
  afterEach(async () => { await driver.shutdown?.(); vi.clearAllMocks(); });

  async function acquire(runId = "run-1") {
    return driver.createSession({ runId, accountId: "account-1", execution: { cwd: "/fixture", workspaceId: null }, goal: "hi" });
  }
  async function replay(chunks: string[], onEvent?: WorkRunEventHandler) {
    const acquired = await acquire();
    const events: WorkRunEvent[] = [];
    fixture.onPrompt = (message) => {
      const sessionId = message.params!.sessionId as string;
      for (const chunk of chunks) fixture.text(sessionId, chunk);
      fixture.finish(message);
    };
    const outcome = await driver.executePrompt(acquired.session, acquired.prompt, async (event) => {
      events.push(event); await onEvent?.(event);
    }, new AbortController().signal);
    return { outcome, events };
  }

  async function replayUpdates(updates: object[]) {
    const acquired = await acquire();
    const events: WorkRunEvent[] = [];
    fixture.onPrompt = (message) => {
      for (const update of updates) fixture.update(acquired.sessionId!, update);
      fixture.finish(message);
    };
    const outcome = await driver.executePrompt(acquired.session, acquired.prompt, (event) => { events.push(event); }, new AbortController().signal);
    return { outcome, calls: events.filter((event) => event.type === "tool_call") };
  }

  it("keeps the native session title out of the transcript", async () => {
    const acquired = await acquire();
    const events: WorkRunEvent[] = [];
    fixture.onPrompt = (message) => {
      fixture.update(acquired.sessionId!, { sessionUpdate: "session_info_update", title: "Hello Agent" });
      fixture.text(acquired.sessionId!, "Hello.");
      fixture.finish(message);
    };
    await driver.executePrompt(acquired.session, acquired.prompt, (event) => { events.push(event); }, new AbortController().signal);
    expect(mocks.updateRun).toHaveBeenCalledWith("run-1", { title: "Hello Agent" });
    expect(events.filter((event) => event.type === "log")).toEqual([]);
  });

  it("removes Cursor's trailing EOS token from session title metadata", async () => {
    await replayUpdates([{ sessionUpdate: "session_info_update", title: "Refactor Hero Section<|eos|>" }]);
    expect(mocks.updateRun).toHaveBeenCalledWith("run-1", { title: "Refactor Hero Section" });
  });

  it("keeps presentation titles in metadata instead of generic tool parameters", async () => {
    // Recorded from agent 2026.10.01-e373342: native arguments are absent.
    const { calls } = await replayUpdates([
      { sessionUpdate: "tool_call", toolCallId: "mode-1", kind: "switch_mode", title: "Switch Mode: unknown", status: "pending", rawInput: {} },
      { sessionUpdate: "tool_call_update", toolCallId: "mode-1", status: "completed" },
      { sessionUpdate: "tool_call", toolCallId: "mcp-1", kind: "other", title: "MCP: tool", status: "pending", rawInput: {} },
      { sessionUpdate: "tool_call_update", toolCallId: "mcp-1", status: "completed" },
    ]);
    expect(calls[0]).toMatchObject({ toolName: "SwitchMode", input: {}, metadata: { title: "Switch Mode: unknown" } });
    expect(calls[2]).toMatchObject({ toolName: "MCP", input: {}, metadata: { title: "MCP: tool" } });
    expect(calls.every((call) => !call.input || !("_title" in call.input))).toBe(true);
  });

  it("does not invent file paths or commands from generic native tool titles", async () => {
    const { calls } = await replayUpdates([
      { sessionUpdate: "tool_call", toolCallId: "read-1", kind: "read", title: "Read File", status: "pending", rawInput: {} },
      { sessionUpdate: "tool_call_update", toolCallId: "read-1", status: "completed", rawOutput: { content: "File contents" } },
      { sessionUpdate: "tool_call", toolCallId: "shell-1", kind: "execute", title: "Run Shell Command", status: "pending", rawInput: {} },
      { sessionUpdate: "tool_call_update", toolCallId: "shell-1", status: "completed", rawOutput: { exitCode: 0, stdout: "ok" } },
    ]);
    expect(calls[0]).toMatchObject({ toolName: "Read" });
    expect(calls[0].input).toEqual({});
    expect(calls[1]).toMatchObject({ output: "File contents" });
    expect(calls[2]).toMatchObject({ toolName: "Bash" });
    expect(calls[2].input).toEqual({});
  });

  it("maps native file paths to the shared read input and preserves arguments across updates", async () => {
    const { calls } = await replayUpdates([
      { sessionUpdate: "tool_call", toolCallId: "read-1", kind: "read", title: "Read File", status: "pending", rawInput: { path: "/fixture/hero.tsx", offset: 10 } },
      { sessionUpdate: "tool_call_update", toolCallId: "read-1", status: "completed", title: "Read File" },
    ]);
    expect(calls[0].input).toEqual({ file_path: "/fixture/hero.tsx", offset: 10 });
    expect(calls[1].input).toEqual(calls[0].input);
  });

  it("projects a native completed tool with an error result as a failed tool, allowing the agent to recover", async () => {
    const error = 'Built-in tool "AskQuestion" not found in namespace "cursor".';
    const { calls, outcome } = await replayUpdates([
      { sessionUpdate: "tool_call", toolCallId: "ask-1", kind: "other", title: "MCP: tool", status: "pending", rawInput: {} },
      { sessionUpdate: "tool_call_update", toolCallId: "ask-1", status: "completed", rawOutput: { error } },
    ]);
    expect(calls[1]).toMatchObject({ error, output: { error }, metadata: { phase: "complete" } });
    expect(outcome.status).toBe("succeeded");
  });

  it("reads ACP content blocks when a failed tool carries its diagnostic there", async () => {
    const { calls } = await replayUpdates([
      { sessionUpdate: "tool_call", toolCallId: "tool-1", kind: "other", title: "External tool", status: "pending" },
      { sessionUpdate: "tool_call_update", toolCallId: "tool-1", status: "failed", content: [{ type: "content", content: { type: "text", text: "Permission denied" } }] },
    ]);
    expect(calls[1]).toMatchObject({ error: "Permission denied", output: "Permission denied" });
  });

  it("marks a completed native shell call with a nonzero exit code as a failed tool", async () => {
    const { calls } = await replayUpdates([
      { sessionUpdate: "tool_call", toolCallId: "shell-1", kind: "execute", title: "Run command", status: "pending", rawInput: { command: "npm run missing" } },
      { sessionUpdate: "tool_call_update", toolCallId: "shell-1", status: "completed", rawOutput: { exitCode: 1, stderr: "Missing script" } },
    ]);
    expect(calls[1]).toMatchObject({ toolName: "Bash", error: "Missing script" });
  });

  it("releases its bridge when session acquisition fails", async () => {
    fixture.failMethod = "session/new";
    await expect(acquire()).rejects.toThrow("Session creation failed");
    expect(mocks.bridges[0].isRunning).toBe(false);
  });

  it("stops the ACP child as well as the bridge when initialization fails", async () => {
    fixture.failMethod = "initialize";
    await expect(acquire()).rejects.toThrow("Session creation failed");
    expect(fixture.exitCode).toBe(0);
    expect(mocks.bridges[0].isRunning).toBe(false);
  });

  it("initializes one shared ACP process for simultaneous acquisitions", async () => {
    const [first, second] = await Promise.all([acquire("run-a"), acquire("run-b")]);
    expect(first.sessionId).not.toBe(second.sessionId);
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it("removes Cursor's split title frontmatter from both the live and saved response", async () => {
    // Recorded from agent 2026.10.01-e373342 in ACP ask mode.
    const { events } = await replay(["---\ntitle: Say", " hello\n---\n\nHello — glad you’re here."]);
    expect(reports(events)).toEqual([expect.objectContaining({ content: "Hello — glad you’re here." })]);
    expect(events.every((event) => event.type !== "artifact" || !event.ephemeral || !event.content?.includes("title:"))).toBe(true);
  });

  it("preserves the reply and fails the turn when Cursor appends its transport diagnostic then returns end_turn", async () => {
    const { outcome, events } = await replay(["Hello — glad you’re here.", "\n\n" + diagnostic]);
    expect(outcome).toMatchObject({ status: "failed", summary: diagnostic });
    expect(reports(events)).toEqual([expect.objectContaining({ content: "Hello — glad you’re here." })]);
  });

  it("reports a Cursor transport failure through the shared run status and cleans up the bridge", async () => {
    const events: WorkRunEvent[] = [];
    fixture.onPrompt = (message) => {
      const sessionId = message.params!.sessionId as string;
      fixture.text(sessionId, "---\ntitle: Say hello\n---\n\nHello.");
      fixture.text(sessionId, "\n\n" + diagnostic);
      fixture.finish(message);
    };
    const result = await createWorkRunAdapter(driver).startRun({ runId: "run-1", accountId: "account-1", execution: { cwd: "/fixture", workspaceId: null }, goal: "hi" }, (event) => { events.push(event); });
    expect(result).toMatchObject({ status: "failed", summary: diagnostic });
    expect(events.filter((event) => event.type === "status")).toEqual([
      expect.objectContaining({ status: "running" }), expect.objectContaining({ status: "failed", error: diagnostic }),
    ]);
    expect(reports(events)).toEqual([expect.objectContaining({ content: "Hello." })]);
    expect(mocks.bridges[0].isRunning).toBe(false);
  });

  it("preserves partial output and clears live previews when the ACP process errors", async () => {
    driver = createCursorDriver({ binary: "/fixture/agent", timeout: 20 });
    const acquired = await acquire();
    const events: WorkRunEvent[] = [];
    fixture.onPrompt = (message) => {
      fixture.text(message.params!.sessionId as string, "Partial reply.");
      fixture.emit("error", new Error("agent crashed"));
    };
    const outcome = await driver.executePrompt(acquired.session, acquired.prompt, (event) => { events.push(event); }, new AbortController().signal);
    expect(outcome).toMatchObject({ status: "failed", summary: "agent crashed" });
    expect(reports(events)).toEqual([expect.objectContaining({ content: "Partial reply." })]);
    expect(events.slice(-2)).toEqual([
      expect.objectContaining({ type: "artifact", ephemeral: true, content: "", metadata: { source: "agent_message_streaming" } }),
      expect.objectContaining({ type: "artifact", ephemeral: true, content: "", metadata: { source: "agent_thought_streaming" } }),
    ]);
  });

  it("awaits notification persistence before returning a terminal outcome", async () => {
    const completed: WorkRunEvent[] = [];
    const { events } = await replay(["Checking.", " Done."], async (event) => {
      if (event.type === "artifact" && event.ephemeral && event.content === "Checking.") {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      completed.push(event);
    });
    expect(completed).toEqual(events);
  });

  it("isolates concurrent session notifications and their MCP bridges", async () => {
    const first = await acquire("run-a");
    const second = await acquire("run-b");
    expect(mocks.bridges.map((bridge) => bridge.isRunning)).toEqual([true, true]);
    const eventsA: WorkRunEvent[] = [];
    const eventsB: WorkRunEvent[] = [];
    const prompts: RpcMessage[] = [];
    fixture.onPrompt = (message) => {
      prompts.push(message);
      if (prompts.length !== 2) return;
      fixture.text(first.sessionId!, "Reply A");
      fixture.text(second.sessionId!, "Reply B");
      fixture.text("unrelated-session", "Other reply");
      for (const prompt of prompts) fixture.finish(prompt);
    };
    await Promise.all([
      driver.executePrompt(first.session, first.prompt, (event) => { eventsA.push(event); }, new AbortController().signal),
      driver.executePrompt(second.session, second.prompt, (event) => { eventsB.push(event); }, new AbortController().signal),
    ]);
    expect(reports(eventsA)).toEqual([expect.objectContaining({ content: "Reply A" })]);
    expect(reports(eventsB)).toEqual([expect.objectContaining({ content: "Reply B" })]);
  });

  it("ignores late updates after a prompt has finished", async () => {
    const { events } = await replay(["Hello."]);
    const length = events.length;
    fixture.text("session-1", "Late reply");
    fixture.update("session-1", { sessionUpdate: "session_info_update", title: "Late title" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toHaveLength(length);
    expect(mocks.updateRun).not.toHaveBeenCalled();
  });

  it("routes tool approvals to their owning run with the actual command input", async () => {
    const first = await acquire("run-a");
    const second = await acquire("run-b");
    const prompts: RpcMessage[] = [];
    mocks.approval.mockImplementation(async ({ runId }: { runId: string }) => ({ approved: runId === "run-a" }));
    fixture.onPrompt = (message) => {
      prompts.push(message);
      if (prompts.length !== 2) return;
      for (const [id, sessionId, command] of [[101, first.sessionId!, "echo from-a"], [102, second.sessionId!, "echo from-b"]] as const) {
        fixture.send({ id, method: "session/request_permission", params: { sessionId, toolCall: { kind: "execute", title: "Run command", rawInput: { command } }, options: [
          { optionId: "allow", kind: "allow_once" }, { optionId: "reject", kind: "reject_once" },
        ] } });
      }
      for (const prompt of prompts) fixture.finish(prompt);
    };
    await Promise.all([
      driver.executePrompt(first.session, first.prompt, () => {}, new AbortController().signal),
      driver.executePrompt(second.session, second.prompt, () => {}, new AbortController().signal),
    ]);
    expect(mocks.approval).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-a", toolName: "Bash", toolInput: expect.objectContaining({ command: "echo from-a" }) }));
    expect(mocks.approval).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-b", toolName: "Bash", toolInput: expect.objectContaining({ command: "echo from-b" }) }));
    expect(fixture.calls.find((message) => message.id === 101 && !message.method)?.result).toEqual({ outcome: { outcome: "selected", optionId: "allow" } });
    expect(fixture.calls.find((message) => message.id === 102 && !message.method)?.result).toEqual({ outcome: { outcome: "selected", optionId: "reject" } });
  });

  it("does not send an already canceled prompt", async () => {
    const acquired = await acquire();
    const abort = new AbortController();
    abort.abort();
    fixture.onPrompt = (message) => fixture.finish(message);
    const outcome = await driver.executePrompt(acquired.session, acquired.prompt, () => {}, abort.signal);
    expect(outcome.status).toBe("canceled");
    expect(fixture.calls.some((message) => message.method === "session/prompt")).toBe(false);
  });

  it("projects ACP plan entries as execution progress, including an empty replacement", async () => {
    const acquired = await acquire();
    const events: WorkRunEvent[] = [];
    fixture.onPrompt = (message) => {
      fixture.update(acquired.sessionId!, { sessionUpdate: "plan", entries: [
        { content: "Inspect the hero", priority: "high", status: "completed" },
        { content: "Refactor", priority: "medium", status: "in_progress" },
      ] });
      fixture.update(acquired.sessionId!, { sessionUpdate: "plan", entries: [] });
      fixture.finish(message);
    };
    await driver.executePrompt(acquired.session, acquired.prompt, (event) => { events.push(event); }, new AbortController().signal);
    expect(events.filter((event) => event.type === "plan_update")).toEqual([
      expect.objectContaining({ steps: [{ step: "Inspect the hero", status: "completed" }, { step: "Refactor", status: "in_progress" }] }),
      expect.objectContaining({ steps: [] }),
    ]);
  });

  it("shows external MCP calls while suppressing the native duplicate of Mains bridge calls", async () => {
    const acquired = await acquire();
    const events: WorkRunEvent[] = [];
    fixture.onPrompt = (message) => {
      fixture.update(acquired.sessionId!, { sessionUpdate: "tool_call", toolCallId: "docs-1", kind: "mcp_tool_call", title: "MCP: context7/query-docs", status: "in_progress", rawInput: { query: "React" } });
      fixture.update(acquired.sessionId!, { sessionUpdate: "tool_call_update", toolCallId: "docs-1", status: "completed", rawOutput: "Documentation" });
      fixture.update(acquired.sessionId!, { sessionUpdate: "tool_call", toolCallId: "mains-1", kind: "mcp_tool_call", title: "mcp__mains__SaveReview", status: "in_progress" });
      fixture.update(acquired.sessionId!, { sessionUpdate: "tool_call_update", toolCallId: "mains-1", status: "completed" });
      fixture.finish(message);
    };
    await driver.executePrompt(acquired.session, acquired.prompt, (event) => { events.push(event); }, new AbortController().signal);
    const calls = events.filter((event) => event.type === "tool_call");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ toolName: "MCP: context7/query-docs", input: { query: "React" }, metadata: { phase: "start", toolCallId: "docs-1" } });
    expect(calls[1]).toMatchObject({ toolName: "MCP: context7/query-docs", output: "Documentation", metadata: { phase: "complete", toolCallId: "docs-1" } });
  });
});
