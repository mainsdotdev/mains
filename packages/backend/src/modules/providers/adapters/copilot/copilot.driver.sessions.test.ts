import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CopilotClientOptions, PermissionRequest, SessionConfig } from "@github/copilot-sdk";
import type { CopilotAdapterConfig, WorkRunEvent, WorkRunRequest } from "../../../../../shared/adapter.types";
import { installTestBackendRuntime } from "../../../../../test/backend-runtime";
import { createCopilotDriver } from "./copilot.driver";

const sdk = vi.hoisted(() => ({
  clients: [] as any[], sessions: [] as any[], inheritedModel: "auto",
  inheritedTier: undefined as string | undefined,
  pendingTier: undefined as string | undefined,
  activatingTier: undefined as string | undefined,
  events: [] as any[], tierError: null as Error | null,
  result: undefined as any,
  catalogue: [] as any[],
  startGate: undefined as Promise<void> | undefined,
  backgroundGate: undefined as Promise<any> | undefined,
}));
const CATALOGUE = [
  { id: "auto", name: "Auto" },
  { id: "fixed-model", name: "Fixed model", capabilities: { supports: { reasoningEffort: true } } },
];
const approvals = vi.hoisted(() => ({ request: vi.fn(), guard: vi.fn() }));

vi.mock("../../../runs/user-input-broker", () => ({ requestToolApproval: approvals.request }));
vi.mock("../../../guards/guards.service", () => ({ guardsService: { buildCopilotGuardHook: approvals.guard } }));

vi.mock("@github/copilot-sdk", () => {
  function session(config: { model?: string }) {
    let listener: (event: any) => void = () => {};
    const result = {
      rpc: { commands: { list: vi.fn(() => sdk.backgroundGate ?? Promise.resolve({ commands: [] })) }, mode: { set: vi.fn().mockResolvedValue({}) }, model: { getCurrent: vi.fn(async () => ({ modelId: config.model ?? sdk.inheritedModel,
        autoTier: sdk.inheritedTier, pendingAutoTier: sdk.pendingTier, activatingAutoTier: sdk.activatingTier })) } },
      setAutoTier: vi.fn(async () => {
        if (sdk.tierError) throw sdk.tierError;
        return { status: "pending" };
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((handler) => { listener = handler; return () => {}; }),
      sendAndWait: vi.fn(async () => {
        for (const event of sdk.events) listener(event);
        return sdk.backgroundGate ?? sdk.result ?? { type: "assistant.message", data: { content: "ok" } };
      }),
    };
    sdk.sessions.push(result);
    return result;
  }
  return {
    RuntimeConnection: {
      forUri: (url: string) => ({ url }),
      forStdio: (options: unknown) => options,
    },
    CopilotClient: class {
      start = vi.fn(() => sdk.startGate ?? Promise.resolve());
      stop = vi.fn().mockResolvedValue([]);
      forceStop = vi.fn().mockResolvedValue(undefined);
      ping = vi.fn().mockResolvedValue({ message: "ok" });
      createSession = vi.fn(async (config) => session(config));
      resumeSession = vi.fn(async (_id, config) => session(config));
      rpc = { models: { list: vi.fn(async () => ({ models: sdk.catalogue })) } };
      constructor(public options: CopilotClientOptions) { sdk.clients.push(this); }
    },
  };
});

describe("Copilot session settings and SDK callbacks", () => {
  let fixture: string;
  let restoreRuntime: () => void;
  const drivers: ReturnType<typeof createCopilotDriver>[] = [];

  function driver(config: CopilotAdapterConfig = {}) {
    const result = createCopilotDriver({ cliUrl: "localhost:9234", ...config });
    drivers.push(result);
    return result;
  }

  function request(overrides: Partial<WorkRunRequest> = {}): WorkRunRequest {
    return { runId: "run-fast", accountId: "account-1", model: "auto", goal: "hello",
      execution: { workspaceId: null, cwd: fixture }, ...overrides };
  }

  beforeEach(() => {
    sdk.clients.length = 0;
    sdk.sessions.length = 0;
    sdk.inheritedModel = "auto";
    sdk.inheritedTier = undefined;
    sdk.pendingTier = undefined;
    sdk.activatingTier = undefined;
    sdk.events = [];
    sdk.tierError = null;
    sdk.result = undefined;
    sdk.catalogue = CATALOGUE;
    sdk.startGate = undefined;
    sdk.backgroundGate = undefined;
    approvals.request.mockReset().mockImplementation(async (request) => ({ requestId: request.requestId, approved: true }));
    approvals.guard.mockReset().mockResolvedValue(null);
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), "mains-copilot-sessions-"));
    restoreRuntime = installTestBackendRuntime({ getPath: () => fixture });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    for (const current of drivers.splice(0)) await current.shutdown?.();
    restoreRuntime();
    vi.restoreAllMocks();
    fs.rmSync(fixture, { recursive: true, force: true });
  });

  it("shares command discovery only within a workspace and releases each temporary session once", async () => {
    let finish!: (value: { commands: Array<{ name: string }> }) => void;
    sdk.backgroundGate = new Promise((resolve) => { finish = resolve; });
    const current = driver();
    const first = current.listCommands!(fixture), joined = current.listCommands!(fixture);
    const other = current.listCommands!(path.join(fixture, "other"));
    try {
      await vi.waitFor(() => expect(sdk.sessions.length).toBeGreaterThan(1));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(sdk.sessions).toHaveLength(2);
    } finally { finish({ commands: [{ name: "shared" }] }); }
    expect(await first).toEqual(await joined);
    expect(await other).toEqual([expect.objectContaining({ name: "shared" })]);
    expect(sdk.sessions.every((session) => session.disconnect.mock.calls.length === 1)).toBe(true);
    expect(sdk.clients[0].stop).not.toHaveBeenCalled();
  });

  it("shares initialization without exposing a client whose start is still pending", async () => {
    let release!: () => void;
    sdk.startGate = new Promise<void>((resolve) => { release = resolve; });
    const current = driver();
    const first = current.createSession(request({ runId: "start-first" }));
    await vi.waitFor(() => expect(sdk.clients[0]?.start.mock.calls.length).toBe(1));
    const second = current.createSession(request({ runId: "start-second" }));
    const results = Promise.allSettled([first, second]);
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(sdk.clients[0].createSession.mock.calls.length).toBe(0);
    } finally { release(); await results; }
    expect((await results).every((result) => result.status === "fulfilled")).toBe(true);
    expect(sdk.clients).toHaveLength(1);
    expect(sdk.clients[0].start).toHaveBeenCalledTimes(1);
  });

  it("releases a failed startup and retries with a fresh client", async () => {
    let fail!: (error: Error) => void;
    sdk.startGate = new Promise<void>((_resolve, reject) => { fail = reject; });
    const current = driver();
    const first = current.createSession(request());
    const rejected = expect(first).rejects.toThrow("startup failed");
    await vi.waitFor(() => expect(sdk.clients[0]?.start.mock.calls.length).toBe(1));
    fail(new Error("startup failed")); await rejected;
    expect(sdk.clients[0].stop).toHaveBeenCalledTimes(1);
    sdk.startGate = undefined;
    await expect(current.createSession(request())).resolves.toBeDefined();
    expect(sdk.clients).toHaveLength(2);
  });

  it("does not send a prompt when the caller already canceled the run", async () => {
    const current = driver();
    const acquired = await current.createSession(request());
    const abort = new AbortController(); abort.abort();
    await expect(current.executePrompt(acquired.session, acquired.prompt, () => {}, abort.signal)).resolves.toMatchObject({ status: "canceled" });
    expect(sdk.sessions[0].sendAndWait.mock.calls.length).toBe(0);
  });

  it("drains startup during shutdown without publishing or probing the retired client", async () => {
    let release!: () => void;
    let nativeLive = false;
    sdk.startGate = new Promise<void>((resolve) => { release = resolve; }).then(() => { nativeLive = true; });
    const current = driver();
    const opening = current.createSession(request());
    const rejected = expect(opening).rejects.toThrow("shut down");
    await vi.waitFor(() => expect(sdk.clients[0]?.start).toHaveBeenCalledTimes(1));
    sdk.clients[0].stop.mockImplementation(async () => { nativeLive = false; return []; });
    let closed = false;
    const closing = current.shutdown!().then(() => { closed = true; });
    try {
      await vi.waitFor(() => expect(sdk.clients[0].stop).toHaveBeenCalledTimes(1));
      expect(closed).toBe(false);
    } finally { release(); await Promise.all([rejected, closing]); }
    expect(nativeLive).toBe(false);
    expect(sdk.clients[0].ping).not.toHaveBeenCalled();
    expect(sdk.clients[0].createSession).not.toHaveBeenCalled();
    await expect(current.createSession(request())).rejects.toThrow("shut down");
    expect(sdk.clients).toHaveLength(1);
  });

  it("does not let a delayed todo read suppress the next turn's identical snapshot", async () => {
    const current = driver();
    const first = await current.createSession(request());
    let finishFirst!: (value: unknown) => void;
    let readFirst!: (value: unknown) => void;
    sdk.sessions[0].sendAndWait.mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve; }));
    sdk.sessions[0].rpc.plan = { readSqlTodos: vi.fn(() => new Promise((resolve) => { readFirst = resolve; })) };
    const firstEvents: WorkRunEvent[] = [];
    const firstTurn = current.executePrompt(first.session, first.prompt, (event) => { firstEvents.push(event); }, new AbortController().signal);
    await vi.waitFor(() => expect(sdk.sessions[0].sendAndWait).toHaveBeenCalledOnce());
    sdk.sessions[0].on.mock.calls[0][0]({ type: "session.todos_changed", data: {} });
    finishFirst({ data: { content: "first" } }); await firstTurn;

    const second = await current.resumeSession!({ ...request(), message: "continue" });
    const rows = { rows: [{ id: "todo-1", title: "Same task", status: "pending" }] };
    let finishSecond!: (value: unknown) => void;
    sdk.sessions[1].sendAndWait.mockReturnValueOnce(new Promise((resolve) => { finishSecond = resolve; }));
    sdk.sessions[1].rpc.plan = { readSqlTodos: vi.fn().mockResolvedValue(rows) };
    const secondEvents: WorkRunEvent[] = [];
    const secondTurn = current.executePrompt(second.session, second.prompt, (event) => { secondEvents.push(event); }, new AbortController().signal);
    try {
      await vi.waitFor(() => expect(sdk.sessions[1].sendAndWait).toHaveBeenCalledOnce());
      readFirst(rows); await new Promise<void>((resolve) => setImmediate(resolve));
      sdk.sessions[1].on.mock.calls[0][0]({ type: "session.todos_changed", data: {} });
      await vi.waitFor(() => expect(secondEvents.filter((event) => event.type === "tool_call" && event.toolName === "UpdateTodos")).toHaveLength(2));
      expect(firstEvents.filter((event) => event.type === "tool_call" && event.toolName === "UpdateTodos")).toHaveLength(0);
    } finally { finishSecond({ data: { content: "second" } }); await secondTurn; }
  });

  it.each(["native session lost", "native abort failed"])("fails on native error %s even when sendAndWait never settles", async (message) => {
    const current = driver();
    const acquired = await current.createSession(request());
    sdk.sessions[0].sendAndWait.mockReturnValueOnce(new Promise(() => {}));
    const controller = new AbortController();
    const turn = current.executePrompt(acquired.session, acquired.prompt, () => {}, controller.signal);
    let outcome: unknown;
    void turn.then((value) => { outcome = value; });
    try {
      await vi.waitFor(() => expect(sdk.sessions[0].sendAndWait).toHaveBeenCalledOnce());
      sdk.sessions[0].on.mock.calls[0][0]({ type: "session.error", data: { message, errorType: "transport" } });
      await vi.waitFor(() => expect(outcome).toMatchObject({ status: "failed", summary: message }));
      expect(sdk.sessions[0].disconnect).toHaveBeenCalledOnce();
    } finally { controller.abort(); await turn; }
  });

  it("rejects a retired session's plan callback instead of routing it into a resumed turn", async () => {
    const current = driver();
    const input = request({ configSnapshot: { permissionMode: "plan" } });
    const first = await current.createSession(input);
    const oldConfig = sdk.clients[0].createSession.mock.calls[0][0] as SessionConfig;
    await current.executePrompt(first.session, first.prompt, () => {}, new AbortController().signal);
    const next = await current.resumeSession!({ ...input, message: "continue" });
    let finish!: (value: unknown) => void;
    sdk.sessions[1].sendAndWait.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const events: WorkRunEvent[] = [];
    const turn = current.executePrompt(next.session, next.prompt, (event) => { events.push(event); }, new AbortController().signal);
    try {
      await vi.waitFor(() => expect(sdk.sessions[1].sendAndWait).toHaveBeenCalledOnce());
      await expect(oldConfig.onExitPlanModeRequest!({ planContent: "Retired plan", summary: "Retired plan", actions: ["exit_only"], recommendedAction: "exit_only" }, { sessionId: input.runId })).rejects.toThrow();
      expect(events).not.toContainEqual(expect.objectContaining({ toolName: "ExitPlanMode" }));
    } finally { finish({ data: { content: "ok" } }); await turn; }
  });

  it.each(["stop", "stream", "disconnect"])("retains failed %s ownership and retries only unfinished shutdown work", async (failure) => {
    const current = driver();
    const acquired = await current.createSession(request());
    if (failure !== "disconnect") {
      sdk.clients[0].stop.mockRejectedValueOnce(new Error("stop failed"));
      sdk.clients[0].forceStop.mockRejectedValueOnce(new Error(failure === "stream" ? "ERR_STREAM_DESTROYED" : "force stop failed"));
    } else sdk.sessions[0].disconnect.mockRejectedValueOnce(new Error("disconnect failed"));
    await expect(current.shutdown!()).rejects.toThrow("failed");
    await current.shutdown!();
    await current.cleanup!(acquired.session);
    expect(sdk.clients[0].stop).toHaveBeenCalledTimes(failure !== "disconnect" ? 2 : 1);
    expect(sdk.sessions[0].disconnect).toHaveBeenCalledTimes(failure === "disconnect" ? 2 : 1);
    await expect(current.createSession(request())).rejects.toThrow("shut down");
    expect(sdk.clients).toHaveLength(1);
  });

  it("keeps a prepared session's client until disconnect succeeds before applying new credentials", async () => {
    const current = driver({ cliUrl: undefined, githubToken: "old" });
    const prepared = await current.createSession(request());
    current.updateConfig!({ githubToken: "new" });
    sdk.sessions[0].disconnect.mockRejectedValueOnce(new Error("disconnect failed"));
    await expect(current.cleanup!(prepared.session)).rejects.toThrow("disconnect failed");
    await current.listModels!();
    expect(sdk.clients).toHaveLength(1);
    expect(sdk.clients[0].stop).not.toHaveBeenCalled();
    await current.cleanup!(prepared.session);
    await current.resumeSession!({ ...request(), message: "continue" });
    expect(sdk.clients[0].stop).toHaveBeenCalledOnce();
    expect(sdk.sessions[0].disconnect).toHaveBeenCalledTimes(2);
    expect(sdk.clients[1].options.gitHubToken).toBe("new");
  });

  it("joins a late session acquisition and disconnects it once during concurrent shutdown", async () => {
    const current = driver();
    await current.listModels!();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const create = sdk.clients[0].createSession.getMockImplementation();
    sdk.clients[0].createSession.mockImplementationOnce(async (config: SessionConfig) => {
      const value = await create(config); await gate; return value;
    });
    const opening = current.createSession(request());
    const rejected = expect(opening).rejects.toThrow("shut down");
    await vi.waitFor(() => expect(sdk.sessions).toHaveLength(1));
    const closing = [current.shutdown!(), current.shutdown!()];
    release();
    await Promise.all([rejected, ...closing]);
    expect(sdk.clients[0].stop).toHaveBeenCalledOnce();
    expect(sdk.sessions[0].disconnect).toHaveBeenCalledOnce();
    expect(sdk.sessions[0].sendAndWait).not.toHaveBeenCalled();
  });

  it.each(["abort", "timeout", "shutdown"])("settles a hanging send on %s and ignores its late reply", async (reason) => {
    const current = driver({ timeout: reason === "timeout" ? 25 : 60_000 });
    const acquired = await current.createSession(request());
    let release!: (value: unknown) => void;
    sdk.sessions[0].sendAndWait.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const controller = new AbortController();
    const events: WorkRunEvent[] = [];
    const turn = current.executePrompt(acquired.session, acquired.prompt, (event) => { events.push(event); }, controller.signal);
    let outcome: unknown;
    void turn.then((value) => { outcome = value; });
    try {
      await vi.waitFor(() => expect(sdk.sessions[0].sendAndWait).toHaveBeenCalledOnce());
      if (reason === "abort") controller.abort();
      if (reason === "shutdown") await current.shutdown!();
      await vi.waitFor(() => expect(outcome).toMatchObject({ status: reason === "timeout" ? "failed" : "canceled" }));
      expect(sdk.sessions[0].abort).toHaveBeenCalledOnce();
      expect(sdk.sessions[0].disconnect).toHaveBeenCalledOnce();
      const count = events.length;
      release({ data: { content: "late", messageId: "late-id" } });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(events).toHaveLength(count);
    } finally { release({ data: { content: "late" } }); await turn; }
  });

  it("discards retired listeners' idle, error, usage and output events on a resumed run", async () => {
    const current = driver();
    const first = await current.createSession(request());
    const oldEvents: WorkRunEvent[] = [];
    await current.executePrompt(first.session, first.prompt, (event) => { oldEvents.push(event); }, new AbortController().signal);
    const count = oldEvents.length;
    const oldListener = sdk.sessions[0].on.mock.calls[0][0];
    const next = await current.resumeSession!({ ...request(), message: "continue" });
    let release!: (value: unknown) => void;
    sdk.sessions[1].sendAndWait.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const events: WorkRunEvent[] = [];
    const turn = current.executePrompt(next.session, next.prompt, (event) => { events.push(event); }, new AbortController().signal);
    try {
      await vi.waitFor(() => expect(sdk.sessions[1].sendAndWait).toHaveBeenCalledOnce());
      for (const event of [
        { type: "session.idle", data: {} },
        { type: "session.error", data: { message: "old error" } },
        { type: "assistant.usage", data: { inputTokens: 999, outputTokens: 999 } },
        { type: "assistant.message", data: { content: "old output" } },
        { type: "tool.execution_start", data: { toolCallId: "old-tool", toolName: "write" } },
      ]) oldListener(event);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(oldEvents).toHaveLength(count);
      expect(events).toHaveLength(0);
    } finally { release({ data: { content: "current" } }); }
    await expect(turn).resolves.toMatchObject({ status: "succeeded", summary: "current", usage: undefined });
  });

  it("isolates identical native tool ids across concurrent runs and interrupts only the failed run", async () => {
    const current = driver();
    const first = await current.createSession(request({ runId: "first" }));
    const second = await current.createSession(request({ runId: "second" }));
    let fail!: (error: Error) => void;
    let finish!: (value: unknown) => void;
    sdk.sessions[0].sendAndWait.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
    sdk.sessions[1].sendAndWait.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const firstEvents: WorkRunEvent[] = [], secondEvents: WorkRunEvent[] = [];
    const firstTurn = current.executePrompt(first.session, first.prompt, (event) => { firstEvents.push(event); }, new AbortController().signal);
    const secondTurn = current.executePrompt(second.session, second.prompt, (event) => { secondEvents.push(event); }, new AbortController().signal);
    try {
      await vi.waitFor(() => expect(sdk.sessions[1].sendAndWait).toHaveBeenCalledOnce());
      sdk.sessions[0].on.mock.calls[0][0]({ type: "tool.execution_start", data: { toolCallId: "same-id", toolName: "write" } });
      sdk.sessions[1].on.mock.calls[0][0]({ type: "tool.execution_start", data: { toolCallId: "same-id", toolName: "read" } });
      fail(new Error("first failed"));
      await expect(firstTurn).resolves.toMatchObject({ status: "failed" });
      expect(firstEvents).toContainEqual(expect.objectContaining({ type: "tool_call", toolName: "write", metadata: expect.objectContaining({ phase: "complete", interrupted: true }) }));
      expect(secondEvents).toHaveLength(1);
      sdk.sessions[1].on.mock.calls[0][0]({ type: "tool.execution_end", data: { toolCallId: "same-id", result: "contents", success: true } });
      finish({ data: { content: "second" } });
      await expect(secondTurn).resolves.toMatchObject({ status: "succeeded" });
      expect(secondEvents).toContainEqual(expect.objectContaining({ type: "tool_call", toolName: "read", metadata: expect.objectContaining({ phase: "end" }) }));
    } finally { fail(new Error("done")); finish({ data: { content: "done" } }); await Promise.all([firstTurn, secondTurn]); }
  });

  it.each(["success", "error", "undefined"])("drains admitted output before releasing the session (projection: %s)", async (projection) => {
    sdk.events = [{ type: "assistant.message", data: { content: "projected output" } }];
    const current = driver();
    const acquired = await current.createSession(request());
    let resolve!: () => void, reject!: (error: unknown) => void;
    const projected = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const onEvent = vi.fn(() => projected);
    const turn = current.executePrompt(acquired.session, acquired.prompt, onEvent, new AbortController().signal);
    let settled = false;
    void turn.then(() => { settled = true; }, () => { settled = true; });
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    expect(sdk.sessions[0].disconnect).not.toHaveBeenCalled();
    if (projection !== "success") {
      reject(projection === "error" ? new Error("persistence failed") : undefined);
      if (projection === "error") await expect(turn).rejects.toThrow("persistence failed");
      else await expect(turn).rejects.toBeUndefined();
    } else {
      resolve();
      await expect(turn).resolves.toMatchObject({ status: "succeeded" });
    }
    expect(sdk.sessions[0].disconnect).toHaveBeenCalledOnce();
  });

  it("releases a client whose initialization ping fails before allowing a fresh startup", async () => {
    let release!: () => void;
    sdk.startGate = new Promise<void>((resolve) => { release = resolve; });
    const current = driver();
    const opening = current.createSession(request());
    const rejected = expect(opening).rejects.toThrow("init ping failed");
    await vi.waitFor(() => expect(sdk.clients[0]?.start).toHaveBeenCalledOnce());
    sdk.clients[0].ping.mockRejectedValueOnce(new Error("init ping failed"));
    release(); await rejected;
    expect(sdk.clients[0].stop).toHaveBeenCalledOnce();
    expect(sdk.clients[0].createSession).not.toHaveBeenCalled();
    sdk.startGate = undefined;
    await current.createSession(request());
    expect(sdk.clients).toHaveLength(2);
  });

  it.each(["generateText", "generateTitle", "listCommands"] as const)("owns and cancels a pending %s session during shutdown", async (operation) => {
    let release!: (value: unknown) => void;
    sdk.backgroundGate = new Promise((resolve) => { release = resolve; });
    const current = driver();
    const result = operation === "listCommands" ? current.listCommands!(fixture) : current[operation]!("summarize");
    const completed = operation === "listCommands" ? expect(result).resolves.toEqual([]) : expect(result).rejects.toThrow("shut down");
    await vi.waitFor(() => expect(sdk.sessions).toHaveLength(1));
    await vi.waitFor(() => expect(operation === "listCommands" ? sdk.sessions[0].rpc.commands.list : sdk.sessions[0].sendAndWait).toHaveBeenCalledOnce());
    await current.shutdown!(); await completed;
    expect(sdk.sessions[0].disconnect).toHaveBeenCalledOnce();
    release({ data: { content: "late" }, commands: [{ name: "late" }] });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(sdk.sessions[0].disconnect).toHaveBeenCalledOnce();
  });

  it("discards a model response arriving after shutdown without repopulating the cache", async () => {
    const current = driver();
    const prepared = await current.createSession(request());
    await current.cleanup!(prepared.session);
    let release!: (value: unknown) => void;
    sdk.clients[0].rpc.models.list.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const listing = current.listModels!();
    await vi.waitFor(() => expect(sdk.clients[0].rpc.models.list).toHaveBeenCalledOnce());
    await current.shutdown!();
    await expect(listing).resolves.toEqual([]);
    release({ models: CATALOGUE });
    await new Promise<void>((resolve) => setImmediate(resolve));
    await expect(current.listModels!()).resolves.toEqual([]);
    expect(sdk.clients).toHaveLength(1);
    expect(sdk.clients[0].rpc.models.list).toHaveBeenCalledOnce();
  });

  it("rejects an approval delivered after its owning session was cleaned up", async () => {
    const current = driver();
    await current.createSession(request());
    const config = sdk.clients[0].createSession.mock.calls[0][0] as SessionConfig;
    let approve!: (value: unknown) => void;
    approvals.request.mockReturnValueOnce(new Promise((resolve) => { approve = resolve; }));
    const answer = config.onPermissionRequest!({ kind: "url", url: "https://example.test", intention: "Fetch" }, { sessionId: "run-fast" });
    const rejected = expect(answer).rejects.toThrow();
    await current.shutdown!();
    approve({ approved: true }); await rejected;
    await expect(config.onUserInputRequest!({ question: "Old question" }, { sessionId: "run-fast" })).rejects.toThrow();
    expect(approvals.request).toHaveBeenCalledOnce();
  });

  it("does not interrupt an earlier turn's unfinished tool when a resumed turn fails", async () => {
    sdk.events = [{ type: "tool.execution_start", data: { toolCallId: "old-tool", toolName: "write" } }];
    const current = driver();
    const first = await current.createSession(request());
    await current.executePrompt(first.session, first.prompt, () => {}, new AbortController().signal);
    sdk.events = [];
    const next = await current.resumeSession!({ ...request(), message: "continue" });
    sdk.sessions[1].sendAndWait.mockRejectedValueOnce(new Error("next failed"));
    const events: WorkRunEvent[] = [];
    await expect(current.executePrompt(next.session, next.prompt, (event) => { events.push(event); }, new AbortController().signal)).resolves.toMatchObject({ status: "failed" });
    expect(events.filter((event) => event.type === "tool_call")).toHaveLength(0);
  });

  it("finishes an admitted todo start/complete pair before disconnecting when the prompt ends", async () => {
    const current = driver();
    const acquired = await current.createSession(request());
    let finish!: (value: unknown) => void, project!: () => void;
    sdk.sessions[0].sendAndWait.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    sdk.sessions[0].rpc.plan = { readSqlTodos: vi.fn().mockResolvedValue({ rows: [{ title: "Task", status: "pending" }] }) };
    const projecting = new Promise<void>((resolve) => { project = resolve; });
    const events: WorkRunEvent[] = [];
    const turn = current.executePrompt(acquired.session, acquired.prompt, async (event) => {
      events.push(event);
      if (events.length === 1) await projecting;
    }, new AbortController().signal);
    try {
      await vi.waitFor(() => expect(sdk.sessions[0].sendAndWait).toHaveBeenCalledOnce());
      sdk.sessions[0].on.mock.calls[0][0]({ type: "session.todos_changed", data: {} });
      await vi.waitFor(() => expect(events).toHaveLength(1));
      finish({ data: { content: "done" } });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(sdk.sessions[0].disconnect).not.toHaveBeenCalled();
    } finally { project(); finish({ data: { content: "done" } }); await turn; }
    expect(events).toHaveLength(2);
    expect(events).toMatchObject([{ metadata: { phase: "start" } }, { metadata: { phase: "complete" } }]);
  });

  it("enables Auto's latency preset from the conversation snapshot on create and resume", async () => {
    const current = driver({ fastMode: false });
    const input = request({ configSnapshot: { fastMode: true, modelReasoningEffort: "high" } });
    await current.createSession(input);
    await current.resumeSession!({ ...input, message: "continue" });
    expect(sdk.clients[0].createSession).toHaveBeenCalledWith(expect.objectContaining({
      model: "auto", capi: { autoTier: "fast" }, reasoningEffort: "high", streaming: true,
    }));
    expect(sdk.clients[0].resumeSession).toHaveBeenCalledWith("run-fast", expect.objectContaining({
      model: "auto", capi: { autoTier: "fast" }, reasoningEffort: "high", streaming: true,
    }));
    expect(sdk.sessions.every((session) => session.setAutoTier.mock.calls.length === 0)).toBe(true);
  });

  it("uses the provider's Auto and Fast defaults when no conversation override exists", async () => {
    await driver({ defaultModel: "auto", fastMode: true }).createSession(request({ model: undefined }));
    expect(sdk.clients[0].createSession).toHaveBeenCalledWith(expect.objectContaining({
      model: "auto", capi: { autoTier: "fast" },
    }));
  });

  it("honors explicit false over the provider default and clears a resumed session's saved Fast preference", async () => {
    sdk.inheritedTier = "fast";
    const current = driver({ fastMode: true });
    const input = request({ configSnapshot: { fastMode: false } });
    await current.createSession(input);
    await current.resumeSession!({ ...input, message: "continue" });
    expect(sdk.clients[0].createSession.mock.calls[0][0]).not.toHaveProperty("capi");
    expect(sdk.clients[0].resumeSession.mock.calls[0][1]).not.toHaveProperty("capi");
    expect(sdk.sessions[0].setAutoTier).not.toHaveBeenCalled();
    expect(sdk.sessions[1].setAutoTier).toHaveBeenCalledWith(null);
  });

  it("keeps Fast preferences away from fixed models when changing the selected model", async () => {
    sdk.inheritedTier = "fast";
    const current = driver();
    await current.createSession(request({ configSnapshot: { fastMode: true } }));
    await current.resumeSession!({ ...request({ model: "fixed-model", configSnapshot: { fastMode: true } }), message: "fixed" });
    await current.resumeSession!({ ...request({ configSnapshot: { fastMode: false } }), message: "auto again" });
    expect(sdk.clients[0].resumeSession.mock.calls[0][1]).toMatchObject({ model: "fixed-model" });
    expect(sdk.clients[0].resumeSession.mock.calls[0][1]).not.toHaveProperty("capi");
    expect(sdk.sessions[1].setAutoTier).not.toHaveBeenCalled();
    expect(sdk.sessions[2].setAutoTier).toHaveBeenCalledWith(null);
  });

  it.each([true, false])("ignores Fast = %s for a newly selected fixed model", async (fastMode) => {
    await driver({ fastMode }).createSession(request({ model: "fixed-model" }));
    expect(sdk.clients[0].createSession.mock.calls[0][0]).not.toHaveProperty("capi");
    expect(sdk.sessions[0].setAutoTier).not.toHaveBeenCalled();
  });

  it.each([true, false])("applies Fast = %s to an inherited Auto session without guessing its model", async (fastMode) => {
    sdk.inheritedTier = "fast";
    await driver().resumeSession!({ ...request({ model: undefined, configSnapshot: { fastMode } }), message: "continue" });
    expect(sdk.sessions[0].rpc.model.getCurrent).toHaveBeenCalledOnce();
    expect(sdk.sessions[0].setAutoTier).toHaveBeenCalledWith(fastMode ? "fast" : null);
  });

  it("does not change Auto routing when the inherited native model is fixed", async () => {
    sdk.inheritedModel = "fixed-model";
    await driver({ fastMode: true }).resumeSession!({ ...request({ model: undefined }), message: "continue" });
    expect(sdk.sessions[0].rpc.model.getCurrent).toHaveBeenCalledOnce();
    expect(sdk.sessions[0].setAutoTier).not.toHaveBeenCalled();
  });

  it("applies Fast to a new native default Auto session when no model was specified", async () => {
    await driver({ fastMode: true }).createSession(request({ model: undefined }));
    expect(sdk.sessions[0].setAutoTier).toHaveBeenCalledWith("fast");
  });

  it("preserves native routing when neither conversation nor provider specified Fast Mode", async () => {
    await driver().resumeSession!({ ...request(), message: "continue" });
    expect(sdk.clients[0].resumeSession.mock.calls[0][1]).not.toHaveProperty("capi");
    expect(sdk.sessions[0].setAutoTier).not.toHaveBeenCalled();
  });

  it.each([undefined, "efficiency", "balance", "intelligence"])("preserves normal Auto routing (%s) with Fast off", async (autoTier) => {
    sdk.inheritedTier = autoTier;
    sdk.tierError = new Error("Auto V2 tiers unsupported");
    await driver().resumeSession!({ ...request({ configSnapshot: { fastMode: false } }), message: "continue" });
    expect(sdk.sessions[0].setAutoTier).not.toHaveBeenCalled();
  });

  it.each(["pendingTier", "activatingTier"] as const)("cancels an uncommitted Fast request (%s) when the user turns it off", async (key) => {
    sdk.inheritedTier = "balance";
    sdk[key] = "fast";
    await driver().resumeSession!({ ...request({ configSnapshot: { fastMode: false } }), message: "continue" });
    expect(sdk.sessions[0].setAutoTier).toHaveBeenCalledWith(null);
  });

  it("offers Fast only for Auto in the live model catalogue", async () => {
    expect(await driver().listModels!()).toEqual([
      expect.objectContaining({ id: "auto", supportsFastMode: true }),
      expect.objectContaining({ id: "fixed-model", supportsFastMode: false, supportsEffort: true }),
    ]);
  });

  it("lists each model once when the runtime repeats its catalogue", async () => {
    sdk.catalogue = [...CATALOGUE, ...CATALOGUE];
    const models = await driver().listModels!();
    expect(models.map((model) => model.id)).toEqual(["auto", "fixed-model"]);
  });

  it("releases the acquired session and propagates an unsupported runtime's reset error", async () => {
    sdk.inheritedTier = "fast";
    sdk.tierError = new Error("Auto tier switching is unsupported");
    await expect(driver().resumeSession!({ ...request({ configSnapshot: { fastMode: false } }), message: "continue" }))
      .rejects.toThrow("Auto tier switching is unsupported");
    expect(sdk.sessions[0].disconnect).toHaveBeenCalledOnce();
    expect(sdk.sessions[0].sendAndWait).not.toHaveBeenCalled();
  });

  it("surfaces delayed activation failures even though the SDK marks them ephemeral", async () => {
    sdk.events = [{ type: "session.auto_tier_switch_failed", ephemeral: true,
      data: { requestedAutoTier: "fast", reason: "policy_rejected" } }];
    const current = driver();
    const acquired = await current.createSession(request({ configSnapshot: { fastMode: true } }));
    const events: WorkRunEvent[] = [];
    await current.executePrompt(acquired.session, acquired.prompt, (event) => { events.push(event); }, new AbortController().signal);
    expect(events).toContainEqual(expect.objectContaining({
      type: "log", level: "warn", message: expect.stringContaining("policy_rejected"),
    }));
  });

  it.each([
    { kind: "read", path: "/tmp/file", intention: "Read workspace file" },
    { kind: "shell", fullCommandText: "pwd", intention: "Read current directory", commands: [],
      canOfferSessionApproval: false, hasWriteFileRedirection: false, possiblePaths: [], possibleUrls: [] },
    { kind: "custom-tool", toolName: "mcp__mains__SaveFinding", toolDescription: "Save a finding" },
  ] satisfies PermissionRequest[])("returns execution grants for trusted $kind permissions", async (input) => {
    await driver().createSession(request());
    const config = sdk.clients[0].createSession.mock.calls[0][0] as SessionConfig;
    expect(await config.onPermissionRequest!(input, { sessionId: "run-fast" })).toEqual({ kind: "approve-once" });
    expect(approvals.request).not.toHaveBeenCalled();
  });

  it.each(["default", "acceptEdits", "bypassPermissions", "allow"])("requires an interactive managed approval in %s mode on create and resume", async (permissionMode) => {
    const current = driver();
    const input = request({ configSnapshot: { permissionMode } });
    await current.createSession(input);
    await current.resumeSession!({ ...input, message: "continue" });
    const configs: SessionConfig[] = [sdk.clients[0].createSession.mock.calls[0][0], sdk.clients[0].resumeSession.mock.calls[0][1]];
    for (const config of configs) {
      const permission: PermissionRequest = { kind: "read", path: fixture, intention: "Read workspace", managedApprovalRequired: true };
      expect(await config.onPermissionRequest!(permission, { sessionId: "run-fast", managedSettingsEnabled: true }))
        .toEqual({ kind: "approve-once", approvedInteractively: true });
    }
    expect(approvals.request).toHaveBeenCalledTimes(2);
    expect(approvals.request).toHaveBeenCalledWith(expect.objectContaining({
      kind: "tool_approval", toolName: "Read", toolInput: { file_path: fixture },
    }));
  });

  it("rejects a managed permission when the user declines it even in bypass mode", async () => {
    approvals.request.mockResolvedValue({ requestId: "denied", approved: false });
    await driver({ permissionMode: "bypassPermissions" }).createSession(request());
    const config = sdk.clients[0].createSession.mock.calls[0][0] as SessionConfig;
    expect(await config.onPermissionRequest!({ kind: "custom-tool", toolName: "mcp__mains__SaveFinding",
      toolDescription: "Save a finding", managedApprovalRequired: true }, { sessionId: "run-fast" }))
      .toEqual({ kind: "reject" });
    expect(approvals.request).toHaveBeenCalledOnce();
  });

  it("records interactive approval for an ordinary untrusted permission", async () => {
    await driver().createSession(request());
    const config = sdk.clients[0].createSession.mock.calls[0][0] as SessionConfig;
    expect(await config.onPermissionRequest!({ kind: "url", url: "https://example.test", intention: "Fetch documentation" }, { sessionId: "run-fast" }))
      .toEqual({ kind: "approve-once", approvedInteractively: true });
    expect(approvals.request).toHaveBeenCalledOnce();
  });

  it("routes native file permissions through the canonical diff approval payload", async () => {
    await driver().createSession(request());
    const config = sdk.clients[0].createSession.mock.calls[0][0] as SessionConfig;
    const diff = "--- a/file.ts\n+++ b/file.ts\n@@ -1,1 +1,1 @@\n-old\n+new";
    await config.onPermissionRequest!({ kind: "write", fileName: "file.ts", diff, intention: "Update file",
      canOfferSessionApproval: true, toolCallId: "internal-id" }, { sessionId: "run-fast" });
    expect(approvals.request).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "Edit", toolInput: { file_path: "file.ts", diff }, question: "Allow editing this file?", description: "Update file",
    }));
  });

  it("decodes native skill hook arguments before asking the user", async () => {
    await driver().createSession(request());
    const config = sdk.clients[0].createSession.mock.calls[0][0] as SessionConfig;
    await config.hooks!.onPreToolUse!({ sessionId: "run-fast", toolName: "skill", toolArgs: '{"skill":"frontend-design"}',
      timestamp: new Date(), workingDirectory: fixture }, { sessionId: "run-fast" });
    expect(approvals.request).toHaveBeenCalledWith(expect.objectContaining({ toolName: "skill", toolInput: { skill: "frontend-design" } }));
  });

  it("keeps bypass grants for permissions that do not require a managed approval", async () => {
    await driver({ permissionMode: "bypassPermissions" }).createSession(request());
    const config = sdk.clients[0].createSession.mock.calls[0][0] as SessionConfig;
    expect(await config.onPermissionRequest!({ kind: "url", url: "https://example.test", intention: "Fetch documentation" }, { sessionId: "run-fast" }))
      .toEqual({ kind: "approve-once" });
    expect(approvals.request).not.toHaveBeenCalled();
  });

  it("adapts the SDK's Date and workingDirectory hook fields for the package guard", async () => {
    const guard = vi.fn().mockResolvedValue({ permissionDecision: "deny", permissionDecisionReason: "Blocked package" });
    approvals.guard.mockResolvedValue(guard);
    await driver().createSession(request());
    const config = sdk.clients[0].createSession.mock.calls[0][0] as SessionConfig;
    const timestamp = new Date("2026-10-03T00:00:00Z");
    const input = { sessionId: "run-fast", toolName: "bash", toolArgs: { command: "npm install blocked-package" }, timestamp, workingDirectory: fixture };
    expect(await config.hooks!.onPreToolUse!(input, { sessionId: "run-fast" }))
      .toEqual({ permissionDecision: "deny", permissionDecisionReason: "Blocked package" });
    expect(guard).toHaveBeenCalledWith({ toolName: "bash", toolArgs: input.toolArgs, timestamp: timestamp.getTime(), cwd: fixture });
  });

  it("denies policy-excluded tools before the bypass hook can grant them", async () => {
    await driver({ permissionMode: "bypassPermissions" }).createSession(request({ toolPolicy: { allowedTools: null, disallowedTools: ["Bash"] } }));
    const config = sdk.clients[0].createSession.mock.calls[0][0] as SessionConfig;
    expect(await config.hooks!.onPreToolUse!({ sessionId: "run-fast", toolName: "bash", toolArgs: { command: "pwd" },
      timestamp: new Date(), workingDirectory: fixture }, { sessionId: "run-fast" }))
      .toEqual({ permissionDecision: "deny", permissionDecisionReason: "Tool not available in this space mode" });
    expect(approvals.guard).not.toHaveBeenCalled();
  });

  it("preserves current SDK tool correlation, structured errors and assistant results", async () => {
    sdk.events = [
      { type: "tool.execution_start", id: "start", data: { toolCallId: "tool-1", toolName: "write", arguments: { path: "file.txt" } } },
      { type: "tool.execution_complete", id: "complete", data: { toolCallId: "tool-1", success: false, error: { code: "DENIED", message: "Access denied" } } },
      { type: "assistant.message", data: { content: "done" } },
    ];
    const current = driver();
    const acquired = await current.createSession(request());
    const events: WorkRunEvent[] = [];
    expect(await current.executePrompt(acquired.session, acquired.prompt, (event) => { events.push(event); }, new AbortController().signal))
      .toMatchObject({ status: "succeeded", summary: "ok" });
    expect(events).toContainEqual(expect.objectContaining({ type: "tool_call", toolName: "write", input: { path: "file.txt" },
      error: "Access denied (DENIED)", metadata: expect.objectContaining({ phase: "complete", toolCallId: "tool-1" }) }));
    expect(events).toContainEqual(expect.objectContaining({ type: "artifact", content: "done" }));
  });

  describe("streaming", () => {
    it("confirms only the response returned after idle, including all chunks from its API call", async () => {
      sdk.events = [
        { type: "assistant.message", data: { messageId: "progress", apiCallId: "call-1", content: "Working" } },
        { type: "assistant.turn_end", data: { turnId: "turn-1" } },
        { type: "assistant.message", data: { messageId: "part-1", apiCallId: "call-2", content: "First part" } },
        { type: "assistant.message", data: { messageId: "part-2", apiCallId: "call-2", content: "Second part" } },
      ];
      sdk.result = sdk.events[3];
      const current = driver();
      const acquired = await current.createSession(request());
      const events: WorkRunEvent[] = [];
      await current.executePrompt(acquired.session, acquired.prompt, (event) => { events.push(event); }, new AbortController().signal);
      expect(events.filter((event) => event.type === "message_phase"))
        .toEqual([{ type: "message_phase", messageId: "call-2", phase: "final_answer" }]);
      expect(events.filter((event) => event.type === "artifact" && event.kind === "report"))
        .toEqual(["call-1", "call-2", "call-2"].map((providerMessageId) => expect.objectContaining({
          metadata: expect.objectContaining({ providerMessageId, messagePhase: "commentary" }),
        })));
    });

    it("accumulates interleaved messages independently and reconciles corrected final text by identity", async () => {
      sdk.events = [
        { type: "assistant.message_delta", ephemeral: true, data: { messageId: "a", deltaContent: "Mer" } },
        { type: "assistant.message_delta", ephemeral: true, data: { messageId: "b", deltaContent: "Other" } },
        { type: "assistant.message_delta", ephemeral: true, data: { messageId: "a", deltaContent: "haba 🌍" } },
        { type: "assistant.message", data: { messageId: "a", content: "Merhaba!" } },
        { type: "assistant.message_delta", ephemeral: true, data: { messageId: "b", deltaContent: " text" } },
        { type: "assistant.message", data: { messageId: "b", content: "Other text" } },
      ];
      const current = driver();
      const acquired = await current.createSession(request());
      const events: WorkRunEvent[] = [];
      await current.executePrompt(acquired.session, acquired.prompt, (event) => { events.push(event); }, new AbortController().signal);
      const artifacts = events.filter((event) => event.type === "artifact");
      expect(artifacts.filter((event) => event.ephemeral).map((event) => [event.streamId, event.content])).toEqual([
        ["copilot-msg-run-fast-a", "Mer"], ["copilot-msg-run-fast-b", "Other"],
        ["copilot-msg-run-fast-a", "Merhaba 🌍"], ["copilot-msg-run-fast-a", "Merhaba!"],
        ["copilot-msg-run-fast-b", "Other text"], ["copilot-msg-run-fast-b", "Other text"],
      ]);
      expect(artifacts.filter((event) => !event.ephemeral)).toEqual([
        expect.objectContaining({ kind: "report", content: "Merhaba!", metadata: expect.objectContaining({ source: "assistant.message", streamId: "copilot-msg-run-fast-a" }) }),
        expect.objectContaining({ kind: "report", content: "Other text", metadata: expect.objectContaining({ source: "assistant.message", streamId: "copilot-msg-run-fast-b" }) }),
      ]);
    });

    it("keeps reasoning out of response text and clears its preview when the block completes", async () => {
      sdk.events = [
        { type: "assistant.reasoning_delta", ephemeral: true, data: { reasoningId: "r", deltaContent: "Checking " } },
        { type: "assistant.message_delta", ephemeral: true, data: { messageId: "m", deltaContent: "Hello" } },
        { type: "assistant.reasoning_delta", ephemeral: true, data: { reasoningId: "r", deltaContent: "files" } },
        { type: "assistant.reasoning", data: { reasoningId: "r", content: "Checking files" } },
        { type: "assistant.message", data: { messageId: "m", content: "Hello" } },
      ];
      const current = driver();
      const acquired = await current.createSession(request());
      const events: WorkRunEvent[] = [];
      await current.executePrompt(acquired.session, acquired.prompt, (event) => { events.push(event); }, new AbortController().signal);
      expect(events.filter((event) => event.type === "artifact").filter((event) => event.kind === "thinking").map((event) => event.content))
        .toEqual(["Checking ", "Checking files", ""]);
      expect(events).toContainEqual(expect.objectContaining({ type: "artifact", kind: "report", content: "Hello", ephemeral: true }));
      expect(events).toContainEqual(expect.objectContaining({ type: "log", message: "[reasoning] Checking files" }));
    });

    it("ignores subagent deltas, malformed chunks and unrelated ephemeral events", async () => {
      sdk.events = [
        { type: "assistant.message_delta", ephemeral: true, agentId: "child", data: { messageId: "m", deltaContent: "child text" } },
        { type: "assistant.message_delta", ephemeral: true, data: { parentToolCallId: "child-tool", messageId: "m", deltaContent: "legacy child" } },
        { type: "assistant.reasoning_delta", ephemeral: true, agentId: "child", data: { reasoningId: "r", deltaContent: "child reasoning" } },
        { type: "assistant.message_delta", ephemeral: true, data: { deltaContent: "missing id" } },
        { type: "assistant.message_delta", ephemeral: true, data: { messageId: "m", deltaContent: 42 } },
        { type: "assistant.message_delta", ephemeral: true, data: { messageId: "m", deltaContent: "" } },
        { type: "assistant.intent", ephemeral: true, data: { intent: "noise" } },
        { type: "assistant.message_delta", ephemeral: true, data: { messageId: "m", deltaContent: "Main text" } },
        { type: "assistant.message", data: { messageId: "m", content: "Main text" } },
      ];
      const current = driver();
      const acquired = await current.createSession(request());
      const events: WorkRunEvent[] = [];
      await current.executePrompt(acquired.session, acquired.prompt, (event) => { events.push(event); }, new AbortController().signal);
      expect(events.map((event) => event.type === "artifact" ? event.content : "unexpected")).toEqual(["Main text", "Main text", "Main text"]);
    });

    it("streams legacy top-level envelopes and starts a fresh buffer on resume", async () => {
      const current = driver();
      const events: WorkRunEvent[] = [];
      for (const content of ["first", "second"]) {
        sdk.events = [
          { type: "assistant.message_delta", ephemeral: true, messageId: "same-id", deltaContent: content },
          { type: "assistant.message", messageId: "same-id", content },
        ];
        const acquired = content === "first" ? await current.createSession(request())
          : await current.resumeSession!({ ...request(), message: "continue" });
        await current.executePrompt(acquired.session, acquired.prompt, (event) => { events.push(event); }, new AbortController().signal);
      }
      expect(events.filter((event) => event.type === "artifact").filter((event) => event.ephemeral).map((event) => event.content))
        .toEqual(["first", "first", "second", "second"]);
    });

    it.each(["failed", "canceled"])("clears unfinished message and reasoning previews on %s turns", async (status) => {
      const current = driver();
      const acquired = await current.createSession(request());
      const controller = new AbortController();
      sdk.sessions[0].sendAndWait.mockImplementationOnce(async () => {
        const listener = sdk.sessions[0].on.mock.calls[0][0];
        listener({ type: "assistant.message_delta", ephemeral: true, data: { messageId: "m", deltaContent: "partial" } });
        listener({ type: "assistant.reasoning_delta", ephemeral: true, data: { reasoningId: "r", deltaContent: "checking" } });
        if (status === "canceled") {
          controller.abort();
          listener({ type: "assistant.message_delta", ephemeral: true, data: { messageId: "m", deltaContent: "late" } });
        }
        throw new Error("Runtime stopped");
      });
      const events: WorkRunEvent[] = [];
      expect(await current.executePrompt(acquired.session, acquired.prompt, (event) => { events.push(event); }, controller.signal))
        .toMatchObject({ status });
      const artifacts = events.filter((event) => event.type === "artifact");
      expect(artifacts.map((event) => event.content)).toEqual(["partial", "checking", "", ""]);
      expect(artifacts.every((event) => event.ephemeral)).toBe(true);
    });

    it("clears a preview when the final message is empty instead of persisting incomplete text", async () => {
      sdk.events = [
        { type: "assistant.message_delta", ephemeral: true, data: { messageId: "m", deltaContent: "discarded" } },
        { type: "assistant.message", data: { messageId: "m", content: "" } },
      ];
      const current = driver();
      const acquired = await current.createSession(request());
      const events: WorkRunEvent[] = [];
      await current.executePrompt(acquired.session, acquired.prompt, (event) => { events.push(event); }, new AbortController().signal);
      expect(events).toEqual([
        expect.objectContaining({ type: "artifact", ephemeral: true, content: "discarded" }),
        expect.objectContaining({ type: "artifact", ephemeral: true, content: "" }),
      ]);
    });
  });

  it("keeps legacy external runtime tool envelopes readable at the event boundary", async () => {
    sdk.events = [
      { type: "tool.execution_start", toolCallId: "tool-legacy", toolName: "read", toolInput: { path: "file.txt" } },
      { type: "tool.execution_end", toolCallId: "tool-legacy", toolOutput: "contents", success: true },
    ];
    const current = driver();
    const acquired = await current.createSession(request());
    const events: WorkRunEvent[] = [];
    await current.executePrompt(acquired.session, acquired.prompt, (event) => { events.push(event); }, new AbortController().signal);
    expect(events).toContainEqual(expect.objectContaining({ type: "tool_call", toolName: "read", input: { path: "file.txt" }, output: "contents",
      metadata: expect.objectContaining({ phase: "end", toolCallId: "tool-legacy" }) }));
  });

  it("takes credentials only from provider configuration, never from conversation snapshots", async () => {
    await driver({ cliUrl: undefined, githubToken: "test-provider-token", useLoggedInUser: false }).createSession(request({
      configSnapshot: { githubToken: "test-conversation-token", useLoggedInUser: true },
    }));
    expect(sdk.clients[0].options).toMatchObject({ gitHubToken: "test-provider-token", useLoggedInUser: false });
    expect(sdk.clients[0].createSession.mock.calls[0][0]).not.toHaveProperty("gitHubToken");
  });

  it("defers an auth restart until an active turn finishes, then applies new credentials on resume", async () => {
    const current = driver({ cliUrl: undefined, githubToken: "test-old-token" });
    const acquired = await current.createSession(request());
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => { finish = resolve; });
    sdk.sessions[0].sendAndWait.mockReturnValueOnce(pending);
    const turn = current.executePrompt(acquired.session, acquired.prompt, () => {}, new AbortController().signal);
    current.updateConfig!({ githubToken: "test-new-token", useLoggedInUser: false });
    await current.listModels!();
    expect(sdk.clients).toHaveLength(1);
    expect(sdk.clients[0].stop).not.toHaveBeenCalled();
    finish({ type: "assistant.message", data: { content: "ok" } });
    await turn;
    await current.resumeSession!({ ...request(), message: "continue" });
    expect(sdk.clients[0].stop).toHaveBeenCalledOnce();
    expect(sdk.clients[1].options).toMatchObject({ gitHubToken: "test-new-token", useLoggedInUser: false });
  });

  it("preserves legacy assistant text for background generation and defers managed permissions", async () => {
    sdk.result = { type: "assistant.message", content: "Legacy Output" };
    const current = driver();
    expect(await current.generateText!("summarize")).toBe("Legacy Output");
    expect(await current.generateTitle!("summarize")).toBe("Legacy Output");
    const config = sdk.clients[0].createSession.mock.calls[0][0] as SessionConfig;
    const permission: PermissionRequest = { kind: "read", path: fixture, intention: "Read workspace", managedApprovalRequired: true };
    expect(await config.onPermissionRequest!(permission, { sessionId: "background" })).toEqual({ kind: "no-result" });
    expect(approvals.request).not.toHaveBeenCalled();
    expect(sdk.sessions.every((session) => session.disconnect.mock.calls.length === 1)).toBe(true);
  });
});
