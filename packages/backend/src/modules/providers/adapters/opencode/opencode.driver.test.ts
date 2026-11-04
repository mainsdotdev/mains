import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcquiredSession, WorkRunEvent, WorkRunRequest } from "../../../../../shared/adapter.types";
import type { ToolApprovalRequest, ToolApprovalResponse } from "../../../runs/runs.dto";
import type { MainsMcpStdioServer } from "../mains-mcp-server";
import { createWorkRunAdapter } from "../work-run-core";
import { createOpenCodeDriver } from "./opencode.driver";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  dispatch: vi.fn(),
  approval: vi.fn(),
  updateRun: vi.fn(),
}));
vi.mock("../provider-process", async (original) => ({
  ...await original<typeof import("../provider-process")>(), spawnProvider: mocks.spawn,
}));
vi.mock("../../../../ipc-kit", () => ({ emit: vi.fn() }));
vi.mock("../../../runs/runs.repo", () => ({ runsRepo: { findRunById: vi.fn().mockResolvedValue(null), updateRun: mocks.updateRun } }));
vi.mock("../../../runs/user-input-broker", () => ({ requestToolApproval: mocks.approval, cancelPendingRequests: vi.fn() }));
vi.mock("../mains-tools.registry", () => ({
  dispatchMainsTool: mocks.dispatch,
  toMcpToolDefs: () => [{ name: "SaveReview", description: "Save a review", inputSchema: { type: "object" } }],
}));

type McpConfig = MainsMcpStdioServer["mcpConfig"];
type RpcMessage = { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown };

/** OpenCode registers MCP servers by directory and name for the whole process. */
class AcpFixture extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  calls: RpcMessage[] = [];
  sessions = new Map<string, string>();
  serversByCwd = new Map<string, Map<string, McpConfig>>();
  prompts = new Map<string, number | string>();
  onPrompt?: (message: RpcMessage) => void;
  failMethod?: string;
  failureMessage?: string;
  stdin = new Writable({ write: (chunk, _encoding, done) => {
    const message = JSON.parse(chunk.toString()) as RpcMessage;
    this.calls.push(message);
    queueMicrotask(() => this.handle(message));
    done();
  } });

  constructor(private nativeSessions: Map<string, string>) { super(); }

  private handle(message: RpcMessage) {
    if (message.id === undefined || !message.method) return;
    const params = message.params ?? {};
    if (message.method === this.failMethod) {
      this.stdout.write(JSON.stringify({ id: message.id, error: { code: -32000, message: this.failureMessage ?? "Acquisition failed" } }) + "\n");
      return;
    }
    if (message.method === "initialize") this.respond(message.id, { authMethods: [] });
    else if (["session/new", "session/resume", "session/fork"].includes(message.method!)) {
      const cwd = params.cwd as string;
      const sessionId = message.method === "session/resume"
        ? params.sessionId as string
        : `session-${this.nativeSessions.size + 1}`;
      this.nativeSessions.set(sessionId, cwd);
      this.sessions.set(sessionId, cwd);
      const servers = this.serversByCwd.get(cwd) ?? new Map<string, McpConfig>();
      for (const config of params.mcpServers as McpConfig[]) servers.set(config.name, config);
      this.serversByCwd.set(cwd, servers);
      this.stdout.write(JSON.stringify({
        method: "session/update", params: { sessionId, update: {
          sessionUpdate: "available_commands_update", availableCommands: [{ name: "compact" }],
        } },
      }) + "\n");
      this.respond(message.id, { sessionId });
    } else if (message.method === "session/prompt") {
      this.prompts.set(params.sessionId as string, message.id);
      this.onPrompt?.(message);
    }
    else if (message.method === "session/list") this.respond(message.id, { sessions: [] });
    else if (message.method === "session/delete") {
      this.nativeSessions.delete(params.sessionId as string);
      this.respond(message.id, {});
    }
    else this.respond(message.id, {});
  }

  bridge(sessionId: string): McpConfig {
    return this.serversByCwd.get(this.sessions.get(sessionId)!)!.get("mains")!;
  }
  finish(sessionId: string) { this.respond(this.prompts.get(sessionId)!, { stopReason: "end_turn" }); }
  respond(id: number | string, result: unknown) { this.stdout.write(JSON.stringify({ id, result }) + "\n"); }
  update(sessionId: string, update: object) {
    this.stdout.write(JSON.stringify({ method: "session/update", params: { sessionId, update } }) + "\n");
  }
  ask(sessionId: string, method: string, id = "approval-1", toolCall: Record<string, unknown> = { title: "bash", rawInput: { command: "pwd" } }) {
    this.stdout.write(JSON.stringify({
      id, method, params: { sessionId,
        ...(method === "elicitation/create" ? {
          mode: "form", message: "Choose", requestedSchema: { type: "object", properties: { choice: { type: "string" } } },
        } : {
          toolCall,
          options: [{ kind: "allow_once", optionId: "once" }, { kind: "allow_always", optionId: "always" }, { kind: "reject_once", optionId: "reject" }],
        }),
      },
    }) + "\n");
  }
  kill() {
    this.exitCode = 0;
    queueMicrotask(() => this.emit("close", 0, null));
    return true;
  }
}

/** Exercise the real authenticated run bridge, stopping before domain writes. */
async function callReview(config: McpConfig): Promise<unknown> {
  const env = Object.fromEntries(config.env.map(({ name, value }) => [name, value]));
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(env.MAINS_IPC_SOCKET);
    let buffer = "";
    socket.setTimeout(2000, () => socket.destroy(new Error("Review bridge timed out")));
    socket.on("error", reject);
    socket.on("connect", () => socket.write(JSON.stringify({
      id: "review", token: env.MAINS_IPC_TOKEN, tool: "SaveReview", args: { title: "Review" },
    }) + "\n"));
    socket.on("data", (chunk) => { buffer += chunk.toString(); });
    socket.on("end", () => resolve(JSON.parse(buffer)));
  });
}

describe("OpenCode driver", () => {
  let directory: string;
  let driver: ReturnType<typeof createOpenCodeDriver>;
  let nativeSessions: Map<string, string>;
  let failMethod: string | undefined;
  let failureMessage: string | undefined;
  let onPrompt: ((process: AcpFixture, message: RpcMessage) => void) | undefined;
  const processes: AcpFixture[] = [];
  const bridgeScripts = new Set<string>();

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "mains-opencode-isolation-"));
    nativeSessions = new Map();
    processes.length = 0;
    failMethod = undefined;
    failureMessage = undefined;
    onPrompt = undefined;
    mocks.spawn.mockImplementation((_binary, args: string[]) => {
      const child = new AcpFixture(nativeSessions);
      child.failMethod = failMethod;
      child.failureMessage = failureMessage;
      child.onPrompt = (message) => onPrompt?.(child, message);
      if (args[0] === "--version") queueMicrotask(() => {
        child.stdout.write("opencode v2.2.5\n"); child.emit("close", 0);
      });
      else processes.push(child);
      return child;
    });
    mocks.dispatch.mockImplementation(async (_tool, _args, ctx) => ({ content: [{ type: "text", text: ctx.runId }] }));
    mocks.approval.mockResolvedValue({ approved: false });
    mocks.updateRun.mockResolvedValue(undefined);
    driver = createOpenCodeDriver({ binary: "/fixture/opencode" });
  });

  afterEach(async () => {
    await driver.shutdown?.();
    for (const process of processes) {
      for (const call of process.calls) {
        for (const config of (call.params?.mcpServers ?? []) as McpConfig[]) bridgeScripts.add(config.args[0]);
      }
    }
    for (const script of bridgeScripts) expect(fs.existsSync(script)).toBe(false);
    bridgeScripts.clear();
    fs.rmSync(directory, { recursive: true, force: true });
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  function request(runId: string): WorkRunRequest {
    return { runId, accountId: "account", execution: { cwd: directory, workspaceId: "workspace" }, goal: "Review the code" };
  }
  function owner(acquired: AcquiredSession): AcpFixture {
    return processes.filter((process) => process.exitCode === null && process.sessions.has(acquired.sessionId!)).at(-1)!;
  }
  function execute(acquired: AcquiredSession, events: WorkRunEvent[]) {
    return driver.executePrompt(acquired.session, acquired.prompt, (event) => { events.push(event); }, new AbortController().signal);
  }

  it.each(["create", "resume", "fork"] as const)("isolates %s from another active run in the same directory", async (method) => {
    let first = await driver.createSession(request("run-a"));
    if (method !== "create") {
      await driver.cleanup?.(first.session);
      first = method === "resume"
        ? await driver.resumeSession!({ ...request("run-a"), message: "Continue" })
        : await driver.forkSession!({ ...request("fork-a"), sourceRunId: "run-a", message: "Fork" });
    }
    const second = await driver.createSession(request("run-b"));
    const firstOwner = owner(first);
    const secondOwner = owner(second);
    const firstEvents: WorkRunEvent[] = [];
    const secondEvents: WorkRunEvent[] = [];
    const firstTurn = execute(first, firstEvents);
    const secondTurn = execute(second, secondEvents);
    await vi.waitFor(() => {
      expect(firstOwner.prompts.has(first.sessionId!)).toBe(true);
      expect(secondOwner.prompts.has(second.sessionId!)).toBe(true);
    });

    const firstRunId = method === "fork" ? "fork-a" : "run-a";
    expect(await callReview(firstOwner.bridge(first.sessionId!))).toMatchObject({ content: [{ text: firstRunId }] });
    expect(await callReview(secondOwner.bridge(second.sessionId!))).toMatchObject({ content: [{ text: "run-b" }] });
    expect(firstEvents.filter((event) => event.type === "tool_call")).toHaveLength(2);
    expect(secondEvents.filter((event) => event.type === "tool_call")).toHaveLength(2);

    secondOwner.finish(second.sessionId!);
    await expect(secondTurn).resolves.toMatchObject({ status: "succeeded" });
    await driver.cleanup?.(second.session);
    expect(secondOwner.exitCode).toBe(0);
    expect(firstOwner.exitCode).toBeNull();
    expect(await callReview(firstOwner.bridge(first.sessionId!))).toMatchObject({ content: [{ text: firstRunId }] });
    firstOwner.finish(first.sessionId!);
    await expect(firstTurn).resolves.toMatchObject({ status: "succeeded" });
    await driver.cleanup?.(first.session);
    expect(firstOwner.exitCode).toBe(0);
    expect(mocks.dispatch.mock.calls.map(([, , ctx]) => ctx.runId)).toEqual([firstRunId, "run-b", firstRunId]);
  });

  it("keeps catalog discovery separate from run MCP registrations", async () => {
    const run = await driver.createSession(request("run-a"));
    const runOwner = owner(run);
    driver.invalidateCatalogs?.();
    await driver.listCommands?.(directory);
    const discovery = processes.at(-1)!;
    expect(discovery).not.toBe(runOwner);
    expect(discovery.serversByCwd.get(directory)?.size).toBe(0);
    await driver.cleanup?.(run.session);
    expect(runOwner.exitCode).toBe(0);
    expect(discovery.exitCode).toBeNull();
  });

  it.each(["session/request_permission", "elicitation/create"])("scopes concurrent %s requests to their own run", async (method) => {
    const pending = new Map<string, (response: ToolApprovalResponse) => void>();
    mocks.approval.mockImplementation((request: ToolApprovalRequest) => new Promise((resolve) => { pending.set(request.runId, resolve); }));
    const first = await driver.createSession(request("run-a"));
    const second = await driver.createSession(request("run-b"));
    const firstOwner = owner(first);
    const secondOwner = owner(second);
    const firstTurn = execute(first, []);
    const secondTurn = execute(second, []);
    firstOwner.ask(first.sessionId!, method);
    secondOwner.ask(second.sessionId!, method);
    await vi.waitFor(() => expect(pending.size).toBe(2));
    const ids = mocks.approval.mock.calls.map(([request]) => request.requestId);
    expect(new Set(ids).size).toBe(2);
    pending.get("run-a")!({ requestId: ids[0], approved: true, answer: '{"choice":"yes"}' });
    pending.get("run-b")!({ requestId: ids[1], approved: false });
    await vi.waitFor(() => {
      expect(firstOwner.calls.find((call) => call.id === "approval-1")?.result).toEqual(method === "elicitation/create"
        ? { action: "accept", content: { choice: "yes" } }
        : { outcome: { outcome: "selected", optionId: "once" } });
      expect(secondOwner.calls.find((call) => call.id === "approval-1")?.result).toEqual(method === "elicitation/create"
        ? { action: "decline" }
        : { outcome: { outcome: "selected", optionId: "reject" } });
    });
    firstOwner.finish(first.sessionId!);
    secondOwner.finish(second.sessionId!);
    await Promise.all([firstTurn, secondTurn]);
  });

  describe("explicit permission requests", () => {
    it.each([
      { title: "thirdparty_SaveReview", name: "thirdparty_SaveReview" },
      { title: "cat SaveReview.md", name: "shell", kind: "execute", rawInput: { command: "cat SaveReview.md" } },
      { title: "mains_SaveFinding", name: "external_SaveFinding" },
      { title: "SaveReview" },
      { title: "CheckPackage" },
      { title: "mains_CheckPackage", name: "mains_CheckPackage" },
      { title: "mains_SaveReview", name: "mains_SaveReview" },
      { name: "external_tool", rawInput: { file: "SaveFindings.md" } },
    ])("waits for the user's decision for $title", async (toolCall) => {
      let decide!: (response: ToolApprovalResponse) => void;
      mocks.approval.mockImplementation(() => new Promise((resolve) => { decide = resolve; }));
      const run = await driver.createSession(request("run-a"));
      const process = owner(run);
      const turn = execute(run, []);
      process.ask(run.sessionId!, "session/request_permission", "approval-1", toolCall);
      await new Promise((resolve) => setImmediate(resolve));

      expect(mocks.approval).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        requestId: "opencode-run-a-approval-1", runId: "run-a", kind: "tool_approval",
        toolName: toolCall.title ?? "OpenCode", toolInput: toolCall.rawInput,
      }));
      expect(process.calls.some((call) => call.id === "approval-1")).toBe(false);
      decide({ requestId: "opencode-run-a-approval-1", approved: false });
      await vi.waitFor(() => expect(process.calls.find((call) => call.id === "approval-1")?.result).toEqual({
        outcome: { outcome: "selected", optionId: "reject" },
      }));
      process.finish(run.sessionId!);
      await expect(turn).resolves.toMatchObject({ status: "succeeded" });
    });

    it.each([
      { answer: undefined, expected: "once" },
      { answer: "acceptForSession", expected: "always" },
    ])("forwards $expected only after the user explicitly approves", async ({ answer, expected }) => {
      let decide!: (response: ToolApprovalResponse) => void;
      mocks.approval.mockImplementation(() => new Promise((resolve) => { decide = resolve; }));
      const run = await driver.createSession(request("run-a"));
      const process = owner(run);
      const turn = execute(run, []);
      process.ask(run.sessionId!, "session/request_permission", "approval-1", { title: "external_CheckPackage", name: "external_CheckPackage" });
      await new Promise((resolve) => setImmediate(resolve));
      expect(mocks.approval).toHaveBeenCalledOnce();
      expect(process.calls.some((call) => call.id === "approval-1")).toBe(false);
      decide({ requestId: "opencode-run-a-approval-1", approved: true, answer });
      await vi.waitFor(() => expect(process.calls.find((call) => call.id === "approval-1")?.result).toEqual({
        outcome: { outcome: "selected", optionId: expected },
      }));
      process.finish(run.sessionId!);
      await expect(turn).resolves.toMatchObject({ status: "succeeded" });
    });

    it("cancels the native request if the approval broker fails", async () => {
      mocks.approval.mockRejectedValue(new Error("Approval unavailable"));
      const run = await driver.createSession(request("run-a"));
      const process = owner(run);
      const turn = execute(run, []);
      process.ask(run.sessionId!, "session/request_permission", "approval-1", { title: "external_SaveReview" });
      await vi.waitFor(() => expect(process.calls.find((call) => call.id === "approval-1")?.result).toEqual({ outcome: { outcome: "cancelled" } }));
      process.finish(run.sessionId!);
      await expect(turn).resolves.toMatchObject({ status: "succeeded" });
    });
  });

  it.each(["initialize", "session/new"])("releases the private process when %s fails", async (method) => {
    failMethod = method;
    await expect(driver.createSession(request("run-a"))).rejects.toThrow("Acquisition failed");
    expect(processes).toHaveLength(1);
    expect(processes[0].exitCode).toBe(0);
  });

  it("deletes a saved session after its private process has been released", async () => {
    const run = await driver.createSession(request("run-a"));
    await driver.cleanup?.(run.session);
    await driver.deleteSession?.("run-a");
    expect(nativeSessions.has(run.sessionId!)).toBe(false);
  });

  it.each(["session/request_permission", "elicitation/create"])("ignores a late %s answer after shutdown", async (method) => {
    let respond!: (response: ToolApprovalResponse) => void;
    mocks.approval.mockImplementation(() => new Promise((resolve) => { respond = resolve; }));
    const run = await driver.createSession(request("run-a"));
    const process = owner(run);
    const turn = execute(run, []);
    process.ask(run.sessionId!, method);
    await vi.waitFor(() => expect(mocks.approval).toHaveBeenCalledOnce());
    await driver.shutdown?.();
    await expect(turn).resolves.toMatchObject({ status: "failed" });
    respond({ requestId: "ignored", approved: true, answer: '{"choice":"yes"}' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(process.calls.some((call) => call.id === "approval-1")).toBe(false);
    expect(processes.every((process) => process.exitCode === 0)).toBe(true);
  });

  describe("continuation context", () => {
    it.each(["Use the selected context to fix this", "/compact"])("delivers selected context and instructions without changing the user message: %s", async (message) => {
      const first = await driver.createSession(request("run-a"));
      await driver.cleanup?.(first.session);
      const attachedPath = path.join(directory, "notes.txt");
      fs.writeFileSync(attachedPath, "ATTACHED_NOTES");
      const resumed = await driver.resumeSession!({
        ...request("run-a"), message,
        extraInstructions: "CURRENT_PROJECT_INSTRUCTIONS",
        context: [
          { kind: "selection", ref: "src/app.ts:12", content: "SELECTED_CODE" },
          { kind: "note", ref: "browser", content: "SELECTED_BROWSER_CONTEXT" },
          { kind: "diff", content: "SELECTED_REVIEW_DIFF" },
        ],
        contextIssues: [{ provider: "github", number: 42, title: "ISSUE_TITLE", body: "ISSUE_BODY" }],
        contextSignals: [{ source: "sentry", level: "error", category: "runtime", title: "SIGNAL_TITLE", body: "SIGNAL_BODY" }],
        attachments: [{ attachmentId: "notes", name: "notes.txt", type: "document", mimeType: "text/plain", byteSize: 14, sourcePath: attachedPath }],
      });
      const process = owner(resumed);
      process.onPrompt = () => process.finish(resumed.sessionId!);
      await expect(execute(resumed, [])).resolves.toMatchObject({ status: "succeeded" });
      const blocks = process.calls.find((call) => call.method === "session/prompt")!.params!.prompt as Array<{
        type: string; text: string; annotations?: { audience?: string[] };
      }>;
      const context = blocks.find((block) => block.annotations?.audience?.includes("assistant") && !block.annotations.audience.includes("user"))?.text;
      for (const text of ["CURRENT_PROJECT_INSTRUCTIONS", directory, "src/app.ts:12", "SELECTED_CODE", "SELECTED_BROWSER_CONTEXT", "SELECTED_REVIEW_DIFF", "ISSUE_TITLE", "ISSUE_BODY", "SIGNAL_TITLE", "SIGNAL_BODY", "ATTACHED_NOTES"]) {
        expect(context).toContain(text);
      }
      expect(blocks.filter((block) => !block.annotations?.audience || block.annotations.audience.includes("user"))).toEqual([{ type: "text", text: message }]);
      expect(resumed.sessionId).toBe(first.sessionId);
      expect(process.calls.some((call) => call.method === "session/new")).toBe(false);
    });

    it("uses the latest selected context on each continuation", async () => {
      const first = await driver.createSession(request("run-a"));
      await driver.cleanup?.(first.session);
      for (const selected of ["FIRST_SELECTION", "SECOND_SELECTION"]) {
        const resumed = await driver.resumeSession!({
          ...request("run-a"), message: "Continue", context: [{ kind: "selection", content: selected }],
        });
        const process = owner(resumed);
        process.onPrompt = () => process.finish(resumed.sessionId!);
        await execute(resumed, []);
        const payload = JSON.stringify(process.calls.find((call) => call.method === "session/prompt")!.params);
        expect(payload).toContain(selected);
        expect(payload).not.toContain(selected === "FIRST_SELECTION" ? "SECOND_SELECTION" : "FIRST_SELECTION");
        await driver.cleanup?.(resumed.session);
      }
    });

    it.each(["Session ses_old not found", "Unknown session: ses_old", "Session ses_old does not exist"])("preserves the chat when resume fails: %s", async (error) => {
      const first = await driver.createSession(request("run-a"));
      await driver.cleanup?.(first.session);
      failMethod = "session/resume";
      failureMessage = error;
      onPrompt = (process, message) => process.finish(message.params!.sessionId as string);
      const events: WorkRunEvent[] = [];
      const adapter = createWorkRunAdapter(driver);
      await expect(adapter.continueRun!({ ...request("run-a"), message: "Continue" }, (event) => { events.push(event); })).resolves.toMatchObject({
        status: "failed", summary: expect.stringMatching(/history.*Mains/),
      });
      const failed = processes.at(-1)!;
      expect(failed.calls.some((call) => call.method === "session/new" || call.method === "session/prompt")).toBe(false);
      expect(failed.exitCode).toBe(0);
      expect(mocks.updateRun).not.toHaveBeenCalled();
      expect(events.some((event) => event.type === "artifact" && event.kind === "user-prompt")).toBe(false);
      expect(nativeSessions.has(first.sessionId!)).toBe(true);
      failMethod = undefined;
      const retried = await driver.resumeSession!({ ...request("run-a"), message: "Retry" });
      expect(retried.sessionId).toBe(first.sessionId);
    });

    it("preserves other resume errors without replacing the session", async () => {
      const first = await driver.createSession(request("run-a"));
      await driver.cleanup?.(first.session);
      failMethod = "session/resume";
      failureMessage = "Permission denied";
      await expect(driver.resumeSession!({ ...request("run-a"), message: "Continue" })).rejects.toThrow("Permission denied");
      expect(processes.at(-1)!.calls.some((call) => call.method === "session/new")).toBe(false);
    });
  });

  describe("generateText", () => {
    function reply(text: string, stopReason = "end_turn") {
      onPrompt = (process, message) => {
        const sessionId = message.params!.sessionId as string;
        process.update("another-session", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Unrelated" } });
        process.update(sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Thinking" } });
        process.update(sessionId, {
          sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Child output" },
          _meta: { "opencode/child-session": { id: "child" } },
        });
        const middle = Math.floor(text.length / 2);
        for (const chunk of [text.slice(0, middle), text.slice(middle)]) {
          process.update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: chunk } });
        }
        process.respond(message.id!, { stopReason });
      };
    }

    function expectReleased(process: AcpFixture) {
      const opened = process.calls.find((call) => call.method === "session/new")!;
      expect(opened.params?.mcpServers).toEqual([]);
      expect(fs.existsSync(opened.params!.cwd as string)).toBe(false);
      expect(process.calls.some((call) => call.method === "session/delete")).toBe(true);
      expect(nativeSessions.size).toBe(0);
      expect(process.exitCode).toBe(0);
    }

    it.each(["fix: preserve MCP ownership", "Preserve MCP ownership\n\nKeeps concurrent chats independent.\n\n- Test create/resume/fork."])("returns the generated commit/PR text through the public adapter", async (text) => {
      reply(`  ${text}\n`);
      const adapter = createWorkRunAdapter(driver);
      expect(await adapter.generateText!("Summarize this diff", { system: "Follow the project commit and PR conventions.", model: "openai/test-model" })).toBe(text);
      const process = processes[0];
      const prompt = process.calls.find((call) => call.method === "session/prompt")!.params;
      expect(JSON.stringify(prompt)).toContain("Follow the project commit and PR conventions.");
      expect(JSON.stringify(prompt)).toContain("Summarize this diff");
      expect(process.calls).toContainEqual(expect.objectContaining({ method: "session/set_config_option", params: expect.objectContaining({ configId: "model", value: "openai/test-model" }) }));
      expect(process.calls).toContainEqual(expect.objectContaining({ method: "session/set_config_option", params: expect.objectContaining({ configId: "mode", value: "plan" }) }));
      expect(mocks.dispatch).not.toHaveBeenCalled();
      expectReleased(process);
    });

    it.each([
      { configured: "opencode/configured", requested: undefined, selected: "opencode/configured" },
      { configured: "opencode/configured", requested: "openai/override", selected: "openai/override" },
      { configured: undefined, requested: undefined, selected: undefined },
    ])("selects $selected without hardcoding a provider model", async ({ configured, requested, selected }) => {
      driver.updateConfig?.({ binary: "/fixture/opencode", defaultModel: configured });
      reply("fix: generated");
      await driver.generateText!("Write a commit", { model: requested });
      const selection = processes[0].calls.find((call) => call.method === "session/set_config_option" && call.params?.configId === "model");
      expect(selection?.params?.value).toBe(selected);
    });

    it.each(["refusal", "cancelled", "max_tokens", "max_turn_requests"])("rejects partial text after %s and deletes the temporary session", async (stopReason) => {
      reply("Partial reply", stopReason);
      await expect(driver.generateText!("Write a PR")).rejects.toThrow(/OpenCode/);
      expectReleased(processes[0]);
    });

    it("rejects an empty reply", async () => {
      reply(" \n ");
      await expect(driver.generateText!("Write a commit")).rejects.toThrow(/empty/i);
      expectReleased(processes[0]);
    });

    it("declines permission requests and cancels forms without waiting for a user", async () => {
      onPrompt = (process, message) => {
        const sessionId = message.params!.sessionId as string;
        process.ask(sessionId, "session/request_permission");
        process.ask(sessionId, "elicitation/create", "form-1");
        process.update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "fix: generated" } });
        process.finish(sessionId);
      };
      expect(await driver.generateText!("Write a commit")).toBe("fix: generated");
      expect(processes[0].calls.find((call) => call.id === "approval-1")?.result).toEqual({ outcome: { outcome: "cancelled" } });
      expect(processes[0].calls.find((call) => call.id === "form-1")?.result).toEqual({ action: "cancel" });
      expect(mocks.approval).not.toHaveBeenCalled();
    });

    it.each(["session/new", "session/set_config_option", "session/prompt"])("releases resources after %s fails", async (method) => {
      failMethod = method;
      await expect(driver.generateText!("Write a commit")).rejects.toThrow("Acquisition failed");
      expect(processes[0].exitCode).toBe(0);
      const opened = processes[0].calls.find((call) => call.method === "session/new")!;
      expect(fs.existsSync(opened.params!.cwd as string)).toBe(false);
      expect(nativeSessions.size).toBe(0);
    });

    it("bounds a stalled generation and releases its session", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const result = driver.generateText!("Write a commit");
      const rejected = expect(result).rejects.toThrow(/timed out/);
      await vi.waitFor(() => expect(processes[0]?.prompts.size).toBe(1));
      await vi.advanceTimersByTimeAsync(30_000);
      await rejected;
      expectReleased(processes[0]);
    });

    it("generates concurrently without disrupting an active chat", async () => {
      const run = await driver.createSession(request("live-chat"));
      const process = owner(run);
      const events: WorkRunEvent[] = [];
      const turn = execute(run, events);
      await vi.waitFor(() => expect(process.prompts.size).toBe(1));
      reply("fix: generated");
      expect(await Promise.all([driver.generateText!("Write a commit"), driver.generateText!("Write a PR")])).toEqual(["fix: generated", "fix: generated"]);
      expect(process.exitCode).toBeNull();
      expect(events).toEqual([]);
      process.finish(run.sessionId!);
      await expect(turn).resolves.toMatchObject({ status: "succeeded" });
    });

    it("cleans up an in-flight generation when the driver shuts down", async () => {
      const result = driver.generateText!("Write a commit");
      const rejected = expect(result).rejects.toThrow(/OpenCode/);
      await vi.waitFor(() => expect(processes[0]?.prompts.size).toBe(1));
      await driver.shutdown?.();
      await rejected;
      expectReleased(processes[0]);
    });
  });
});
