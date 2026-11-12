import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installTestBackendRuntime } from "../../../../../test/backend-runtime";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkRunEvent, WorkRunEventHandler } from "../../../../../shared/adapter.types";
import { ResourceCleanupError } from "../../../../runtime/resource-lifecycle";
import { createCursorDriver } from "./cursor.driver";
import { createWorkRunAdapter } from "../work-run-core";
import { projectRunDeliverables } from "../../../runs/run-deliverables";
import type { RunArtifactResponse } from "../../../runs/runs.dto";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), updateRun: vi.fn(), approval: vi.fn(), bridgeStart: vi.fn(), bridges: [] as any[] }));
vi.mock("node:child_process", async (original) => ({
  ...await original<typeof import("node:child_process")>(), spawn: mocks.spawn,
}));
vi.mock("../../../runs/runs.repo", () => ({ runsRepo: { updateRun: mocks.updateRun } }));
vi.mock("../../../runs/user-input-broker", () => ({ requestToolApproval: mocks.approval, cancelPendingRequests: vi.fn() }));
vi.mock("../mains-mcp-server", () => ({
  MainsMcpStdioServer: class {
    isRunning = false;
    constructor() { mocks.bridges.push(this); }
    mcpConfig = { name: "mains", command: "fixture", args: [], env: [] };
    start = vi.fn(async () => { await mocks.bridgeStart(); this.isRunning = true; });
    stop = vi.fn(async () => { this.isRunning = false; });
    setEventHandler = vi.fn();
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
  holdMethod?: string;
  held: RpcMessage[] = [];
  onPrompt: (message: RpcMessage) => void = () => {};
  onRpc?: (message: RpcMessage) => boolean;
  stdin = new Writable({ write: (chunk, _encoding, done) => {
    const message = JSON.parse(chunk.toString()) as RpcMessage;
    this.calls.push(message);
    queueMicrotask(() => {
      if (this.onRpc?.(message)) return;
      if (message.method === this.holdMethod) { this.held.push(message); return; }
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
  let temporary: string;
  let restoreRuntime: () => void;
  beforeEach(() => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "mains-cursor-"));
    restoreRuntime = installTestBackendRuntime({ getPath: () => temporary });
    fixture = new AcpFixture();
    mocks.bridges.length = 0;
    mocks.spawn.mockReset().mockImplementation(() => { queueMicrotask(() => fixture.emit("spawn")); return fixture; });
    mocks.updateRun.mockResolvedValue(undefined);
    mocks.approval.mockReset().mockResolvedValue({ approved: true });
    mocks.bridgeStart.mockReset().mockResolvedValue(undefined);
    driver = createCursorDriver({ binary: "/fixture/agent" });
  });
  afterEach(async () => {
    await driver.shutdown?.(); restoreRuntime();
    fs.rmSync(temporary, { recursive: true, force: true });
    vi.restoreAllMocks(); vi.clearAllMocks();
  });

  async function acquire(runId = "run-1", cwd = "/fixture") {
    return driver.createSession({ runId, accountId: "account-1", execution: { cwd, workspaceId: null }, goal: "hi" });
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

  it.each(["request", "notification"])("delivers Cursor's native image outside the workspace from an extension %s", async (transport) => {
    const home = path.join(temporary, "home");
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const cwd = path.join(temporary, "workspace");
    fs.mkdirSync(cwd);
    const project = cwd.replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
    const source = path.join(home, ".cursor", "projects", project, "assets", "turkish-flag.jpg");
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, "generated image bytes");
    const acquired = await acquire("run-1", cwd);
    const events: WorkRunEvent[] = [];
    fixture.onRpc = (message) => !message.method;
    fixture.onPrompt = (message) => {
      // Installed Cursor 2026.10.22 calls extMethod (a JSON-RPC request),
      // even though its documentation calls this a notification. No sessionId.
      fixture.send({ ...(transport === "request" ? { id: 77 } : {}), method: "cursor/generate_image",
        params: { toolCallId: "image-call", description: "Turkish flag", filePath: source, referenceImagePaths: ["reference.png"] } });
      fixture.text(acquired.sessionId!, "Turkish flag image generated — red field with white crescent and star.");
      fixture.finish(message);
    };
    const outcome = await driver.executePrompt(acquired.session, acquired.prompt, (event) => { events.push(event); }, new AbortController().signal);
    expect(outcome.status).toBe("succeeded");
    const images = events.filter((event) => event.type === "artifact" && event.kind === "image");
    expect(images).toHaveLength(1);
    const image = images[0];
    if (image.type !== "artifact") throw new Error("Expected image artifact");
    expect(image.metadata).toMatchObject({ source: "cursor_image_generation", outputRole: "deliverable", toolCallId: "image-call" });
    expect(path.relative(path.join(temporary, "generated-images", "run-1"), image.path!)).not.toMatch(/^\.\./);
    expect(fs.readFileSync(image.path!, "utf8")).toBe("generated image bytes");
    const artifacts = events.flatMap((event, index): RunArtifactResponse[] => event.type === "artifact" && !event.ephemeral
      ? [{ id: index + 1, runId: "run-1", kind: event.kind as RunArtifactResponse["kind"], path: event.path ?? null, content: event.content ?? null,
        metadata: event.metadata ?? null, createdAt: new Date(index), blobData: null, contentHash: null, entityId: null }] : []);
    const outputs = await projectRunDeliverables({ runId: "run-1", root: cwd,
      extraRoots: [path.join(temporary, "generated-images", "run-1")], artifacts, turns: [], terminal: true });
    expect(outputs.filter((row) => row.metadata?.outputSelected)).toEqual([expect.objectContaining({ kind: "image", path: fs.realpathSync.native(image.path!) })]);
    if (transport === "request") expect(fixture.calls).toContainEqual(expect.objectContaining({ id: 77, result: {} }));
  });

  it.each(["initialize", "authenticate"])("retires pending %s instead of resurrecting a server after shutdown", async (method) => {
    fixture.holdMethod = method;
    const opening = acquire();
    const settled = Promise.allSettled([opening]);
    await vi.waitFor(() => expect(fixture.held).toHaveLength(1));
    try {
      await driver.shutdown!();
      expect(fixture.exitCode).toBe(0);
    } finally {
      fixture.holdMethod = undefined;
      fixture.respond(fixture.held[0].id!, { authMethods: [] });
      await settled;
      await driver.shutdown!();
    }
    expect((await settled)[0].status).toBe("rejected");
    expect(fixture.calls.filter((call) => call.method === "session/new")).toHaveLength(0);
    await expect(acquire("after-shutdown")).rejects.toThrow();
  });

  it("retains a failed bridge cleanup and retries it without reopening the runtime", async () => {
    await acquire();
    mocks.bridges[0].stop.mockRejectedValueOnce(new Error("bridge close failed"));
    await expect(driver.shutdown!()).rejects.toThrow("failed");
    await expect(acquire("retired")).rejects.toThrow();
    expect(mocks.bridges).toHaveLength(1);
    await driver.shutdown!();
    expect(mocks.bridges[0].stop).toHaveBeenCalledTimes(2);
    expect(fixture.exitCode).toBe(0);
  });

  it("does not execute a prepared session on a replacement ACP process", async () => {
    const old = await acquire("old");
    fixture.kill();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const replacement = new AcpFixture();
    mocks.spawn.mockImplementation(() => { queueMicrotask(() => replacement.emit("spawn")); return replacement; });
    await acquire("new");
    replacement.onPrompt = (message) => replacement.finish(message);
    const result = await driver.executePrompt(old.session, old.prompt, () => {}, new AbortController().signal);
    expect(result.status).toBe("failed");
    expect(replacement.calls.filter((call) => call.method === "session/prompt")).toHaveLength(0);
  });

  it("ignores retired process notifications when a replacement reuses the native session id", async () => {
    await acquire("old");
    const retired = fixture;
    retired.kill();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const replacement = new AcpFixture();
    mocks.spawn.mockImplementation(() => { queueMicrotask(() => replacement.emit("spawn")); return replacement; });
    const next = await acquire("next");
    replacement.onPrompt = (message) => {
      retired.text(next.sessionId!, "STALE");
      replacement.text(next.sessionId!, "current");
      replacement.finish(message);
    };
    const events: WorkRunEvent[] = [];
    await driver.executePrompt(next.session, next.prompt, (event) => { events.push(event); }, new AbortController().signal);
    expect(reports(events)).toEqual([expect.objectContaining({ content: "current" })]);
  });

  it("settles a canceled prompt even when Cursor never acknowledges cancellation", async () => {
    const acquired = await acquire();
    const controller = new AbortController();
    const turn = driver.executePrompt(acquired.session, acquired.prompt, () => {}, controller.signal);
    let outcome: unknown;
    void turn.then((value) => { outcome = value; });
    try {
      await vi.waitFor(() => expect(fixture.calls.some((call) => call.method === "session/prompt")).toBe(true));
      controller.abort();
      await vi.waitFor(() => expect(outcome).toMatchObject({ status: "canceled" }));
      expect(fixture.calls.filter((call) => call.method === "session/cancel")).toHaveLength(1);
    } finally {
      fixture.finish(fixture.calls.find((call) => call.method === "session/prompt")!);
      await turn;
    }
  });

  it("drops a captured MCP event callback after its prompt finishes", async () => {
    const acquired = await acquire();
    fixture.onPrompt = (message) => fixture.finish(message);
    const events: WorkRunEvent[] = [];
    await driver.executePrompt(acquired.session, acquired.prompt, (event) => { events.push(event); }, new AbortController().signal);
    const captured = mocks.bridges[0].setEventHandler.mock.calls.find(([handler]: [unknown]) => typeof handler === "function")[0];
    const count = events.length;
    await captured({ type: "artifact", kind: "report", content: "stale bridge output" });
    expect(events).toHaveLength(count);
  });

  it("retains the ACP child after the forced-kill deadline until its close event", async () => {
    await acquire();
    vi.useFakeTimers();
    const kill = vi.spyOn(fixture, "kill").mockImplementation(() => true);
    let closed = false;
    const closing = driver.shutdown!().then(() => { closed = true; });
    try {
      await vi.advanceTimersByTimeAsync(600);
      expect(kill).toHaveBeenCalled();
      expect(closed).toBe(false);
    } finally {
      fixture.exitCode = 0; fixture.emit("close", 0, null);
      await closing;
      vi.useRealTimers();
    }
  });

  it("joins a pending bridge start and releases its late resources without opening ACP", async () => {
    let release!: () => void;
    mocks.bridgeStart.mockReturnValueOnce(new Promise<void>((resolve) => { release = resolve; }));
    const opening = acquire();
    const rejected = expect(opening).rejects.toThrow("shut down");
    await vi.waitFor(() => expect(mocks.bridges[0]?.start).toHaveBeenCalledOnce());
    let done = false;
    const closing = driver.shutdown!().then(() => { done = true; });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(done).toBe(false);
    } finally { release(); await Promise.all([rejected, closing]); }
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.bridges[0].stop).toHaveBeenCalledOnce();
    expect(mocks.bridges[0].isRunning).toBe(false);
  });

  it("retains a prepared run across failed cleanup and never lets an old handle stop its replacement bridge", async () => {
    const first = await acquire();
    await expect(acquire()).rejects.toThrow("already owns");
    expect(mocks.bridges).toHaveLength(1);
    mocks.bridges[0].stop.mockRejectedValueOnce(new Error("retry bridge cleanup"));
    await expect(driver.cleanup!(first.session)).rejects.toThrow("retry bridge cleanup");
    await expect(acquire()).rejects.toThrow("already owns");
    await driver.cleanup!(first.session);
    await acquire();
    await driver.cleanup!(first.session);
    expect(mocks.bridges).toHaveLength(2);
    expect(mocks.bridges[0].stop).toHaveBeenCalledTimes(2);
    expect(mocks.bridges[1].stop).not.toHaveBeenCalled();
    expect(mocks.bridges[1].isRunning).toBe(true);
  });

  it("isolates repeated approval ids across process generations and discards answers after prompt retirement", async () => {
    const answers: Array<(value: unknown) => void> = [];
    mocks.approval.mockImplementation(() => new Promise((resolve) => { answers.push(resolve); }));
    const first = await acquire();
    const old = fixture;
    const firstTurn = driver.executePrompt(first.session, first.prompt, () => {}, new AbortController().signal);
    await vi.waitFor(() => expect(old.calls.some((call) => call.method === "session/prompt")).toBe(true));
    const permission = (sessionId: string) => ({ id: 77, method: "session/request_permission", params: {
      sessionId, toolCall: { kind: "execute", title: "Bash", rawInput: { command: "pwd" } }, options: [{ kind: "allow_once", optionId: "once" }],
    } });
    old.send(permission(first.sessionId!));
    await vi.waitFor(() => expect(mocks.approval).toHaveBeenCalledOnce());
    old.emit("error", new Error("crashed")); await firstTurn;
    const replacement = new AcpFixture();
    mocks.spawn.mockImplementation(() => { queueMicrotask(() => replacement.emit("spawn")); return replacement; });
    const next = await acquire();
    const turn = driver.executePrompt(next.session, next.prompt, () => {}, new AbortController().signal);
    try {
      await vi.waitFor(() => expect(replacement.calls.some((call) => call.method === "session/prompt")).toBe(true));
      replacement.send(permission(next.sessionId!));
      await vi.waitFor(() => expect(mocks.approval).toHaveBeenCalledTimes(2));
      expect(new Set(mocks.approval.mock.calls.map(([request]) => request.requestId)).size).toBe(2);
    } finally {
      replacement.finish(replacement.calls.find((call) => call.method === "session/prompt")!); await turn;
      for (const answer of answers) answer({ approved: true });
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(old.calls.filter((call) => call.id === 77 && !call.method)).toHaveLength(0);
    expect(replacement.calls.filter((call) => call.id === 77 && !call.method)).toHaveLength(0);
  });

  it("drains an admitted plan's complete pair before finishing the prompt", async () => {
    const acquired = await acquire();
    let release!: () => void;
    const persisted = new Promise<void>((resolve) => { release = resolve; });
    const events: WorkRunEvent[] = [];
    fixture.onPrompt = (message) => {
      fixture.send({ id: 77, method: "cursor/create_plan", params: { sessionId: acquired.sessionId, plan: "Plan content" } });
      fixture.finish(message);
    };
    let finished = false;
    const turn = driver.executePrompt(acquired.session, acquired.prompt, async (event) => {
      events.push(event);
      if (event.type === "tool_call" && event.toolName === "Plan" && event.metadata?.phase === "start") await persisted;
    }, new AbortController().signal).then((result) => { finished = true; return result; });
    try {
      await vi.waitFor(() => expect(events.some((event) => event.type === "tool_call")).toBe(true));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(finished).toBe(false);
    } finally { release(); await turn; }
    expect(events.filter((event) => event.type === "tool_call")).toMatchObject([
      { metadata: { phase: "start" } }, { metadata: { phase: "complete" } },
    ]);
  });

  it.each(["error", "undefined"])("fails on a rejected projection (%s) while still clearing live previews", async (kind) => {
    const acquired = await acquire();
    const error = kind === "error" ? new Error("projection failed") : undefined;
    fixture.onPrompt = (message) => { fixture.text(acquired.sessionId!, "partial"); fixture.finish(message); };
    const events: WorkRunEvent[] = [];
    const turn = driver.executePrompt(acquired.session, acquired.prompt, (event) => {
      events.push(event);
      if (events.length === 1) return Promise.reject(error);
      return undefined;
    }, new AbortController().signal);
    await expect(turn).rejects.toBe(error);
    expect(events.filter((event) => event.type === "artifact" && event.ephemeral && event.content === "")).toHaveLength(2);
    expect(mocks.bridges[0].setEventHandler).toHaveBeenLastCalledWith(null);
  });

  it.each(["stream", "final"])("joins %s output on shutdown and cannot publish a late successful outcome", async (kind) => {
    const acquired = await acquire();
    fixture.onPrompt = (message) => { fixture.text(acquired.sessionId!, "partial"); fixture.finish(message); };
    let release!: () => void;
    const writing = new Promise<void>((resolve) => { release = resolve; });
    let waiting = false;
    const turn = driver.executePrompt(acquired.session, acquired.prompt, async (event) => {
      if (!waiting && event.type === "artifact" && event.kind === "report" && (kind === "stream" ? event.ephemeral : !event.ephemeral)) {
        waiting = true; await writing;
      }
    }, new AbortController().signal);
    await vi.waitFor(() => expect(waiting).toBe(true));
    let closed = false;
    const closing = driver.shutdown!().then(() => { closed = true; });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false);
      expect(mocks.bridges[0].stop).not.toHaveBeenCalled();
    } finally { release(); await Promise.all([turn, closing]); }
    await expect(turn).resolves.toMatchObject({ status: "canceled" });
    expect(mocks.bridges[0].stop).toHaveBeenCalledOnce();
  });

  it("settles a command probe on shutdown without waiting for its discovery timer", async () => {
    vi.useFakeTimers();
    let done = false;
    const listing = driver.listCommands!(temporary).then((result) => { done = true; return result; });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(fixture.calls.some((call) => call.method === "session/new")).toBe(true);
      await driver.shutdown!();
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { await vi.advanceTimersByTimeAsync(6000); await listing; vi.useRealTimers(); }
  });

  it("keeps command discovery cached after its probe closes and retires that cache on shutdown", async () => {
    fixture.onRpc = (message) => {
      if (message.method !== "session/new") return false;
      fixture.respond(message.id!, { sessionId: "commands" });
      fixture.update("commands", { sessionUpdate: "available_commands_update", availableCommands: [{ name: "test", description: "Test command" }] });
      return true;
    };
    const first = await driver.listCommands!(temporary);
    expect(first).toMatchObject([{ name: "test" }]);
    await expect(driver.listCommands!(temporary)).resolves.toEqual(first);
    expect(mocks.spawn).toHaveBeenCalledOnce();
    await driver.shutdown!();
    await expect(driver.listCommands!(temporary)).resolves.toEqual([]);
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it("does not persist a capability probe's partial results after shutdown retires it", async () => {
    fixture.onRpc = (message) => {
      if (message.method !== "session/new") return false;
      fixture.respond(message.id!, { sessionId: "models", configOptions: [{ id: "model", category: "model", type: "select", options: [
        { value: "first", name: "First" }, { value: "second", name: "Second" },
      ] }] });
      return true;
    };
    const probe = new AcpFixture();
    probe.onRpc = (message) => {
      if (message.method !== "session/set_config_option") return false;
      if (message.params?.value === "first") probe.respond(message.id!, { configOptions: [] });
      else probe.held.push(message);
      return true;
    };
    let spawned = 0;
    mocks.spawn.mockImplementation(() => {
      const child = spawned++ === 0 ? fixture : probe;
      queueMicrotask(() => child.emit("spawn")); return child;
    });
    await driver.listModels!();
    await vi.waitFor(() => expect(probe.held).toHaveLength(1));
    await driver.shutdown!();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(fs.existsSync(path.join(temporary, "cursor-model-caps.json"))).toBe(false);
    expect(probe.exitCode).toBe(0);
  });

  it.each(["initialize", "authenticate"])("releases failed %s startup and retries on a fresh child", async (method) => {
    fixture.failMethod = method;
    await expect(acquire()).rejects.toThrow("Session creation failed");
    expect(fixture.exitCode).toBe(0);
    expect(mocks.bridges[0].stop).toHaveBeenCalledOnce();
    const replacement = new AcpFixture();
    mocks.spawn.mockImplementation(() => { queueMicrotask(() => replacement.emit("spawn")); return replacement; });
    await expect(acquire()).resolves.toMatchObject({ sessionId: "session-1" });
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    expect(mocks.bridges).toHaveLength(2);
  });

  it("exposes failed acquisition rollback for cleanup retry without losing its run claim", async () => {
    fixture.failMethod = "session/new";
    mocks.bridgeStart.mockImplementationOnce(async () => {
      mocks.bridges[0].stop.mockRejectedValueOnce(new Error("rollback failed"));
    });
    const failure: unknown = await acquire().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ResourceCleanupError);
    await expect(acquire()).rejects.toThrow("already owns");
    await (failure as ResourceCleanupError).close();
    fixture.failMethod = undefined;
    await expect(acquire()).resolves.toBeDefined();
    expect(mocks.bridges[0].stop).toHaveBeenCalledTimes(2);
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it("marks the terminal answer as final and the text before a tool as commentary", async () => {
    const acquired = await acquire();
    const events: WorkRunEvent[] = [];
    fixture.onPrompt = (message) => {
      fixture.text(acquired.sessionId!, "Working.");
      fixture.update(acquired.sessionId!, { sessionUpdate: "tool_call", toolCallId: "read-1", kind: "read", title: "Read", status: "pending", rawInput: {} });
      fixture.update(acquired.sessionId!, { sessionUpdate: "tool_call_update", toolCallId: "read-1", status: "completed" });
      fixture.text(acquired.sessionId!, "Done.");
      fixture.finish(message);
    };
    await driver.executePrompt(acquired.session, acquired.prompt, (event) => { events.push(event); }, new AbortController().signal);
    expect(reports(events)).toEqual([
      expect.objectContaining({ content: "Working.", metadata: expect.objectContaining({ messagePhase: "commentary" }) }),
      expect.objectContaining({ content: "Done.", metadata: expect.objectContaining({ messagePhase: "final_answer" }) }),
    ]);
  });

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

  it.each([
    { kind: "read", title: "Read File", rawInput: { path: "/fixture/hero.tsx" }, toolName: "Read", input: { file_path: "/fixture/hero.tsx" } },
    { kind: "search", title: "Grep", rawInput: { pattern: "activateTab", path: "/fixture/src" }, toolName: "Grep", input: { pattern: "activateTab", path: "/fixture/src" } },
    { kind: "execute", title: "Run Shell Command", rawInput: { command: "npm test" }, toolName: "Bash", input: { command: "npm test" } },
  ])("retains $kind arguments streamed in a status-less update before completion", async ({ kind, title, rawInput, toolName, input }) => {
    // Cursor's presenter opens the card before args are ready, then sends
    // refreshToolCall without a status. The final result omits args again.
    const { calls } = await replayUpdates([
      { sessionUpdate: "tool_call", toolCallId: "streamed-1", kind, title, status: "pending", rawInput: {} },
      { sessionUpdate: "tool_call_update", toolCallId: "streamed-1", title, rawInput },
      { sessionUpdate: "tool_call_update", toolCallId: "streamed-1", status: "in_progress" },
      { sessionUpdate: "tool_call_update", toolCallId: "streamed-1", status: "completed", rawOutput: "ok" },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ toolName, input, output: "ok", metadata: { phase: "complete", title, kind } });
  });

  it("keeps intermediate content and locations when a terminal update only changes status", async () => {
    const { calls } = await replayUpdates([
      { sessionUpdate: "tool_call", toolCallId: "read-1", kind: "read", title: "Read File", status: "pending" },
      { sessionUpdate: "tool_call_update", toolCallId: "read-1", locations: [{ path: "/fixture/hero.tsx" }], content: [{ type: "content", content: { type: "text", text: "File contents" } }] },
      { sessionUpdate: "tool_call_update", toolCallId: "read-1", status: "completed", title: "Read hero.tsx" },
    ]);
    expect(calls[1]).toMatchObject({ toolName: "Read", input: { file_path: "/fixture/hero.tsx" }, output: "File contents", metadata: { title: "Read hero.tsx", kind: "read" } });
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

  it("keeps a completed reply successful when Cursor appends its closed-iterable diagnostic", async () => {
    const { outcome, events } = await replay(["Hello — glad you’re here.", "\n\n" + diagnostic]);
    expect(outcome).toEqual({ status: "succeeded", stopReason: "end_turn" });
    expect(reports(events)).toEqual([expect.objectContaining({ content: "Hello — glad you’re here." })]);
  });

  it("ends the shared run successfully without an error notification after a completed reply", async () => {
    const events: WorkRunEvent[] = [];
    fixture.onPrompt = (message) => {
      const sessionId = message.params!.sessionId as string;
      fixture.text(sessionId, "---\ntitle: Say hello\n---\n\nHello.");
      fixture.text(sessionId, "\n\n" + diagnostic);
      fixture.finish(message);
    };
    const result = await createWorkRunAdapter(driver).startRun({ runId: "run-1", accountId: "account-1", execution: { cwd: "/fixture", workspaceId: null }, goal: "hi" }, (event) => { events.push(event); });
    expect(result).toMatchObject({ status: "succeeded", stopReason: "end_turn" });
    expect(events.filter((event) => event.type === "status")).toEqual([
      expect.objectContaining({ status: "running" }), expect.objectContaining({ status: "succeeded" }),
    ]);
    expect(events.some((event) => event.type === "status" && event.error)).toBe(false);
    expect(reports(events)).toEqual([expect.objectContaining({ content: "Hello." })]);
    expect(mocks.bridges[0].isRunning).toBe(false);
  });

  it.each(["", " \n", "---\ntitle: Hello\n---\n\n"])("still fails when the closed-iterable diagnostic arrives without a reply (%j)", async (prefix) => {
    const { outcome, events } = await replay([prefix, "\n\n" + diagnostic]);
    expect(outcome).toMatchObject({ status: "failed", summary: diagnostic });
    expect(reports(events)).toEqual([]);
  });

  it.each([
    "Error: ConnectError: [unavailable] transport closed",
    "Error: ConnectError: [aborted] transport aborted",
    "Error: ConnectError: [deadline_exceeded] timed out",
    "Something went wrong communicating with the server. Please try again.",
  ])("still fails a partial reply ending in a different transport diagnostic: %s", async (failure) => {
    const { outcome, events } = await replay(["Partial reply.", "\n\n" + failure]);
    expect(outcome).toMatchObject({ status: "failed", summary: failure });
    expect(reports(events)).toEqual([expect.objectContaining({ content: "Partial reply." })]);
  });

  it.each([undefined, "refusal", "max_tokens"])("does not suppress a closed-iterable diagnostic without a normal end_turn (%s)", async (stopReason) => {
    const acquired = await acquire();
    fixture.onPrompt = (message) => {
      fixture.text(acquired.sessionId!, "Partial reply.");
      fixture.text(acquired.sessionId!, "\n\n" + diagnostic);
      fixture.respond(message.id!, { stopReason });
    };
    const outcome = await driver.executePrompt(acquired.session, acquired.prompt, () => {}, new AbortController().signal);
    expect(outcome.status).toBe("failed");
  });

  it("keeps a real RPC failure failed even when a reply preceded the diagnostic", async () => {
    const acquired = await acquire();
    fixture.onPrompt = (message) => {
      fixture.text(acquired.sessionId!, "Partial reply.");
      fixture.text(acquired.sessionId!, "\n\n" + diagnostic);
      fixture.send({ id: message.id, error: { code: -32000, message: "Prompt failed" } });
    };
    const outcome = await driver.executePrompt(acquired.session, acquired.prompt, () => {}, new AbortController().signal);
    expect(outcome.status).toBe("failed");
  });

  it("does not mistake commentary before a tool for a completed final reply", async () => {
    const acquired = await acquire();
    const events: WorkRunEvent[] = [];
    fixture.onPrompt = (message) => {
      fixture.text(acquired.sessionId!, "Checking the file.");
      fixture.update(acquired.sessionId!, { sessionUpdate: "tool_call", toolCallId: "read-1", kind: "read", title: "Read File", status: "pending" });
      fixture.text(acquired.sessionId!, "\n\n" + diagnostic);
      fixture.finish(message);
    };
    const outcome = await driver.executePrompt(acquired.session, acquired.prompt, (event) => { events.push(event); }, new AbortController().signal);
    expect(outcome).toMatchObject({ status: "failed", summary: diagnostic });
    expect(reports(events)).toEqual([expect.objectContaining({ content: "Checking the file." })]);
  });

  it.each([false, true])("only tolerates closure after a final reply when the preceding tool finished (%s)", async (toolCompleted) => {
    const acquired = await acquire();
    fixture.onPrompt = (message) => {
      fixture.update(acquired.sessionId!, { sessionUpdate: "tool_call", toolCallId: "read-1", kind: "read", title: "Read File", status: "pending" });
      if (toolCompleted) fixture.update(acquired.sessionId!, { sessionUpdate: "tool_call_update", toolCallId: "read-1", status: "completed", rawOutput: "contents" });
      fixture.text(acquired.sessionId!, "The file is ready.");
      fixture.text(acquired.sessionId!, "\n\n" + diagnostic);
      fixture.finish(message);
    };
    const outcome = await driver.executePrompt(acquired.session, acquired.prompt, () => {}, new AbortController().signal);
    expect(outcome.status).toBe(toolCompleted ? "succeeded" : "failed");
  });

  it("handles the closure diagnostic across consecutive turns and split deltas", async () => {
    const acquired = await acquire();
    for (const reply of ["Hello.", "Doing well."]) {
      const events: WorkRunEvent[] = [];
      fixture.onPrompt = (message) => {
        fixture.text(acquired.sessionId!, reply);
        for (const chunk of "\n\n" + diagnostic) fixture.text(acquired.sessionId!, chunk);
        fixture.finish(message);
      };
      const outcome = await driver.executePrompt(acquired.session, acquired.prompt, (event) => { events.push(event); }, new AbortController().signal);
      expect(outcome).toEqual({ status: "succeeded", stopReason: "end_turn" });
      expect(reports(events)).toEqual([expect.objectContaining({ content: reply })]);
      expect(events.every((event) => event.type !== "artifact" || !event.content?.includes("RetriableError"))).toBe(true);
    }
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
    expect(reports(events).every((event) => event.type === "artifact" && event.metadata?.messagePhase !== "final_answer")).toBe(true);
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
