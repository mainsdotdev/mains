import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DatabaseClient from "./db/client";
import { databaseOwnershipPath } from "./db/database-ownership";
import { configureIpcMainAdapter } from "./ipc-kit/ipc-main";
import { registeredChannels } from "./ipc-kit/handler-registry";
import { installTestBackendRuntime } from "../test/backend-runtime";
import { startBackendServer, type BackendServer, type ServeOptions } from "./serve";
import { withWorkspaceIntake } from "./modules/workspace/workspace-intake-lifecycle";
import { recordKey, transitionRecord } from "./runtime/record-lifecycle";
import { atlasService } from "./modules/atlas";
import { atlasBookmarks } from "./modules/atlas/atlas.bookmarks";
import { terminalService } from "./modules/terminal";
import * as providers from "./modules/providers";
import { readUsagePrices } from "./modules/stats/stats.pricing";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import WebSocket from "ws";
import { buildSubprotocols } from "@mains/contracts/ws-protocol";
import { CHANNELS } from "@mains/contracts/channels";
import { getDb } from "./db/client";
import { providers as providerTable } from "./db/schema";
import { eq } from "drizzle-orm";
import { createSpace, createWorkspace } from "../test/factories";
import * as providerAdapters from "./modules/providers/adapters";
import { createFakeDriver } from "./modules/providers/adapters/fake.driver";
import { createWorkRunAdapter } from "./modules/providers/adapters/work-run-core";
import { insertRunInputArtifact } from "./modules/runs/run-input-artifact";

async function socketInvoke(socket: WebSocket, id: number, channel: string, args: unknown[], commandId?: string) {
  const response = new Promise<unknown>((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      const reply = JSON.parse(data.toString());
      if (reply.kind !== "response" || reply.id !== id) return;
      socket.off("message", onMessage);
      resolve(reply.result);
    };
    socket.on("message", onMessage);
    socket.send(JSON.stringify({ kind: "invoke", id, channel, args, commandId }), error => { if (error) reject(error); });
  });
  return response;
}

let directory: string, restoreRuntime: () => void, restoreIpc: () => void;
let server: BackendServer | undefined, retry: (() => Promise<void>) | undefined;
const start = (options: ServeOptions = {}) => startBackendServer({ host: "127.0.0.1", port: 0, token: "host-lifecycle-test", webRoot: null, ...options });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "mains-host-lifecycle-"));
  restoreRuntime = installTestBackendRuntime({ getPath: () => directory });
  restoreIpc = configureIpcMainAdapter(null);
});
afterEach(async () => {
  await retry?.(); retry = undefined;
  await server?.close(); server = undefined;
  await DatabaseClient.reset(); restoreIpc(); restoreRuntime(); fs.rmSync(directory, { recursive: true, force: true });
});

describe("backend host acquisition and shutdown", () => {
  it("serves the first Mate flows to an actual paired device with command receipts", async () => {
    server = await start();
    const endpoint = `http://127.0.0.1:${server.port}`;
    const { code } = await server.createPairingCode([endpoint]);
    const pairing = await fetch(`${endpoint}/pair`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, deviceName: "QA iPhone", platform: "ios" }),
    });
    expect(pairing.status).toBe(200);
    const { deviceToken } = await pairing.json() as { deviceToken: string };
    const openDevice = () => new WebSocket(`ws://127.0.0.1:${server!.port}`, buildSubprotocols(deviceToken));
    let socket = openDevice();
    let id = 0;
    const invoke = (channel: string, args: unknown[], commandId?: string) => socketInvoke(socket, ++id, channel, args, commandId);
    const models = vi.spyOn(providers.providersService, "getModels").mockResolvedValue([{ id: "test-model", displayName: "Test model" }]);
    const driver = createFakeDriver();
    const workerReleased = deferred();
    const createSession = driver.driver.createSession;
    const executePrompt = driver.driver.executePrompt;
    const workerSessions = new Set<unknown>();
    driver.driver.createSession = async request => {
      const session = await createSession(request);
      if (request.configSnapshot?.assistantId && request.mode === "developer") workerSessions.add(session.session);
      return session;
    };
    driver.driver.executePrompt = async (session, prompt, event, signal) => {
      if (workerSessions.has(session)) await workerReleased.promise;
      return executePrompt(session, prompt, event, signal);
    };
    driver.enable("resumeSession");
    const resume = driver.driver.resumeSession!;
    driver.driver.resumeSession = async request => {
      const session = await resume(request);
      if (request.clientUserMessageId) {
        await insertRunInputArtifact(request.runId, {
          type: "artifact", kind: "user-prompt", content: request.message, metadata: { clientUserMessageId: request.clientUserMessageId },
        });
        await request.onInputAccepted?.(request.clientUserMessageId);
      }
      return session;
    };
    driver.driver.generateText = async () => JSON.stringify({ description: "Build checks", instructions: "Summarize the sample." });
    const adapter = vi.spyOn(providerAdapters, "createWorkAdapter").mockReturnValue(createWorkRunAdapter(driver.driver));
    try {
      await once(socket, "open");
      const db = getDb();
      const accountId = "default";
      db.update(providerTable).set({ isEnabled: true }).where(eq(providerTable.id, "codex")).run();
      const space = createSpace(db, { id: "mate-test-code", accountId, providerId: "codex", mode: "developer" });
      const repo = path.join(directory, "mate-code");
      execFileSync("git", ["init", "--quiet", repo]);
      const workspace = createWorkspace(db, { id: "mate-test-repo", accountId, rootPath: repo });
      expect(await invoke(CHANNELS.backend.describe, [])).toMatchObject({ success: true, data: { capabilities: expect.arrayContaining(["assistants"]) } });
      expect(await invoke(CHANNELS.assistants.overview, [accountId])).toMatchObject({ success: false });
      expect(await invoke(CHANNELS.assistants.mobileDirectory, ["foreign"])).toMatchObject({ success: false });

      const input = { accountId, name: "Release", spaceId: space.id, model: "test-model", profileSetup: true };
      expect(await invoke(CHANNELS.assistants.create, [input])).toMatchObject({ success: false, error: expect.stringContaining("commandId") });
      const created = await invoke(CHANNELS.assistants.create, [input], "create-mate") as { success: boolean; data: { id: string } };
      expect(created).toMatchObject({ success: true, data: { id: expect.any(String) } });
      const disconnected = once(socket, "close");
      socket.close();
      await disconnected;
      socket = openDevice();
      await once(socket, "open");
      expect(await invoke(CHANNELS.assistants.create, [input], "create-mate")).toEqual(created);
      const mateId = created.data.id;
      expect(await invoke(CHANNELS.assistants.mobileDirectory, [accountId])).toMatchObject({
        success: true, data: { mates: [{ id: mateId, needsSetup: true, welcome: null }] },
      });
      expect(await invoke(CHANNELS.assistants.setupProfile, [accountId, mateId, { action: "answer", step: 0, answer: "Release help" }], "answer-setup"))
        .toMatchObject({ success: true });
      const profile = { description: "Build checks", instructions: "Summarize the sample." };
      await vi.waitFor(async () => expect(await invoke(CHANNELS.assistants.mobileDirectory, [accountId, mateId])).toMatchObject({
        success: true, data: { mates: [{ welcome: { question: { profileSetup: { draft: profile } } } }] },
      }));
      expect(await invoke(CHANNELS.assistants.setupProfile, [accountId, mateId, { action: "save", profile }], "save-setup")).toMatchObject({ success: true });

      const saved = await invoke(CHANNELS.assistants.mobileDirectory, [accountId, mateId]) as { data: { mates: Array<{ welcome: { runId: string } }> } };
      const welcomeRunId = saved.data.mates[0].welcome.runId;
      const sent = await invoke(CHANNELS.assistants.send, [{
        accountId, assistantId: mateId, message: "Say hello", requestId: `welcome-${mateId}`, runId: welcomeRunId,
      }], "new-mate-chat") as { data: { runId: string } };
      expect(sent).toMatchObject({ success: true, data: { runId: expect.any(String) } });
      expect(await invoke(CHANNELS.assistants.conversations, [accountId, mateId])).toMatchObject({
        success: true, data: expect.arrayContaining([expect.objectContaining({ id: welcomeRunId, title: "Say hello" })]),
      });

      const token = `@assistant-${mateId}`;
      const codeRun = await invoke(CHANNELS.runs.execute, [{ accountId, providerId: "codex", mode: "developer", spaceId: space.id,
        workspaceId: workspace.id, goal: `${token} Check the sample`, clientPromptId: "mate-call",
        initialContext: [{ kind: "note", metadata: { source: "assistant_mention", token, assistantId: mateId, requestId: "selection" } }],
      }], "start-code") as { data: { runId: string } };
      const runId = codeRun.data.runId;
      const { assistantsService, assistantWork } = await import("./modules/assistants");
      const task = await vi.waitFor(() => {
        const value = assistantsService.overview(accountId).assignments.find(item => item.fromRunId === runId);
        expect(value?.status).toBe("running");
        return value!;
      });
      expect(await invoke(CHANNELS.runs.getHistory, [{ runId, direction: "latest", profile: "mobile", conversationWindow: true }])).toMatchObject({
        success: true, data: { artifacts: expect.arrayContaining([
          expect.objectContaining({ metadata: expect.objectContaining({ source: "assistant_assignment", assignmentId: task.id }) }),
        ]) },
      });
      expect(await invoke(CHANNELS.assistants.mobileAssignment, [accountId, sent.data.runId, task.id])).toMatchObject({ success: false });
      await assistantWork.report(task.workerRunId!, { assignmentId: task.id, status: "completed", result: "Sample checked", evidence: ["Checked the fixture repository"] });
      expect(await invoke(CHANNELS.assistants.mobileAssignment, [accountId, runId, task.id])).toMatchObject({
        success: true, data: { workerRunId: task.workerRunId, result: "Sample checked", status: "completed" },
      });
      await vi.waitFor(() => expect(driver.calls.resumeSession.some(request => request.runId === runId && request.message.includes("Sample checked"))).toBe(true));
    } finally {
      workerReleased.resolve();
      socket.close();
      await server.close();
      models.mockRestore();
      adapter.mockRestore();
    }
  });

  it("retires price refresh before releasing the host and ignores its late network response", async () => {
    const entered = deferred(); let finish!: (response: Response) => void; let signal: AbortSignal | undefined;
    const response = new Promise<Response>((resolve) => { finish = resolve; });
    vi.stubGlobal("fetch", vi.fn((_url, init) => { signal = init?.signal ?? undefined; entered.resolve(); return response; }));
    let reading: ReturnType<typeof readUsagePrices> | undefined;
    try {
      server = await start(); reading = readUsagePrices(); await entered.promise; await server.close();
      expect(signal?.aborted).toBe(true);
      expect((await readUsagePrices()).pricing.status).toBe("unavailable");
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      finish(new Response(JSON.stringify({ model: { input_cost_per_token: 1, output_cost_per_token: 1 } })));
      await reading; await new Promise<void>((resolve) => setImmediate(resolve)); vi.unstubAllGlobals();
    }
    expect(fs.existsSync(path.join(directory, "usage", "model-prices.json"))).toBe(false);
  });

  it("drains provider cleanup despite a failed terminal stop and retains database ownership for retry", async () => {
    server = await start();
    const entered = deferred(), gate = deferred();
    const terminal = vi.spyOn(terminalService, "destroyAll").mockImplementationOnce(() => { throw new Error("Native stop failed"); });
    const adapters = vi.spyOn(providers, "shutdownAllWorkAdapters").mockImplementationOnce(async () => { entered.resolve(); await gate.promise; });
    const closing = server.close().catch((error: unknown) => error);
    try {
      await entered.promise;
      expect(DatabaseClient.getInstance().isReady()).toBe(true);
      gate.resolve();
      expect(await closing).toBeInstanceOf(Error);
      expect(DatabaseClient.getInstance().isReady()).toBe(true);
      expect(fs.existsSync(databaseOwnershipPath(path.join(directory, "mains.db")))).toBe(true);
    } finally { gate.resolve(); await closing; terminal.mockRestore(); adapters.mockRestore(); }
    await server.close();
    expect(DatabaseClient.getInstance().isReady()).toBe(false);
  });
  it("drains Atlas preparations before closing SQLite and prevents a late bookmark write", async () => {
    server = await start();
    const gate = deferred(), entered = deferred();
    const preferences = vi.spyOn(atlasBookmarks, "preferences").mockImplementationOnce(async () => {
      entered.resolve(); await gate.promise; return { enabled: false, providerId: "", model: "" };
    });
    const saving = atlasService.saveBookmark({ accountId: "default", url: "https://example.com" });
    const outcome = saving.then(() => "saved", (error: Error) => error.message);
    await entered.promise;
    let closed = false;
    const closing = server.close().then(() => { closed = true; });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false);
      expect(DatabaseClient.getInstance().isReady()).toBe(true);
      expect(fs.existsSync(databaseOwnershipPath(path.join(directory, "mains.db")))).toBe(true);
    } finally { gate.resolve(); await outcome; await closing; preferences.mockRestore(); }
    expect(await outcome).toContain("stopping");
    expect(DatabaseClient.getInstance().isReady()).toBe(false);
    server = await start();
    expect(atlasService.list({ accountId: "default", kind: "bookmark" })).toEqual([]);
  });
  it("drains accepted record side effects and their child cleanup before releasing SQLite", async () => {
    server = await start(); const gate = deferred(); let childFinished = false;
    await transitionRecord(recordKey("workspace", "retiring"), "archive", async ({ hold }) => {
      hold(gate.promise.then(() => transitionRecord(recordKey("run", "child"), "delete", async () => { childFinished = true; })));
    });
    const closing = server.close(); let closed = false; void closing.then(() => { closed = true; });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false); expect(DatabaseClient.getInstance().isReady()).toBe(true);
      await expect(transitionRecord(recordKey("run", "new"), "delete", async () => {})).rejects.toThrow("shutting down");
    } finally { gate.resolve(); await closing; }
    expect(childFinished).toBe(true); expect(DatabaseClient.getInstance().isReady()).toBe(false);
  });

  it("keeps the database lease until accepted workspace registration drains", async () => {
    server = await start();
    const gate = deferred();
    const accepted = withWorkspaceIntake({ accountId: "default", source: { kind: "folder", path: directory } }, async () => { await gate.promise; return "registered"; });
    const closing = server.close(); let closed = false; void closing.then(() => { closed = true; });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false);
      expect(DatabaseClient.getInstance().isReady()).toBe(true);
      expect(fs.existsSync(databaseOwnershipPath(path.join(directory, "mains.db")))).toBe(true);
    } finally { gate.resolve(); await accepted; await closing; }
    expect(DatabaseClient.getInstance().isReady()).toBe(false);
  });

  it("retires a pending host start and cleans a late database initialization before another start", async () => {
    const ready = deferred(), entered = deferred(), cancellation = new AbortController();
    const restoreReady = installTestBackendRuntime({ getPath: () => directory, whenReady: () => { entered.resolve(); return ready.promise; } });
    try {
      const opening = start({ signal: cancellation.signal }); await entered.promise;
      await expect(start()).rejects.toThrow(/already|own/);
      cancellation.abort(); ready.resolve();
      await expect(opening).rejects.toThrow(/cancel|clos/i);
      expect(registeredChannels()).toEqual([]);
      expect(fs.existsSync(databaseOwnershipPath(path.join(directory, "mains.db")))).toBe(false);
      server = await start();
    } finally { ready.resolve(); restoreReady(); }
  });

  it("shares explicit and signaled close and leaves the next host's handlers intact", async () => {
    const cancellation = new AbortController(); server = await start({ signal: cancellation.signal });
    const old = server; cancellation.abort();
    const closing = old.close(); expect(old.close()).toBe(closing); await closing;
    server = await start();
    await old.close();
    expect(registeredChannels()).toContain("backend:describe");
  });

  it("retains failed startup cleanup and its database lease until the cleanup can be retried", async () => {
    let registered = 0, broken = true;
    const restoreBroken = configureIpcMainAdapter({
      handle() { if (++registered === 2) throw new Error("Injected registration failure"); },
      removeHandler() { if (broken) throw new Error("Injected adapter cleanup failure"); },
    });
    try {
      const failure = await start().catch((error: unknown) => error);
      expect(failure).toHaveProperty("errors", expect.arrayContaining([
        expect.objectContaining({ message: "Injected registration failure" }),
        expect.objectContaining({ message: "Injected adapter cleanup failure" }),
      ]));
      expect(fs.existsSync(databaseOwnershipPath(path.join(directory, "mains.db")))).toBe(true);
      await expect(start()).rejects.toThrow(/already|own/);
      expect(failure).toHaveProperty("close", expect.any(Function));
      retry = (failure as { close: () => Promise<void> }).close;
      broken = false; await retry(); retry = undefined;
      expect(registeredChannels()).toEqual([]);
      expect(fs.existsSync(databaseOwnershipPath(path.join(directory, "mains.db")))).toBe(false);
    } finally { broken = false; restoreBroken(); }
    server = await start();
  });
});
