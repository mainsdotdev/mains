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
//   - 1:1 delegation of pass-through methods (shutdown)
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  WorkRunEvent,
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

  describe("startRun lifecycle", () => {
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

  describe("pass-through delegation", () => {
    it("attaches shutdown when driver provides it", async () => {
      const fake = createFakeDriver();
      fake.enable("shutdown");
      const adapter = createWorkRunAdapter(fake.driver);

      expect(adapter.shutdown).toBeDefined();
      await adapter.shutdown!();
      expect(fake.calls.shutdown).toBe(1);
    });

    it("does not attach shutdown when driver lacks it", () => {
      const fake = createFakeDriver();
      const adapter = createWorkRunAdapter(fake.driver);
      expect(adapter.shutdown).toBeUndefined();
    });
  });
});
