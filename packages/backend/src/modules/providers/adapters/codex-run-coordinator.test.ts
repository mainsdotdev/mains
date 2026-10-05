import { describe, expect, it, vi } from "vitest";
import { createCodexRunCoordinator } from "./codex-run-coordinator";
import type { CodexAppServer } from "./codex-app-server.client";
import type { WorkRunEvent } from "../../../../shared/adapter.types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function liveRun() {
  const coordinator = createCodexRunCoordinator();
  let notify!: (method: string, params: unknown) => void;
  const ack = deferred<{ turnId: string }>();
  const sendRequest = vi.fn((method: string, _params: unknown) => method === "turn/steer" ? ack.promise : Promise.resolve({}));
  const server = { isRunning: true, sendRequest,
    setNotificationHandler: (callback: typeof notify) => { notify = callback; },
    setServerRequestHandler: () => {},
  } as unknown as CodexAppServer;
  coordinator.installDispatcher(server);
  coordinator.registerRun({ runId: "run", threadId: "parent", mainsCtx: { workspaceId: null, rootPath: null, runId: "run" } });
  const events: WorkRunEvent[] = [];
  const finished = coordinator.executeTurn(server, {
    runId: "run", model: "model", timeout: 5000,
    startTurn: async () => {
      notify("turn/started", { threadId: "parent", turn: { id: "turn-parent", status: "inProgress" } });
    },
  }, async (event) => { events.push(event); }, new AbortController().signal);
  return { coordinator, server, ack, sendRequest, events, finished, notify: (method: string, params: unknown) => notify(method, params) };
}

describe("Codex active input delivery", () => {
  it("binds steer to the parent turn and waits for ACK projection before completion", async () => {
    const h = liveRun();
    h.notify("thread/started", { thread: { id: "child", parentThreadId: "parent" } });
    h.notify("turn/started", { threadId: "child", turn: { id: "turn-child", status: "inProgress" } });
    const input = { runId: "run", clientUserMessageId: "client-input", message: "Change the approach", contextFiles: [{ path: "/project/file.ts" }] };
    const sending = h.coordinator.steerRun(h.server, input);
    expect(h.sendRequest).toHaveBeenCalledWith("turn/steer", expect.objectContaining({
      threadId: "parent", expectedTurnId: "turn-parent", clientUserMessageId: "client-input",
      input: [expect.objectContaining({ type: "text", text: expect.stringContaining("Change the approach") })],
    }));
    const payload = h.sendRequest.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("model");
    h.notify("turn/completed", { threadId: "parent", turn: { id: "turn-parent", status: "completed" } });
    let completed = false;
    void h.finished.then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    h.ack.resolve({ turnId: "turn-parent" });
    expect(await sending).toEqual({ turnId: "turn-parent" });
    expect(await h.finished).toMatchObject({ status: "succeeded" });
    const prompts = h.events.filter((event) => event.type === "artifact" && event.kind === "user-prompt");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ content: input.message, metadata: {
      delivery: "steer", clientUserMessageId: "client-input", providerTurnId: "turn-parent",
    } });
    h.coordinator.shutdown();
  });

  it("deduplicates native userMessage echoes and accepts a lost RPC response", async () => {
    const h = liveRun();
    const sending = h.coordinator.steerRun(h.server, { runId: "run", clientUserMessageId: "client", message: "continue" });
    const echo = { threadId: "parent", turnId: "turn-parent", item: { type: "userMessage", id: "native", clientId: "client", content: [{ type: "text", text: "continue" }] } };
    h.notify("item/started", echo);
    h.notify("item/completed", echo);
    await vi.waitFor(() => expect(h.events.filter((event) => event.type === "artifact" && event.kind === "user-prompt")).toHaveLength(1));
    h.ack.reject(new Error("RPC timeout: turn/steer"));
    expect(await sending).toEqual({ turnId: "turn-parent" });
    h.notify("turn/completed", { threadId: "parent", turn: { id: "turn-parent", status: "completed" } });
    expect(await h.finished).toMatchObject({ status: "succeeded" });
    expect(h.events.filter((event) => event.type === "artifact" && event.kind === "user-prompt")).toHaveLength(1);
    h.coordinator.shutdown();
  });

  it("preserves a rejected steer and never replaces it with a new turn", async () => {
    const h = liveRun();
    const sending = h.coordinator.steerRun(h.server, { runId: "run", clientUserMessageId: "client", message: "continue" });
    h.ack.reject(new Error("expectedTurnId mismatch (code: -32600)"));
    await expect(sending).rejects.toThrow("mismatch");
    expect(h.events.filter((event) => event.type === "artifact" && event.kind === "user-prompt")).toEqual([]);
    h.notify("turn/completed", { threadId: "parent", turn: { id: "turn-parent", status: "completed" } });
    await h.finished;
    await expect(h.coordinator.steerRun(h.server, { runId: "run", clientUserMessageId: "next", message: "late" })).rejects.toThrow("no active");
    expect(h.sendRequest.mock.calls.map(([method]) => method)).toEqual(["turn/steer"]);
    h.coordinator.shutdown();
  });
});

describe("Codex native voice work turns", () => {
  it("keeps an open call subscribed after normal work and tracks successive delegations", async () => {
    const h = liveRun();
    const finalizing = deferred<void>();
    const onTurnStarted = vi.fn().mockResolvedValue(undefined);
    const onEvent = vi.fn().mockResolvedValue(undefined);
    const onCompleted = vi.fn().mockImplementationOnce(() => finalizing.promise).mockResolvedValue(undefined);
    let prompt = "First spoken request";
    const release = h.coordinator.watchRealtimeRun("run", "voice-work-model", { onTurnStarted, onEvent, onCompleted }, () => prompt);
    h.notify("turn/completed", { threadId: "parent", turn: { id: "turn-parent", status: "completed" } });
    await h.finished;
    await h.coordinator.cleanupRun(h.server, "run");
    expect(h.sendRequest).not.toHaveBeenCalled();

    h.notify("turn/started", { threadId: "parent", turn: { id: "native-1", status: "inProgress" } });
    prompt = "Later speech must not replace the first request";
    h.notify("turn/plan/updated", { turnId: "native-1", plan: [{ step: "Calculate", status: "inProgress" }] });
    h.notify("turn/completed", { threadId: "parent", turn: { id: "native-1", status: "completed" } });
    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledOnce());
    expect(onTurnStarted).toHaveBeenCalledExactlyOnceWith("native-1", "First spoken request", "voice-work-model");
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "plan_update", providerTurnId: "native-1" }));
    prompt = "Second spoken request";
    h.notify("turn/started", { threadId: "parent", turn: { id: "native-2", status: "inProgress" } });
    h.notify("turn/completed", { threadId: "parent", turn: { id: "native-2", status: "completed" } });
    await Promise.resolve();
    expect(onTurnStarted).toHaveBeenCalledOnce();
    finalizing.resolve();
    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(2));
    expect(onTurnStarted).toHaveBeenLastCalledWith("native-2", "Second spoken request", "voice-work-model");
    expect(onCompleted.mock.calls.map(([result]) => result.status)).toEqual(["succeeded", "succeeded"]);
    expect(h.sendRequest).not.toHaveBeenCalled();
    release();
    await h.coordinator.cleanupRun(h.server, "run");
    expect(h.sendRequest).toHaveBeenCalledExactlyOnceWith("thread/unsubscribe", { threadId: "parent" });
    h.coordinator.shutdown();
  });

  it("finalizes failed preparation once and lets the next voice job start", async () => {
    const h = liveRun();
    const onTurnStarted = vi.fn().mockRejectedValueOnce(new Error("Conversation was deleted")).mockResolvedValue(undefined);
    const onCompleted = vi.fn().mockResolvedValue(undefined);
    h.coordinator.watchRealtimeRun("run", "model", { onTurnStarted, onEvent: vi.fn(), onCompleted });
    h.notify("turn/completed", { threadId: "parent", turn: { id: "turn-parent", status: "completed" } });
    await h.finished;
    h.notify("turn/started", { threadId: "parent", turn: { id: "failed-turn", status: "inProgress" } });
    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledOnce());
    expect(onCompleted).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", summary: "Conversation was deleted" }));
    expect(h.sendRequest).toHaveBeenCalledWith("turn/interrupt", { threadId: "parent", turnId: "failed-turn" }, 250);
    h.notify("turn/started", { threadId: "parent", turn: { id: "next-turn", status: "inProgress" } });
    h.notify("turn/completed", { threadId: "parent", turn: { id: "next-turn", status: "completed" } });
    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(2));
    expect(onCompleted).toHaveBeenLastCalledWith(expect.objectContaining({ status: "succeeded" }));
    h.coordinator.shutdown();
  });

  it("aborts a native work turn without closing its voice owner", async () => {
    const h = liveRun();
    const onCompleted = vi.fn().mockResolvedValue(undefined);
    const release = h.coordinator.watchRealtimeRun("run", "model", { onTurnStarted: vi.fn(), onEvent: vi.fn(), onCompleted });
    h.notify("turn/completed", { threadId: "parent", turn: { id: "turn-parent", status: "completed" } });
    await h.finished;
    h.notify("turn/started", { threadId: "parent", turn: { id: "native", status: "inProgress" } });
    await h.coordinator.abortNativeRun(h.server, "run");
    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledWith(expect.objectContaining({ status: "canceled" })));
    expect(h.sendRequest).toHaveBeenCalledWith("turn/interrupt", { threadId: "parent", turnId: "native" }, 250);
    await h.coordinator.cleanupRun(h.server, "run");
    expect(h.sendRequest.mock.calls.map(([method]) => method)).toEqual(["turn/interrupt"]);
    release();
    await h.coordinator.cleanupRun(h.server, "run");
    h.coordinator.shutdown();
  });
});
