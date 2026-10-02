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
