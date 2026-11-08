// ─────────────────────────────────────────────────────────────
// Tests for createWorkRunAdapter (work-run-core.ts).
//
// The Driver is faked. These tests verify Core's lifecycle responsibilities:
//   - status emission order around session acquisition + executePrompt
//   - artifact collection from emitted events
//   - timestamp injection on events that lack one
//   - sessionId persistence to runsRepo
//   - AbortController plumbing (abortRun → signal fires inside Driver)
//   - cleanup ordering (driver.cleanup runs in finally; cancelPendingRequests fires)
//   - optional verbs (continueRun/forkRun/reviewRun) only attach when Driver supports them
//   - Driver-thrown errors translate to status=failed with the error message
//   - shared shutdown with or without a driver-specific hook
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  AcquiredSession,
  WorkRunEvent,
  WorkRunEventHandler,
  WorkRunRequest,
  WorkRunContinueRequest,
  WorkRunForkRequest,
  WorkRunReviewRequest,
} from "../../../../shared/adapter.types";

// Mock the side-effect dependencies before importing the SUT.
// vi.hoisted runs before the vi.mock factories are evaluated.
const { updateRunMock, cancelPendingRequestsMock } = vi.hoisted(() => ({
  updateRunMock: vi.fn().mockResolvedValue({}),
  cancelPendingRequestsMock: vi.fn(),
}));
vi.mock("../../runs/runs.repo", () => ({
  runsRepo: { updateRun: updateRunMock },
}));
vi.mock("../../runs/user-input-broker", () => ({
  cancelPendingRequests: cancelPendingRequestsMock,
}));

import { createWorkRunAdapter } from "./work-run-core";
import { createFakeDriver } from "./fake.driver";

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

function makeStartReq(overrides: Partial<WorkRunRequest> = {}): WorkRunRequest {
  return {
    runId: "run-1",
    accountId: "acct-1",
    execution: { workspaceId: "ws-1", cwd: "/tmp" },
    goal: "do the thing",
    ...overrides,
  };
}

function makeContinueReq(
  overrides: Partial<WorkRunContinueRequest> = {},
): WorkRunContinueRequest {
  return {
    runId: "run-1",
    accountId: "acct-1",
    execution: { workspaceId: "ws-1", cwd: "/tmp" },
    message: "follow-up",
    ...overrides,
  };
}

function makeForkReq(
  overrides: Partial<WorkRunForkRequest> = {},
): WorkRunForkRequest {
  return {
    runId: "fork-1",
    sourceRunId: "run-1",
    accountId: "acct-1",
    execution: { workspaceId: "ws-1", cwd: "/tmp" },
    message: "branch",
    ...overrides,
  };
}

function makeReviewReq(
  overrides: Partial<WorkRunReviewRequest> = {},
): WorkRunReviewRequest {
  return {
    runId: "review-1",
    accountId: "acct-1",
    execution: { workspaceId: "ws-1", cwd: "/tmp" },
    target: { type: "uncommittedChanges" },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe("createWorkRunAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cancels acquisition before a late session can execute its prompt", async () => {
    const fake = createFakeDriver();
    let acquired!: (value: AcquiredSession) => void;
    const opening = new Promise<AcquiredSession>((resolve) => { acquired = resolve; });
    const create = vi.fn(() => opening);
    fake.driver.createSession = create;
    const adapter = createWorkRunAdapter(fake.driver);
    const events: WorkRunEvent[] = [];
    const pending = adapter.startRun(makeStartReq({ runId: "stop-during-acquire" }), (event) => { events.push(event); });
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    await adapter.abortRun!("stop-during-acquire");
    const session = { id: "late-session" };
    acquired({ session, prompt: "must not execute", sessionId: "late-native-id" });
    await expect(pending).resolves.toMatchObject({ status: "canceled" });
    expect(fake.calls.executePrompt).toHaveLength(0);
    expect(fake.calls.cleanup).toEqual([session]);
    expect(events.filter((event) => event.type === "artifact")).toEqual([]);
    expect(updateRunMock).not.toHaveBeenCalled();
  });

  it.each([false, true])("rejects a concurrent claim without disturbing its owner (replacement=%s)", async (replacement) => {
    const fake = createFakeDriver({ awaitAbort: true });
    const adapter = createWorkRunAdapter(fake.driver);
    const other = replacement ? createWorkRunAdapter(createFakeDriver().driver) : adapter;
    const request = makeStartReq({ runId: `duplicate-${replacement}` });
    const first = adapter.startRun(request, () => {});
    await vi.waitFor(() => expect(fake.calls.executePrompt).toHaveLength(1));
    const duplicateEvents: WorkRunEvent[] = [];
    try {
      await expect(other.startRun(request, (event) => { duplicateEvents.push(event); })).resolves.toMatchObject({ status: "failed", summary: expect.stringContaining("already") });
      expect(duplicateEvents).toEqual([]);
      expect(fake.calls.cleanup).toHaveLength(0);
      expect(cancelPendingRequestsMock).not.toHaveBeenCalled();
    } finally { await other.abortRun!(request.runId); await first; }
    expect(fake.calls.cleanup).toHaveLength(1);
  });

  it("ignores an old execution's callbacks after another adapter starts the same run", async () => {
    const fake = createFakeDriver();
    let retired!: WorkRunEventHandler;
    const execute = fake.driver.executePrompt;
    fake.driver.executePrompt = async (...args) => { retired = args[2]; return execute(...args); };
    const first = createWorkRunAdapter(fake.driver);
    const oldEvents: WorkRunEvent[] = [];
    const request = makeStartReq({ runId: "reused-run-id" });
    const result = await first.startRun(request, (event) => { oldEvents.push(event); });
    const before = oldEvents.length;
    const next = createFakeDriver({ awaitAbort: true });
    const second = createWorkRunAdapter(next.driver);
    const active = second.startRun(request, () => {});
    await vi.waitFor(() => expect(next.calls.executePrompt).toHaveLength(1));
    try {
      await retired({ type: "artifact", kind: "file", path: "retired-output.txt" });
      expect(oldEvents).toHaveLength(before);
      expect(result.artifacts).toEqual([]);
    } finally { await first.abortRun!(request.runId); await active; }
    expect(next.calls.cleanup).toEqual([{ id: request.runId }]);
  });

  it("waits for an accepted continuation receipt before cleaning up its session", async () => {
    const fake = createFakeDriver(); fake.enable("resumeSession");
    fake.driver.steerRun = vi.fn().mockResolvedValue({ turnId: "native" });
    let release!: () => void, writing!: () => void;
    const write = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { writing = resolve; });
    let receipt!: Promise<void>;
    fake.driver.executePrompt = async () => {
      receipt = fake.calls.resumeSession[0].onInputAccepted!("native");
      return { status: "succeeded" };
    };
    const adapter = createWorkRunAdapter(fake.driver);
    let ended = false;
    const pending = adapter.continueRun!(makeContinueReq({ runId: "accepted-write", clientUserMessageId: "accepted-id" }), async (event) => {
      if (event.type === "artifact" && event.kind === "user-prompt") { writing(); await write; }
    });
    void pending.then(() => { ended = true; });
    await entered;
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(ended).toBe(false);
      expect(fake.calls.cleanup).toHaveLength(0);
    } finally { release(); await receipt; await pending; }
    expect(fake.calls.cleanup).toHaveLength(1);
  });

  it("shutdown cancels a pending acquisition, joins cleanup, and closes admission", async () => {
    const fake = createFakeDriver();
    let release!: (value: AcquiredSession) => void;
    const session = { id: "opened-during-shutdown" };
    const create = vi.fn(() => new Promise<AcquiredSession>((resolve) => { release = resolve; }));
    fake.driver.createSession = create;
    const shutdown = vi.fn(async () => { release({ session, prompt: "must not execute" }); });
    fake.driver.shutdown = shutdown;
    const adapter = createWorkRunAdapter(fake.driver);
    const pending = adapter.startRun(makeStartReq({ runId: "shutdown-acquire" }), () => {});
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    await Promise.all([adapter.shutdown!(), adapter.shutdown!()]);
    await expect(pending).resolves.toMatchObject({ status: "canceled" });
    expect(fake.calls.executePrompt).toHaveLength(0);
    expect(fake.calls.cleanup).toEqual([session]);
    expect(shutdown).toHaveBeenCalledTimes(1);
    await expect(adapter.startRun(makeStartReq({ runId: "after-shutdown" }), () => {})).resolves.toMatchObject({ status: "failed", summary: expect.stringContaining("shut down") });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("honors Stop from the initial status callback before acquiring a session", async () => {
    const fake = createFakeDriver();
    const adapter = createWorkRunAdapter(fake.driver);
    const request = makeStartReq({ runId: "stop-before-acquire" });
    const result = await adapter.startRun(request, async (event) => {
      if (event.type === "status" && event.status === "running") await adapter.abortRun!(request.runId);
    });
    expect(result.status).toBe("canceled");
    expect(fake.calls.createSession).toHaveLength(0);
    expect(fake.calls.cleanup).toHaveLength(0);
    expect(cancelPendingRequestsMock).toHaveBeenCalledExactlyOnceWith(request.runId);
  });

  it("finishes an admitted session-id write before cleaning up a canceled preparation", async () => {
    let release!: () => void;
    updateRunMock.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const fake = createFakeDriver();
    const adapter = createWorkRunAdapter(fake.driver);
    const events: WorkRunEvent[] = [];
    const request = makeStartReq({ runId: "stop-during-persist" });
    const pending = adapter.startRun(request, (event) => { events.push(event); });
    await vi.waitFor(() => expect(updateRunMock).toHaveBeenCalledTimes(1));
    await adapter.abortRun!(request.runId);
    expect(fake.calls.cleanup).toHaveLength(0);
    release();
    await expect(pending).resolves.toMatchObject({ status: "canceled" });
    expect(fake.calls.executePrompt).toHaveLength(0);
    expect(events.filter((event) => event.type === "artifact")).toEqual([]);
    expect(fake.calls.cleanup).toHaveLength(1);
  });

  it("keeps Stop authoritative when a driver returns a late success", async () => {
    const fake = createFakeDriver({ awaitAbort: true, outcome: { status: "succeeded" } });
    const adapter = createWorkRunAdapter(fake.driver);
    const events: WorkRunEvent[] = [];
    const request = makeStartReq({ runId: "late-driver-success" });
    const pending = adapter.startRun(request, (event) => { events.push(event); });
    await vi.waitFor(() => expect(fake.calls.executePrompt).toHaveLength(1));
    await adapter.abortRun!(request.runId);
    await expect(pending).resolves.toMatchObject({ status: "canceled" });
    expect(events.filter((event) => event.type === "status").map((event) => event.status)).toEqual(["running", "canceled"]);
  });

  it("retains a failed cleanup claim and retries it through Stop", async () => {
    const fake = createFakeDriver();
    const cleanup = vi.fn().mockRejectedValueOnce(new Error("native cleanup failed")).mockResolvedValue(undefined);
    fake.driver.cleanup = cleanup;
    const adapter = createWorkRunAdapter(fake.driver);
    const request = makeStartReq({ runId: "retry-cleanup" });
    await adapter.startRun(request, () => {});
    await expect(adapter.startRun(request, () => {})).resolves.toMatchObject({ status: "failed", summary: expect.stringContaining("cleanup") });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(cancelPendingRequestsMock).not.toHaveBeenCalled();
    await adapter.abortRun!(request.runId);
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(cancelPendingRequestsMock).toHaveBeenCalledExactlyOnceWith(request.runId);
    await expect(adapter.startRun(request, () => {})).resolves.toMatchObject({ status: "succeeded" });
    expect(cleanup).toHaveBeenCalledTimes(3);
  });

  it("attempts final status once and still cleans up when its subscriber rejects", async () => {
    const fake = createFakeDriver();
    const adapter = createWorkRunAdapter(fake.driver);
    let terminalAttempts = 0;
    await expect(adapter.startRun(makeStartReq({ runId: "terminal-sink-failed" }), async (event) => {
      if (event.type === "status" && event.status !== "running") { terminalAttempts++; throw new Error("terminal write failed"); }
    })).rejects.toThrow("terminal write failed");
    expect(terminalAttempts).toBe(1);
    expect(fake.calls.cleanup).toHaveLength(1);
    expect(cancelPendingRequestsMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a retired continuation acceptance callback without publishing or acknowledging it", async () => {
    const fake = createFakeDriver(); fake.enable("resumeSession");
    fake.driver.steerRun = vi.fn().mockResolvedValue({ turnId: "native" });
    const accepted = vi.fn();
    const events: WorkRunEvent[] = [];
    const adapter = createWorkRunAdapter(fake.driver);
    await adapter.continueRun!(makeContinueReq({ runId: "retired-receipt", clientUserMessageId: "retired-id", onInputAccepted: accepted }), (event) => { events.push(event); });
    const before = events.length;
    await expect(fake.calls.resumeSession[0].onInputAccepted!("native")).rejects.toThrow("closed before confirming input");
    expect(events).toHaveLength(before);
    expect(accepted).not.toHaveBeenCalled();
  });

  it("reports a failed admitted write even when the driver does not await its event callback", async () => {
    const fake = createFakeDriver();
    fake.driver.executePrompt = async (_session, _prompt, publish) => {
      void Promise.resolve(publish({ type: "artifact", kind: "file", path: "unrecorded.txt" })).catch(() => {});
      return { status: "succeeded" };
    };
    const adapter = createWorkRunAdapter(fake.driver);
    const statuses: string[] = [];
    const result = await adapter.startRun(makeStartReq({ runId: "event-write-failed" }), async (event) => {
      if (event.type === "artifact" && event.kind === "file") throw new Error("artifact write failed");
      if (event.type === "status") statuses.push(event.status);
    });
    expect(result).toMatchObject({ status: "failed", summary: "artifact write failed" });
    expect(statuses).toEqual(["running", "failed"]);
    expect(fake.calls.cleanup).toHaveLength(1);
  });

  it("shares shutdown and waits for per-run cleanup even without a native shutdown hook", async () => {
    const fake = createFakeDriver({ awaitAbort: true });
    let finish!: () => void, cleaning!: () => void;
    const entered = new Promise<void>((resolve) => { cleaning = resolve; });
    fake.driver.cleanup = vi.fn(() => { cleaning(); return new Promise<void>((resolve) => { finish = resolve; }); });
    const adapter = createWorkRunAdapter(fake.driver);
    const pending = adapter.startRun(makeStartReq({ runId: "shutdown-drain" }), () => {});
    await vi.waitFor(() => expect(fake.calls.executePrompt).toHaveLength(1));
    const closing = adapter.shutdown!();
    expect(adapter.shutdown!()).toBe(closing);
    let closed = false; void closing.then(() => { closed = true; });
    await entered;
    expect(closed).toBe(false);
    await expect(adapter.startRun(makeStartReq({ runId: "blocked-during-shutdown" }), () => {})).resolves.toMatchObject({ status: "failed" });
    finish(); await closing;
    await expect(pending).resolves.toMatchObject({ status: "canceled" });
    expect(fake.driver.cleanup).toHaveBeenCalledTimes(1);
  });

  it("keeps admission closed after native shutdown fails and permits a shutdown retry", async () => {
    const fake = createFakeDriver();
    const shutdown = vi.fn().mockRejectedValueOnce(new Error("native shutdown failed")).mockResolvedValue(undefined);
    fake.driver.shutdown = shutdown;
    const adapter = createWorkRunAdapter(fake.driver);
    await expect(adapter.shutdown!()).rejects.toThrow("native shutdown failed");
    await expect(adapter.startRun(makeStartReq({ runId: "failed-shutdown" }), () => {})).resolves.toMatchObject({ status: "failed" });
    expect(fake.calls.createSession).toHaveLength(0);
    await adapter.shutdown!(); await adapter.shutdown!();
    expect(shutdown).toHaveBeenCalledTimes(2);
  });

  it("retries failed run cleanup without shutting down an already released native driver again", async () => {
    const fake = createFakeDriver();
    const cleanup = vi.fn().mockRejectedValueOnce(new Error("first cleanup failed"))
      .mockRejectedValueOnce(new Error("cleanup still failed")).mockResolvedValue(undefined);
    const shutdown = vi.fn().mockResolvedValue(undefined);
    fake.driver.cleanup = cleanup; fake.driver.shutdown = shutdown;
    const adapter = createWorkRunAdapter(fake.driver);
    const request = makeStartReq({ runId: "shutdown-cleanup-retry" });
    await adapter.startRun(request, () => {});
    await expect(adapter.shutdown!()).rejects.toThrow("cleanup still failed");
    await adapter.shutdown!();
    expect(cleanup).toHaveBeenCalledTimes(3);
    expect(shutdown).toHaveBeenCalledTimes(1);
    const replacement = createWorkRunAdapter(createFakeDriver().driver);
    await expect(replacement.startRun(request, () => {})).resolves.toMatchObject({ status: "succeeded" });
  });

  it("shuts down only its own executions while cross-instance Stop still reaches the current owner", async () => {
    const first = createFakeDriver(); first.enable("shutdown");
    const other = createFakeDriver({ awaitAbort: true }); other.enable("shutdown");
    const old = createWorkRunAdapter(first.driver), current = createWorkRunAdapter(other.driver);
    const request = makeStartReq({ runId: "other-adapter-owner" });
    const pending = current.startRun(request, () => {});
    await vi.waitFor(() => expect(other.calls.executePrompt).toHaveLength(1));
    await old.shutdown!();
    expect(other.calls.executePrompt[0].signalAborted).toBe(false);
    expect(other.calls.shutdown).toBe(0);
    await old.abortRun!(request.runId);
    await expect(pending).resolves.toMatchObject({ status: "canceled" });
    await current.shutdown!();
  });

  it("preserves native accepted-input receipts during Stop while dropping late output", async () => {
    const fake = createFakeDriver();
    let started!: () => void;
    const running = new Promise<void>((resolve) => { started = resolve; });
    fake.driver.executePrompt = async (_session, _prompt, publish, signal) => {
      started();
      await new Promise<void>((resolve) => { signal.addEventListener("abort", () => resolve(), { once: true }); });
      await publish({ type: "log", message: "late output", level: "info" });
      await publish({ type: "artifact", kind: "user-prompt", content: "Native accepted input", metadata: { clientUserMessageId: "accepted-after-stop" } });
      return { status: "succeeded" };
    };
    const adapter = createWorkRunAdapter(fake.driver);
    const events: WorkRunEvent[] = [];
    const request = makeStartReq({ runId: "receipt-during-stop" });
    const pending = adapter.startRun(request, (event) => { events.push(event); });
    await running; await adapter.abortRun!(request.runId);
    await expect(pending).resolves.toMatchObject({ status: "canceled" });
    expect(events.filter((event) => event.type === "log")).toEqual([]);
    expect(events.filter((event) => event.type === "artifact" && event.metadata?.clientUserMessageId === "accepted-after-stop")).toHaveLength(1);
  });

  describe("startRun lifecycle", () => {
    it.each(["start", "continue"])("persists delegated provenance in the %s prompt", async (operation) => {
      const fake = createFakeDriver();
      fake.enable("resumeSession");
      const adapter = createWorkRunAdapter(fake.driver);
      const events: WorkRunEvent[] = [];
      const providerTurnLineage = { parentTurnId: "native-parent", rootTurnId: "native-root" };
      const publish = (event: WorkRunEvent) => { events.push(event); };
      if (operation === "start") await adapter.startRun(makeStartReq({ providerTurnLineage }), publish);
      else await adapter.continueRun!(makeContinueReq({ providerTurnLineage }), publish);
      const prompt = events.find((event) => event.type === "artifact" && event.kind === "user-prompt");
      expect(prompt).toMatchObject({ metadata: { providerParentTurnId: "native-parent", providerRootTurnId: "native-root" } });
    });

    it.each(["start", "continue"])("preserves local prompt identity after delayed %s acquisition without opting into provider acceptance", async (operation) => {
      const fake = createFakeDriver({ model: "resolved-model" });
      fake.enable("resumeSession");
      const acquire = operation === "start" ? fake.driver.createSession : fake.driver.resumeSession!;
      let ready!: () => void;
      const gate = new Promise<void>((resolve) => { ready = resolve; });
      const delayedAcquire = async (request: WorkRunRequest | WorkRunContinueRequest) => {
        await gate;
        return acquire(request as WorkRunRequest & WorkRunContinueRequest);
      };
      if (operation === "start") fake.driver.createSession = delayedAcquire;
      else fake.driver.resumeSession = delayedAcquire;
      const adapter = createWorkRunAdapter(fake.driver);
      const events: WorkRunEvent[] = [];
      const done = operation === "start"
        ? adapter.startRun(makeStartReq({ clientPromptId: "local-1" }), (event) => { events.push(event); })
        : adapter.continueRun!(makeContinueReq({ clientPromptId: "local-1" }), (event) => { events.push(event); });
      expect(events.some((event) => event.type === "artifact")).toBe(false);
      ready();
      await done;
      const prompts = events.filter((event) => event.type === "artifact" && event.kind === "user-prompt");
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toMatchObject({ metadata: { clientPromptId: "local-1", model: "resolved-model" } });
      expect(prompts[0]).not.toHaveProperty("metadata.clientUserMessageId");
    });

    it("emits running before driver.createSession and final status after executePrompt", async () => {
      const fake = createFakeDriver({
        outcome: { status: "succeeded", stopReason: "end_turn" },
      });
      const adapter = createWorkRunAdapter(fake.driver);
      const events: WorkRunEvent[] = [];

      const result = await adapter.startRun(makeStartReq(), (e) => {
        events.push(e);
      });

      const statuses = events
        .filter((e) => e.type === "status")
        .map((e) => (e as { status: string }).status);
      expect(statuses).toEqual(["running", "succeeded"]);
      expect(result.status).toBe("succeeded");
      expect(result.stopReason).toBe("end_turn");
    });

    it("collects non-ephemeral artifacts into result.artifacts", async () => {
      const fake = createFakeDriver({
        events: [
          {
            type: "artifact",
            kind: "file",
            path: "/tmp/a.ts",
            metadata: {},
          },
          {
            type: "artifact",
            kind: "report",
            content: "streaming",
            ephemeral: true,
            streamId: "s-1",
          },
          { type: "artifact", kind: "patch", path: "/tmp/b.diff", metadata: {} },
        ],
        outcome: { status: "succeeded" },
      });
      const adapter = createWorkRunAdapter(fake.driver);

      const result = await adapter.startRun(makeStartReq(), () => {});

      // Ephemeral artifact dropped from collection
      expect(result.artifacts).toEqual([
        { kind: "file", path: "/tmp/a.ts" },
        { kind: "patch", path: "/tmp/b.diff" },
      ]);
    });

    it("injects ts on events that lack one (except tool_call)", async () => {
      const fake = createFakeDriver({
        events: [
          { type: "log", message: "hi" }, // no ts
          {
            type: "tool_call",
            toolName: "Bash",
            startedAt: 100,
            endedAt: 200,
          }, // no ts on tool_call
        ],
        outcome: { status: "succeeded" },
      });
      const adapter = createWorkRunAdapter(fake.driver);
      const events: WorkRunEvent[] = [];

      await adapter.startRun(makeStartReq(), (e) => {
        events.push(e);
      });

      const log = events.find((e) => e.type === "log") as { ts?: number };
      expect(log.ts).toBeDefined();
      const toolCall = events.find((e) => e.type === "tool_call") as unknown as Record<string, unknown>;
      // tool_call uses startedAt/endedAt, NOT ts
      expect(toolCall.ts).toBeUndefined();
      expect(toolCall.startedAt).toBe(100);
    });

    it("persists sessionId via runsRepo when driver reports one", async () => {
      const fake = createFakeDriver({
        sessionId: "cursor-abc",
        outcome: { status: "succeeded" },
      });
      const adapter = createWorkRunAdapter(fake.driver);

      await adapter.startRun(makeStartReq({ runId: "run-42" }), () => {});

      expect(updateRunMock).toHaveBeenCalledWith("run-42", { sessionId: "cursor-abc" });
    });

    it("does not call updateRun when driver omits sessionId", async () => {
      const fake = createFakeDriver({
        sessionId: null,
        outcome: { status: "succeeded" },
      });
      const adapter = createWorkRunAdapter(fake.driver);

      await adapter.startRun(makeStartReq(), () => {});

      expect(updateRunMock).not.toHaveBeenCalled();
    });

    it("emits a user-prompt artifact carrying request.goal", async () => {
      const fake = createFakeDriver({ outcome: { status: "succeeded" } });
      const adapter = createWorkRunAdapter(fake.driver);
      const events: WorkRunEvent[] = [];

      await adapter.startRun(makeStartReq({ goal: "ship it" }), (e) => {
        events.push(e);
      });

      const userPrompt = events.find(
        (e) => e.type === "artifact" && (e as { kind: string }).kind === "user-prompt",
      ) as { content: string };
      expect(userPrompt).toBeDefined();
      expect(userPrompt.content).toBe("ship it");
    });

    it.each(["start", "continue"])("preserves annotation context on the %s prompt artifact", async (operation) => {
      const fake = createFakeDriver({ outcome: { status: "succeeded" } });
      fake.enable("resumeSession");
      const adapter = createWorkRunAdapter(fake.driver);
      const context = [{ kind: "selection" as const, metadata: {
        source: "browser", id: "annotation", url: "https://mains.dev", comment: "Review this",
        elements: [{ tagName: "section", selector: "#intro", text: "Introduction" }],
      } }];
      const events: WorkRunEvent[] = [];
      const onEvent = (event: WorkRunEvent) => { events.push(event); };
      if (operation === "start") await adapter.startRun(makeStartReq({ context }), onEvent);
      else await adapter.continueRun!(makeContinueReq({ context }), onEvent);
      const prompt = events.find((event) => event.type === "artifact" && event.kind === "user-prompt");
      expect(prompt?.type === "artifact" && prompt.metadata?.browserAnnotations).toEqual([{
        id: "annotation", url: "https://mains.dev", comment: "Review this",
        elements: [{ tagName: "section", selector: "#intro", text: "Introduction" }],
      }]);
    });

    it("adds the provider-resolved model to the user-prompt artifact", async () => {
      const fake = createFakeDriver({
        model: "gpt-5.6-terra",
        outcome: { status: "succeeded" },
      });
      const adapter = createWorkRunAdapter(fake.driver);
      const events: WorkRunEvent[] = [];

      await adapter.startRun(
        makeStartReq({ model: "gpt-5.6-sol" }),
        (event) => {
          events.push(event);
        },
      );

      const userPrompt = events.find(
        (event) => event.type === "artifact" && event.kind === "user-prompt",
      ) as Extract<WorkRunEvent, { type: "artifact" }> | undefined;
      expect(userPrompt?.metadata?.model).toBe("gpt-5.6-terra");
    });

    it("does not treat a requested model alias as a resolved model", async () => {
      const fake = createFakeDriver({ outcome: { status: "succeeded" } });
      const adapter = createWorkRunAdapter(fake.driver);
      const events: WorkRunEvent[] = [];

      await adapter.startRun(makeStartReq({ model: "sonnet" }), (event) => {
        events.push(event);
      });

      const userPrompt = events.find(
        (event) => event.type === "artifact" && event.kind === "user-prompt",
      ) as Extract<WorkRunEvent, { type: "artifact" }> | undefined;
      expect(userPrompt?.metadata).not.toHaveProperty("model");
    });

    it("translates a Driver-thrown error into status=failed", async () => {
      const fake = createFakeDriver({
        throws: new Error("SDK connection lost"),
      });
      const adapter = createWorkRunAdapter(fake.driver);
      const events: WorkRunEvent[] = [];

      const result = await adapter.startRun(makeStartReq(), (e) => {
        events.push(e);
      });

      expect(result.status).toBe("failed");
      expect(result.summary).toBe("SDK connection lost");
      const final = events.filter((e) => e.type === "status").at(-1) as {
        status: string;
        error?: string;
      };
      expect(final.status).toBe("failed");
      expect(final.error).toBe("SDK connection lost");
    });

    it("calls driver.cleanup and cancelPendingRequests in finally", async () => {
      const fake = createFakeDriver({ outcome: { status: "succeeded" } });
      const adapter = createWorkRunAdapter(fake.driver);

      await adapter.startRun(makeStartReq({ runId: "run-cleanup" }), () => {});

      expect(fake.calls.cleanup).toHaveLength(1);
      expect(cancelPendingRequestsMock).toHaveBeenCalledWith("run-cleanup");
    });

    it("calls cleanup even when executePrompt throws", async () => {
      const fake = createFakeDriver({ throws: new Error("boom") });
      const adapter = createWorkRunAdapter(fake.driver);

      await adapter.startRun(makeStartReq(), () => {});

      // cleanup runs because session was acquired before executePrompt threw
      expect(fake.calls.cleanup).toHaveLength(1);
    });
  });

  describe("abortRun", () => {
    it("fires the AbortSignal Driver received in executePrompt", async () => {
      const fake = createFakeDriver({
        awaitAbort: true,
        outcome: { status: "canceled", stopReason: "cancelled" },
      });
      const adapter = createWorkRunAdapter(fake.driver);

      const runPromise = adapter.startRun(makeStartReq({ runId: "run-abort" }), () => {});

      // Yield so executePrompt has registered its abort listener
      await new Promise((r) => setImmediate(r));
      await adapter.abortRun!("run-abort");

      const result = await runPromise;
      expect(result.status).toBe("canceled");
      expect(fake.calls.executePrompt[0].signalAborted).toBe(true);
    });

    it("is a no-op for an unknown runId", async () => {
      const fake = createFakeDriver({ outcome: { status: "succeeded" } });
      const adapter = createWorkRunAdapter(fake.driver);

      // Should not throw
      await expect(adapter.abortRun!("never-existed")).resolves.toBeUndefined();
    });

    // Regression: writing provider config mid-run (approving a plan, any
    // toolbar toggle) invalidates the adapter cache, so the next
    // createWorkAdapter() hands back a fresh instance. Stopping the run has to
    // still reach it — otherwise abortRun resolves silently, the caller falls
    // back to its force-finalize timer, and the driver keeps editing files
    // after the UI says the run stopped.
    it("aborts a run started on a different adapter instance", async () => {
      const fake = createFakeDriver({
        awaitAbort: true,
        outcome: { status: "canceled", stopReason: "cancelled" },
      });
      const owning = createWorkRunAdapter(fake.driver);
      const replacement = createWorkRunAdapter(fake.driver);

      const runPromise = owning.startRun(makeStartReq({ runId: "run-orphan" }), () => {});
      await new Promise((r) => setImmediate(r));

      await replacement.abortRun!("run-orphan");

      const result = await runPromise;
      expect(result.status).toBe("canceled");
      expect(fake.calls.executePrompt[0].signalAborted).toBe(true);
    });

    // The run is unregistered once it settles, so a later stop must not find a
    // stale entry and abort a controller belonging to nothing.
    it("forgets a run once it completes", async () => {
      const fake = createFakeDriver({ outcome: { status: "succeeded" } });
      const adapter = createWorkRunAdapter(fake.driver);

      await adapter.startRun(makeStartReq({ runId: "run-done" }), () => {});

      await expect(adapter.abortRun!("run-done")).resolves.toBeUndefined();
    });
  });

  describe("optional verbs", () => {
    it("publishes queued Codex input after acceptance once with its resolved model and client id", async () => {
      const fake = createFakeDriver({ model: "canonical-model", outcome: { status: "succeeded" } });
      fake.enable("resumeSession");
      fake.driver.steerRun = vi.fn().mockResolvedValue({ turnId: "native-turn" });
      const accepted = vi.fn();
      const events: WorkRunEvent[] = [];
      const execute = fake.driver.executePrompt;
      fake.driver.executePrompt = async (...args) => {
        expect(events.filter((event) => event.type === "artifact" && event.kind === "user-prompt")).toHaveLength(0);
        const request = fake.calls.resumeSession[0];
        await Promise.all([request.onInputAccepted!("native-turn"), request.onInputAccepted!("native-turn")]);
        expect(accepted).toHaveBeenCalledOnce();
        return execute(...args);
      };
      const adapter = createWorkRunAdapter(fake.driver);
      const asyncQuestionReply = { artifactId: 12, answers: ["Staging"] };
      await adapter.continueRun!(makeContinueReq({ clientUserMessageId: "queued-input", onInputAccepted: accepted, asyncQuestionReply }), (event) => { events.push(event); });
      expect(events.filter((event) => event.type === "artifact" && event.kind === "user-prompt")).toEqual([
        expect.objectContaining({ content: "follow-up", metadata: expect.objectContaining({ model: "canonical-model", clientUserMessageId: "queued-input", providerTurnId: "native-turn", asyncQuestionReply }) }),
      ]);
    });

    it("continueRun is undefined when driver lacks resumeSession", () => {
      const fake = createFakeDriver();
      const adapter = createWorkRunAdapter(fake.driver);
      expect(adapter.continueRun).toBeUndefined();
    });

    it("attaches continueRun when driver provides resumeSession", async () => {
      const fake = createFakeDriver({ outcome: { status: "succeeded" } });
      fake.enable("resumeSession");
      const adapter = createWorkRunAdapter(fake.driver);

      expect(adapter.continueRun).toBeDefined();
      const result = await adapter.continueRun!(makeContinueReq(), () => {});

      expect(result.status).toBe("succeeded");
      expect(fake.calls.resumeSession).toHaveLength(1);
      expect(fake.calls.createSession).toHaveLength(0);
    });

    it("attaches forkRun when driver provides forkSession", async () => {
      const fake = createFakeDriver({ outcome: { status: "succeeded" } });
      fake.enable("forkSession");
      const adapter = createWorkRunAdapter(fake.driver);

      expect(adapter.forkRun).toBeDefined();
      await adapter.forkRun!(makeForkReq(), () => {});

      expect(fake.calls.forkSession).toHaveLength(1);
    });

    it("attaches reviewRun when driver provides reviewSession (no user-prompt artifact)", async () => {
      const fake = createFakeDriver({ outcome: { status: "succeeded" } });
      fake.enable("reviewSession");
      const adapter = createWorkRunAdapter(fake.driver);
      const events: WorkRunEvent[] = [];

      expect(adapter.reviewRun).toBeDefined();
      await adapter.reviewRun!(makeReviewReq(), (e) => {
        events.push(e);
      });

      expect(fake.calls.reviewSession).toHaveLength(1);
      // Review verb skips the user-prompt artifact emission
      const userPrompt = events.find(
        (e) => e.type === "artifact" && (e as { kind: string }).kind === "user-prompt",
      );
      expect(userPrompt).toBeUndefined();
    });
  });

  describe("shared shutdown capability", () => {
    it("attaches shutdown when driver provides it", async () => {
      const fake = createFakeDriver();
      fake.enable("shutdown");
      const adapter = createWorkRunAdapter(fake.driver);

      expect(adapter.shutdown).toBeDefined();
      await adapter.shutdown!();
      expect(fake.calls.shutdown).toBe(1);
    });

    it("supports shared shutdown without a driver-specific hook", async () => {
      const fake = createFakeDriver();
      const adapter = createWorkRunAdapter(fake.driver);
      await adapter.shutdown!();
      expect(fake.calls.shutdown).toBe(0);
    });
  });
});
