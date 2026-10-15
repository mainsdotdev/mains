import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTestBackendRuntime } from "../../../../test/backend-runtime";
import {
  clearClaudeCliCache,
  detectInstalledClis,
  resolveClaudeRuntime,
} from "../providers.utils";
import { createClaudeDriver, mapSDKMessage } from "./claude.driver";
import { runsRepo } from "../../runs/runs.repo";
import { bridgeService } from "../../bridge";
import type { WorkRunEvent } from "../../../../shared/adapter.types";

const sdk = vi.hoisted(() => ({
  query: vi.fn(),
  supportedModels: vi.fn(),
  initializationResult: vi.fn(),
  accountInfo: vi.fn(),
  usage: vi.fn(),
  close: vi.fn(),
  getSessionMessages: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: sdk.query,
  createSdkMcpServer: undefined,
  tool: undefined,
  getSessionInfo: undefined,
  deleteSession: undefined,
  getSessionMessages: sdk.getSessionMessages,
}));
vi.mock("../../guards/guards.service", () => ({
  guardsService: { buildClaudeGuardHook: vi.fn().mockResolvedValue(null) },
}));
vi.mock("../../bridge", () => ({ bridgeService: { mirrorClaudeSession: vi.fn().mockResolvedValue(undefined) } }));

describe("Claude runtime without a system CLI", () => {
  let fixture: string;
  let bundled: string;
  let configured: string;
  let statusFile: string;
  let callsFile: string;
  let restoreRuntime: () => void;

  function cliCalls(): string {
    return fs.existsSync(callsFile) ? fs.readFileSync(callsFile, "utf8") : "";
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(runsRepo, "findClaudeTaskAnchorsByRun").mockResolvedValue([]);
    clearClaudeCliCache();
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), "mains-claude-runtime-"));
    const appPath = path.join(fixture, "Okan's Mains.app", "app.asar");
    bundled = path.join(
      appPath + ".unpacked", ".vite", "build", "node_modules",
      `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`, "claude",
    );
    configured = path.join(fixture, "custom", "claude");
    statusFile = path.join(fixture, "status.json");
    callsFile = path.join(fixture, "calls.txt");
    fs.writeFileSync(statusFile, JSON.stringify({
      loggedIn: true,
      email: "account@example.test",
      subscriptionType: "Pro",
    }));
    const script = `#!/bin/sh
if [ -n "$ANTHROPIC_API_KEY$ANTHROPIC_AUTH_TOKEN" ]; then exit 2; fi
printf '%s\\n' "$*" >> '${callsFile}'
case "$1" in
  --version) printf '2.1.283 (Claude Code)\\n';;
  auth)
    if [ "$2" = status ]; then /bin/cat '${statusFile}';
    else printf 'login started\\n'; fi;;
  update) printf 'updated\\n';;
esac
`;
    for (const binary of [bundled, configured]) {
      fs.mkdirSync(path.dirname(binary), { recursive: true });
      fs.writeFileSync(binary, script, { mode: 0o755 });
    }
    restoreRuntime = installTestBackendRuntime({
      isPackaged: () => true,
      getAppPath: () => appPath,
      getPath: () => fixture,
    });
    vi.stubEnv("ANTHROPIC_API_KEY", "unused-api-key");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "unused-auth-token");
    sdk.supportedModels.mockResolvedValue([
      { value: "default", description: "Use the default model (currently Claude Sonnet)" },
      { value: "sonnet", displayName: "Claude Sonnet", description: "Claude Sonnet 5 · Live catalogue" },
    ]);
    sdk.initializationResult.mockResolvedValue({
      commands: [{ name: "help", description: "Live command", argumentHint: "" }],
    });
    sdk.accountInfo.mockResolvedValue({ email: "legacy@example.test", subscriptionType: "Pro" });
    sdk.usage.mockResolvedValue({ rate_limits_available: false, rate_limits: null });
    sdk.getSessionMessages.mockResolvedValue([]);
    sdk.query.mockImplementation(() => ({
      supportedModels: sdk.supportedModels,
      initializationResult: sdk.initializationResult,
      accountInfo: sdk.accountInfo,
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: sdk.usage,
      close: sdk.close,
      async *[Symbol.asyncIterator]() {
        yield { type: "assistant", message: { content: [{ type: "text", text: "ok" }] } };
      },
    }));
  });

  afterEach(() => {
    restoreRuntime();
    clearClaudeCliCache();
    vi.unstubAllEnvs();
    fs.rmSync(fixture, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("uses the bundled executable for runs, the live catalogue, commands and account probes", async () => {
    const driver = createClaudeDriver({ settingSources: [] });
    expect(resolveClaudeRuntime()).toEqual({ path: bundled, source: "bundled" });
    expect(detectInstalledClis()).toMatchObject({ claude: true, claudeSource: "bundled" });
    const models = await driver.listModels!();
    expect(models).toEqual([expect.objectContaining({
      id: "sonnet", displayName: "Claude Sonnet", description: "Claude Sonnet 5 · Live catalogue",
    })]);
    expect(await driver.listCommands!(fixture)).toEqual([
      expect.objectContaining({ name: "help", description: "Live command" }),
    ]);
    expect(await driver.getAccountInfo!()).toMatchObject({
      account: { type: "claude", email: "account@example.test" },
      cli: { version: "2.1.283", source: "bundled", updateMethod: "app" },
    });
    expect(await driver.generateText!("hello", { model: "sonnet" })).toBe("ok");
    for (const [{ options }] of sdk.query.mock.calls) {
      expect(options.pathToClaudeCodeExecutable).toBe(bundled);
      expect(options.env).not.toHaveProperty("ANTHROPIC_API_KEY");
      expect(options.env).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");
    }
    expect(sdk.close).toHaveBeenCalledTimes(2);
    expect(cliCalls()).toContain("auth status --json");
  });

  it("reads plan usage through a control query using the selected runtime and releases it", async () => {
    sdk.usage.mockResolvedValueOnce({
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 25, resets_at: "2026-10-12T18:00:00Z" },
        seven_day: { utilization: 60, resets_at: null },
      },
    });
    const limits = await createClaudeDriver({ binary: configured }).getRateLimits!();
    expect(limits).toMatchObject({ primary: { usedPercent: 25 }, secondary: { usedPercent: 60 } });
    expect(sdk.usage).toHaveBeenCalledExactlyOnceWith({ skipBehaviors: true });
    expect(sdk.query).toHaveBeenCalledExactlyOnceWith({
      prompt: "",
      options: expect.objectContaining({ pathToClaudeCodeExecutable: configured }),
    });
    expect(sdk.close).toHaveBeenCalledOnce();
  });

  it("releases the control query when usage cannot be fetched", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sdk.usage.mockRejectedValueOnce(new Error("Usage unavailable"));
    expect(await createClaudeDriver({}).getRateLimits!()).toBeNull();
    expect(sdk.close).toHaveBeenCalledOnce();
  });

  it("returns no usage for older SDKs without the experimental method and releases the query", async () => {
    sdk.query.mockReturnValueOnce({ close: sdk.close });
    expect(await createClaudeDriver({}).getRateLimits!()).toBeNull();
    expect(sdk.usage).not.toHaveBeenCalled();
    expect(sdk.close).toHaveBeenCalledOnce();
  });

  it("steers the open parent query with native acceptance, preserving context and a single prompt artifact", async () => {
    const events: WorkRunEvent[] = [];
    let ready!: () => void; const initialized = new Promise<void>((resolve) => { ready = resolve; });
    let release!: () => void; const accept = new Promise<void>((resolve) => { release = resolve; });
    const cancel = vi.fn().mockResolvedValue(true);
    sdk.query.mockImplementation(({ prompt, options }) => ({ close: sdk.close, cancelAsyncMessage: cancel,
      async *[Symbol.asyncIterator]() {
        expect(options.extraArgs).toEqual({ "replay-user-messages": null });
        const input = prompt[Symbol.asyncIterator]();
        const first = (await input.next()).value;
        const base = { session_id: options.sessionId, parent_tool_use_id: null };
        yield { ...base, type: "command_lifecycle", command_uuid: first.uuid, state: "started" };
        yield { ...base, type: "system", subtype: "init", model: "sonnet", capabilities: ["msg_lifecycle_v1"] };
        ready(); await accept;
        const steer = (await input.next()).value;
        expect(steer).toMatchObject({ type: "user", uuid: "client-steer", priority: "now", parent_tool_use_id: null });
        expect(steer.message.content).toContain("Change the approach");
        expect(steer.message.content).toContain("reference.ts");
        expect(steer.message.content).toContain("Use the reference");
        expect(steer.message.content).toContain("selected-skill");
        expect(steer).not.toHaveProperty("model");
        yield { ...base, type: "command_lifecycle", command_uuid: steer.uuid, state: "started" };
        yield { ...steer, ...base }; // A second receipt cannot duplicate the prompt.
        yield { ...base, type: "assistant", uuid: "answer", message: { role: "assistant", content: [{ type: "text", text: "Adjusted" }] },
          user_message_uuids: [first.uuid, steer.uuid] };
        yield { ...base, type: "result", subtype: "success", total_cost_usd: 0, num_turns: 1, duration_ms: 1,
          stop_reason: "end_turn", user_message_uuids: [first.uuid, steer.uuid], result: "Adjusted", modelUsage: {} };
        expect(await input.next()).toMatchObject({ done: true });
      },
    }));
    const driver = createClaudeDriver({ settingSources: [] });
    const acquired = await driver.createSession({ runId: "steer", accountId: "account-1", goal: "Start", execution: { workspaceId: null, cwd: fixture } });
    const execution = driver.executePrompt(acquired.session, acquired.prompt, (event) => { events.push(event); }, new AbortController().signal);
    await initialized;
    const sending = driver.steerRun!({ runId: "steer", clientUserMessageId: "client-steer", message: "Change the approach @reference.ts",
      context: [{ kind: "note", ref: "Use the reference" }],
      contextFiles: [{ path: "reference.ts" }], skills: [{ name: "selected-skill" }] });
    expect(events.filter((event) => event.type === "artifact" && event.kind === "user-prompt")).toEqual([]);
    release(); await expect(sending).resolves.toEqual({ turnId: expect.any(String) });
    await expect(execution).resolves.toMatchObject({ status: "succeeded" });
    const prompts = events.filter((event) => event.type === "artifact" && event.kind === "user-prompt");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ content: "Change the approach @reference.ts", metadata: {
      clientUserMessageId: "client-steer", delivery: "steer", files: [{ path: "reference.ts" }], skills: [{ name: "selected-skill" }],
    } });
    expect(events.some((event) => event.type === "log" && event.level === "sdk-user")).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    await expect(driver.steerRun!({ runId: "steer", clientUserMessageId: "late", message: "Late" })).rejects.toThrow("no active");
    await driver.cleanup?.(acquired.session);
    expect(bridgeService.mirrorClaudeSession).toHaveBeenCalledWith({ runId: "steer", sessionId: acquired.sessionId, dir: fixture });
    expect(sdk.close.mock.invocationCallOrder.at(-1)).toBeLessThan(vi.mocked(bridgeService.mirrorClaudeSession).mock.invocationCallOrder.at(-1)!);
    expect(sdk.query.mock.calls.at(-1)?.[0].options).not.toHaveProperty("sessionStore");
    vi.mocked(bridgeService.mirrorClaudeSession).mockRejectedValueOnce(new Error("Private raw session must not be logged"));
    await expect(driver.cleanup?.(acquired.session)).resolves.toBeUndefined();
  });

  it("acknowledges a queued continuation by its client uuid before its assistant reply", async () => {
    const driver = createClaudeDriver({ settingSources: [] });
    const request = { runId: "continued", accountId: "account-1", execution: { workspaceId: null, cwd: fixture } };
    const first = await driver.createSession({ ...request, goal: "Start" });
    const accepted = vi.fn().mockResolvedValue(undefined);
    const resumed = await driver.resumeSession!({ ...request, message: "Next", clientUserMessageId: "client-queue", onInputAccepted: accepted });
    sdk.query.mockImplementation(({ prompt, options }) => ({ close: sdk.close,
      async *[Symbol.asyncIterator]() {
        const input = prompt[Symbol.asyncIterator](); const message = (await input.next()).value;
        expect(message.uuid).toBe("client-queue"); expect(message.message.content).toBe("Next");
        yield { type: "command_lifecycle", command_uuid: message.uuid, state: "queued", session_id: options.resume };
        expect(accepted).not.toHaveBeenCalled();
        yield { type: "command_lifecycle", command_uuid: message.uuid, state: "started", session_id: options.resume };
        expect(accepted).toHaveBeenCalledExactlyOnceWith("client-queue");
        yield { type: "assistant", parent_tool_use_id: null, message: { role: "assistant", content: [{ type: "text", text: "ok" }] }, session_id: options.resume };
      },
    }));
    await expect(driver.executePrompt(resumed.session, resumed.prompt, () => {}, new AbortController().signal)).resolves.toMatchObject({ status: "succeeded" });
    await driver.cleanup?.(first.session); await driver.cleanup?.(resumed.session);
  });

  it("recovers uncertain input from native history without accepting tool results or child messages", async () => {
    const driver = createClaudeDriver({ settingSources: [] });
    sdk.getSessionMessages.mockResolvedValue([
      { type: "user", uuid: "child", parent_tool_use_id: "spawn", message: { content: "Child" } },
      { type: "user", uuid: "tool", message: { content: [{ type: "tool_result", content: "Done" }] } },
      { type: "user", uuid: "accepted", parent_tool_use_id: null, message: { content: "Guidance" } },
    ]);
    await expect(driver.getInputStatus!("run", "accepted", "native-session")).resolves.toEqual({ accepted: true });
    await expect(driver.getInputStatus!("run", "child", "native-session")).resolves.toEqual({ accepted: false });
    await expect(driver.getInputStatus!("run", "tool", "native-session")).resolves.toEqual({ accepted: false });
    await expect(driver.getInputStatus!("run", "unknown", "native-session")).resolves.toEqual({ accepted: false });
  });

  it("stops pending native input along with the active query", async () => {
    const request = vi.fn().mockResolvedValue({ response: { still_queued: [], cancelled: [] } });
    let ready!: () => void; const initialized = new Promise<void>((resolve) => { ready = resolve; });
    const abort = new AbortController();
    sdk.query.mockImplementation(({ prompt, options }) => ({ close: sdk.close, request,
      async *[Symbol.asyncIterator]() {
        const input = prompt[Symbol.asyncIterator](); const first = (await input.next()).value;
        yield { type: "command_lifecycle", command_uuid: first.uuid, state: "started", session_id: options.sessionId };
        yield { type: "system", subtype: "init", capabilities: ["msg_lifecycle_v1"], session_id: options.sessionId };
        ready(); await new Promise<void>((resolve) => options.abortController.signal.addEventListener("abort", () => resolve(), { once: true }));
        expect(await input.next()).toMatchObject({ done: true });
      },
    }));
    const driver = createClaudeDriver({ settingSources: [] });
    const acquired = await driver.createSession({ runId: "stop", accountId: "account-1", goal: "Start", execution: { workspaceId: null, cwd: fixture } });
    const execution = driver.executePrompt(acquired.session, acquired.prompt, () => {}, abort.signal);
    await initialized;
    const pending = driver.steerRun!({ runId: "stop", clientUserMessageId: "pending", message: "Guidance" });
    const rejected = expect(pending).rejects.toThrow("connection closed"); abort.abort();
    await expect(execution).resolves.toMatchObject({ status: "canceled" }); await rejected;
    expect(request).toHaveBeenCalledWith({ subtype: "interrupt", cancel_queued: true });
    await driver.cleanup?.(acquired.session);
    expect(bridgeService.mirrorClaudeSession).toHaveBeenCalledWith({ runId: "stop", sessionId: acquired.sessionId, dir: fixture });
  });

  it("delivers a deferred web result after an intermediate turn without completing the call early", async () => {
    const events: WorkRunEvent[] = [];
    sdk.query.mockImplementation(({ options }) => ({
      close: sdk.close,
      async *[Symbol.asyncIterator]() {
        const base = { session_id: options.sessionId, parent_tool_use_id: null };
        const result = { type: "result", subtype: "success", is_error: false, total_cost_usd: 0,
          num_turns: 1, duration_ms: 1, modelUsage: {}, permission_denials: [], stop_reason: "end_turn", result: "" };
        yield { ...base, type: "assistant", uuid: "start", message: { role: "assistant", content: [
          { type: "tool_use", id: "web-1", name: "WebFetch", input: { url: "https://docs.test" } },
        ] } };
        yield { ...base, type: "user", uuid: "detached", tool_use_result: { detachedToolCall: true },
          message: { role: "user", content: [{ type: "tool_result", tool_use_id: "web-1", content: "Result will follow" }] } };
        yield { ...result, ...base, uuid: "turn-1" };
        expect(events.filter((event) => event.type === "tool_call" && event.metadata?.phase === "complete")).toEqual([]);
        yield { ...base, type: "user", uuid: "real-result", message: {
          role: "user", content: [{ type: "tool_result", tool_use_id: "web-1", content: "Actual page" }],
        } };
        yield { ...result, ...base, uuid: "turn-2" };
      },
    }));
    const driver = createClaudeDriver({ settingSources: [] });
    const acquired = await driver.createSession({ runId: "deferred-web", accountId: "account-1", goal: "Read the docs",
      execution: { workspaceId: null, cwd: fixture } });
    try {
      const outcome = await driver.executePrompt(acquired.session, acquired.prompt, (event) => { events.push(event); }, new AbortController().signal);
      expect(outcome.status).toBe("succeeded");
      expect(events.filter((event) => event.type === "tool_call" && event.metadata?.phase === "complete")).toEqual([
        expect.objectContaining({ toolName: "WebFetch", input: { url: "https://docs.test" }, output: "Actual page",
          metadata: expect.objectContaining({ toolCallId: "web-1" }) }),
      ]);
    } finally {
      await driver.cleanup?.(acquired.session);
    }
  });

  it("keeps native child messages and old task outcomes out of the parent turn's result", async () => {
    const events: WorkRunEvent[] = [];
    sdk.query.mockImplementation(({ options }) => ({ close: sdk.close,
      async *[Symbol.asyncIterator]() {
        const base = { session_id: options.sessionId, uuid: "u", parent_tool_use_id: null };
        yield { ...base, type: "system", subtype: "init", model: "sonnet" };
        yield { ...base, type: "system", subtype: "task_started", task_id: "child", run_id: "001", tool_use_id: "spawn", task_type: "local_agent" };
        yield { ...base, type: "system", subtype: "task_started", task_id: "child", run_id: "002", tool_use_id: "send", task_type: "local_agent" };
        yield { ...base, type: "assistant", agent_id: "child", error: "authentication_failed", message: {
          role: "assistant", model: "child-model", content: [{ type: "text", text: "Child report" }],
        } };
        yield { ...base, type: "system", subtype: "task_notification", task_id: "child", run_id: "001", status: "failed", summary: "Old failure" };
        yield { ...base, type: "result", subtype: "success", is_error: false, total_cost_usd: 0,
          num_turns: 1, duration_ms: 1, modelUsage: {}, permission_denials: [], stop_reason: "end_turn", result: "Main answer" };
      },
    }));
    const driver = createClaudeDriver({ settingSources: [] });
    const acquired = await driver.createSession({ runId: "native-child", accountId: "account-1", goal: "Review",
      execution: { workspaceId: null, cwd: fixture } });
    try {
      const outcome = await driver.executePrompt(acquired.session, acquired.prompt, (event) => { events.push(event); }, new AbortController().signal);
      expect(outcome).toMatchObject({ status: "succeeded", usage: { model: "sonnet" } });
      expect(events).toContainEqual(expect.objectContaining({ type: "artifact", content: "Main answer", metadata: { source: "result.message", messagePhase: "final_answer" } }));
      expect(events).toContainEqual(expect.objectContaining({ type: "artifact", content: "Child report", metadata: expect.objectContaining({ agentId: "child", parentToolUseId: "send", isFromSubagent: true }) }));
      expect(events.some((event) => event.type === "task" && event.providerRunId === "001" && event.phase === "completed")).toBe(false);
    } finally {
      await driver.cleanup?.(acquired.session);
    }
  });

  it("restores stable agent, parent and execution identities for resumed conversations", async () => {
    const anchor = (taskId: string, toolUseId: string, providerRunId: string, parentTaskId: string | null = null) => ({
      taskId, toolUseId, providerRunId, parentTaskId, taskType: "local_agent", subagentType: "Explore",
      isBackgrounded: 1, ambient: 0, status: "completed", phase: "completed",
    });
    vi.mocked(runsRepo.findClaudeTaskAnchorsByRun).mockResolvedValue([
      anchor("parent", "parent-spawn", "001"), anchor("child", "spawn", "001", "parent"),
      anchor("child", "send", "002", "parent"), anchor("child", "late-old", "001", "parent"),
    ]);
    const driver = createClaudeDriver({ settingSources: [] });
    const request = { runId: "resume-agents", accountId: "account-1", goal: "Review", execution: { workspaceId: null, cwd: fixture } };
    const first = await driver.createSession(request);
    const resumed = await driver.resumeSession!({ ...request, message: "Continue the review" });
    try {
      expect(runsRepo.findClaudeTaskAnchorsByRun).toHaveBeenCalledWith("resume-agents");
      const cs = resumed.session as any;
      expect(cs.taskIndex.get("child")).toMatchObject({ toolUseId: "send", providerRunId: "002", parentTaskId: "parent", terminal: true });
      expect(cs.backgroundTasks).toBeUndefined();
      const events = mapSDKMessage({ type: "system", subtype: "task_started", uuid: "u", session_id: "s",
        task_id: "child", run_id: "003", task_type: "local_agent" } as any, cs);
      expect(events).toContainEqual(expect.objectContaining({ type: "task", status: "running", providerRunId: "003", toolCallId: "spawn", parentToolCallId: "parent-spawn" }));
      expect(mapSDKMessage({ type: "system", subtype: "task_notification", uuid: "u", session_id: "s",
        task_id: "child", run_id: "001", status: "completed" } as any, cs)).toEqual([]);
    } finally {
      await driver.cleanup?.(first.session);
      await driver.cleanup?.(resumed.session);
    }
  });

  it("reports a real signed-out state and runs login through a safely quoted bundled path", async () => {
    fs.writeFileSync(statusFile, '{"loggedIn":false}');
    const info = await createClaudeDriver({}).getAccountInfo!();
    expect(info.account).toBeNull();
    expect(sdk.accountInfo).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    expect(execFileSync("/bin/sh", ["-c", info.cli!.authLoginCommand!], { encoding: "utf8" }))
      .toBe("login started\n");
    expect(cliCalls()).toContain("auth login");
  });

  it("uses each chat's settings instead of the provider's effort and fast mode", async () => {
    const driver = createClaudeDriver({ settingSources: [], thinkingMode: true, effortLevel: "high", fastMode: true, ultracode: true });
    const request = { runId: "settings-a", accountId: "account-1", model: "sonnet",
      execution: { workspaceId: null, cwd: fixture }, goal: "hello" };
    const first = await driver.createSession({ ...request, configSnapshot: {
      permissionMode: "plan", thinkingMode: false, effortLevel: "", fastMode: false, ultracode: false,
    } });
    const options = (first.session as { options: Record<string, unknown> }).options;
    expect(options).toMatchObject({ model: "sonnet", permissionMode: "plan", thinking: { type: "disabled" } });
    expect(options).not.toHaveProperty("effort");
    expect(JSON.parse(fs.readFileSync(options.settings as string, "utf8")))
      .toMatchObject({ fastMode: false, ultracode: false });
    const resumed = await driver.resumeSession!({ ...request, message: "continue", configSnapshot: {
      permissionMode: "acceptEdits", thinkingMode: true, effortLevel: "low", fastMode: false, ultracode: false,
    } });
    expect((resumed.session as { options: Record<string, unknown> }).options)
      .toMatchObject({ permissionMode: "acceptEdits", thinking: { type: "adaptive" }, effort: "low" });
    const second = await driver.createSession({ ...request, runId: "settings-b", configSnapshot: {
      permissionMode: "default", thinkingMode: true, effortLevel: "medium", fastMode: true, ultracode: false,
    } });
    const secondOptions = (second.session as { options: Record<string, unknown> }).options;
    expect(secondOptions).toMatchObject({ permissionMode: "default", effort: "medium" });
    expect(JSON.parse(fs.readFileSync(secondOptions.settings as string, "utf8"))).toMatchObject({ fastMode: true });
    await Promise.all([first, resumed, second].map((acquired) => driver.cleanup?.(acquired.session)));
  });

  it("refreshes Atlas system instructions on resume while keeping user prompts clean", async () => {
    const driver = createClaudeDriver({ settingSources: [] });
    const request = { runId: "atlas-chat", accountId: "account-1", execution: { workspaceId: null, cwd: fixture },
      goal: "hi", configSnapshot: { atlasPageId: "page-1" }, extraInstructions: "Atlas page version: 1" };
    const first = await driver.createSession(request);
    const resumed = await driver.resumeSession!({ ...request, message: "expand this", extraInstructions: "Atlas page version: 2" });
    const ordinary = await driver.createSession({ ...request, runId: "ordinary-chat", configSnapshot: {} });
    try {
      expect(first.prompt).toBe("hi");
      expect(resumed.prompt).toBe("expand this");
      expect((first.session as { options: Record<string, unknown> }).options.systemPrompt)
        .toEqual({ type: "preset", preset: "claude_code", append: "Atlas page version: 1", snapshot: false });
      expect((resumed.session as { options: Record<string, unknown> }).options.systemPrompt)
        .toEqual({ type: "preset", preset: "claude_code", append: "Atlas page version: 2", snapshot: false });
      expect((ordinary.session as { options: Record<string, unknown> }).options.systemPrompt)
        .toMatchObject({ snapshot: true });
    } finally {
      await Promise.all([first, resumed, ordinary].map((acquired) => driver.cleanup?.(acquired.session)));
    }
  });

  it("uses the bundled process for legacy account queries and closes it", async () => {
    fs.writeFileSync(statusFile, '{}');
    const info = await createClaudeDriver({}).getAccountInfo!();
    expect(info.account).toMatchObject({ email: "legacy@example.test" });
    expect(sdk.query).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ pathToClaudeCodeExecutable: bundled }),
    }));
    expect(sdk.close).toHaveBeenCalledOnce();
  });

  it("keeps fallback models only for a failed query and retries the live catalogue", async () => {
    sdk.supportedModels.mockRejectedValueOnce(new Error("Catalogue unavailable"));
    const driver = createClaudeDriver({});
    expect((await driver.listModels!()).map((model) => model.id))
      .toEqual(["fable", "sonnet", "opus[1m]", "haiku"]);
    expect(await driver.listModels!()).toHaveLength(1);
    expect(sdk.close).toHaveBeenCalledTimes(2);
  });

  it("prevents self-updating the SDK-matched bundle", async () => {
    expect(await createClaudeDriver({}).updateCli!()).toMatchObject({
      success: false, output: expect.stringContaining("updates with the app"),
    });
    expect(cliCalls()).toBe("");
  });

  it("honors an explicit executable for detection, queries, auth and self-update", async () => {
    const driver = createClaudeDriver({ binary: configured });
    expect(detectInstalledClis(configured)).toMatchObject({ claude: true, claudeSource: "configured" });
    await driver.listModels!();
    expect(sdk.query).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ pathToClaudeCodeExecutable: configured }),
    }));
    expect(await driver.getAccountInfo!()).toMatchObject({
      cli: { source: "configured", updateMethod: "cli" },
    });
    expect(await driver.updateCli!()).toMatchObject({ success: true });
    expect(cliCalls()).toContain("update");
  });

  it("refreshes the catalogue when the selected executable changes", async () => {
    const driver = createClaudeDriver({});
    await driver.listModels!();
    driver.updateConfig!({ binary: configured });
    await driver.listModels!();
    expect(sdk.query.mock.calls.map(([request]) => request.options.pathToClaudeCodeExecutable))
      .toEqual([bundled, configured]);
  });

  it("falls back from an invalid override to the bundle, but never chooses an unrelated system CLI", () => {
    expect(resolveClaudeRuntime(path.join(fixture, "missing")))
      .toEqual({ path: bundled, source: "bundled" });
    fs.rmSync(bundled);
    clearClaudeCliCache();
    vi.stubEnv("PATH", `${path.dirname(configured)}${path.delimiter}${process.env.PATH}`);
    expect(resolveClaudeRuntime()).toBeNull();
    expect(detectInstalledClis()).toMatchObject({ claude: false });
    expect(resolveClaudeRuntime(configured)).toEqual({ path: configured, source: "configured" });
  });
});
