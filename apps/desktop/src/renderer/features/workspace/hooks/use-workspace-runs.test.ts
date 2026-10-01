// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Run } from "../types";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  getByWorkspace: vi.fn(),
  getById: vi.fn(),
  getArtifacts: vi.fn(),
  getToolCalls: vi.fn(),
  getTurns: vi.fn(),
}));

vi.mock("@/lib/transport", () => ({
  appApi: {
    runs: {
      getByWorkspace: mocks.getByWorkspace,
      getById: mocks.getById,
      getToolCalls: mocks.getToolCalls,
    },
    runArtifacts: { getByRun: mocks.getArtifacts },
    runTurns: { getByRun: mocks.getTurns },
  },
}));
vi.mock("@/lib/redux/hooks", () => ({
  useAppDispatch: () => mocks.dispatch,
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({ workspace: { pendingRunId: null } }),
}));
vi.mock("@/lib/redux/api", () => ({
  workspaceApi: { util: { invalidateTags: vi.fn() } },
  useArchiveRunMutation: () => [vi.fn()],
}));
vi.mock("@/components/ui", () => ({ toast: { error: vi.fn() } }));
vi.mock("./use-run-operations", () => ({
  useRunOperations: () => ({
    isLoading: false,
    error: null,
    executeRun: vi.fn(),
    continueRun: vi.fn(),
    forkRun: vi.fn(),
    executeReview: vi.fn(),
    checkCanResume: vi.fn(),
  }),
}));
vi.mock("./use-run-sync", () => ({
  useRunSync: () => ({ finalizeRun: vi.fn() }),
}));
vi.mock("./use-streaming-events", () => ({
  useStreamingEvents: () => ({ streamingEvents: [], clearAllStreams: vi.fn() }),
}));

import { useWorkspaceRuns } from "./use-workspace-runs";

const runA: Run = {
  id: "run-a",
  workspaceId: "ws-a",
  status: "succeeded",
  goal: "first conversation",
  providerId: "codex",
  mode: "developer",
};
const runB: Run = {
  id: "run-b",
  workspaceId: "ws-b",
  status: "succeeded",
  goal: "existing conversation",
  providerId: "codex",
  mode: "developer",
};
const prefetchWorkspaceIds = ["ws-a", "ws-b"];

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getArtifacts.mockImplementation(async (runId: string) => ({
    success: true,
    data: [{
      id: 1,
      runId,
      kind: "user-prompt",
      content: runId === runB.id ? runB.goal : runA.goal,
      createdAt: new Date("2026-09-26T20:00:00Z"),
    }],
  }));
  mocks.getToolCalls.mockResolvedValue({ success: true, data: [] });
  mocks.getTurns.mockResolvedValue({ success: true, data: [] });
});

describe("useWorkspaceRuns workspace switches", () => {
  it("ignores a selected run fetch that finishes after leaving its workspace", async () => {
    const external = { ...runA, id: "external-run" };
    let resolveRun!: (value: { success: true; data: Run }) => void;
    mocks.getByWorkspace.mockImplementation(async (workspaceId: string) => ({
      success: true, data: workspaceId === "ws-a" ? [runA] : [runB],
    }));
    mocks.getById.mockImplementation(() => new Promise((resolve) => { resolveRun = resolve; }));
    const view = renderHook(
      ({ workspaceId }) => useWorkspaceRuns(workspaceId, "codex", "developer"),
      { initialProps: { workspaceId: "ws-a" } },
    );
    await waitFor(() => expect(view.result.current.runsLoaded).toBe(true));
    act(() => view.result.current.selectTab(external.id));
    view.rerender({ workspaceId: "ws-b" });
    await waitFor(() => expect(view.result.current.runs.map((run) => run.id)).toEqual([runB.id]));
    await act(async () => resolveRun({ success: true, data: external }));
    expect(view.result.current.runs.map((run) => run.id)).toEqual([runB.id]);
  });

  it("adds an externally created run once when both tab selection paths request it", async () => {
    const external = { ...runA, id: "external-run" };
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [runA] });
    mocks.getById.mockResolvedValue({ success: true, data: external });
    const view = renderHook(() => useWorkspaceRuns("ws-a", "codex", "developer"));
    await waitFor(() => expect(view.result.current.runsLoaded).toBe(true));
    await act(async () => {
      view.result.current.selectTab(external.id);
      view.result.current.selectTab(external.id);
    });
    expect(view.result.current.runs.map((run) => run.id)).toEqual([external.id, runA.id]);
  });

  it("loads a preloaded workspace's selected run transcript", async () => {
    let resolvePrefetchB!: (value: { success: true; data: Run[] }) => void;
    let resolveReloadB!: (value: { success: true; data: Run[] }) => void;
    let bCalls = 0;
    mocks.getByWorkspace.mockImplementation((workspaceId: string) => {
      if (workspaceId === "ws-a") {
        return Promise.resolve({ success: true, data: [runA] });
      }
      bCalls += 1;
      return new Promise((resolve) => {
        if (bCalls === 1) resolvePrefetchB = resolve;
        else resolveReloadB = resolve;
      });
    });

    const view = renderHook(
      ({ workspaceId }) => useWorkspaceRuns(
        workspaceId,
        "codex",
        "developer",
        undefined,
        prefetchWorkspaceIds,
      ),
      { initialProps: { workspaceId: "ws-a" } },
    );
    await waitFor(() => expect(resolvePrefetchB).toBeDefined());
    await act(async () => {
      resolvePrefetchB({ success: true, data: [runB] });
    });

    view.rerender({ workspaceId: "ws-b" });
    expect(view.result.current.runs.map((run) => run.id)).toEqual([runB.id]);
    expect(view.result.current.activeRunId).toBe(runB.id);
    await waitFor(() => expect(resolveReloadB).toBeDefined());
    await act(async () => {
      resolveReloadB({ success: true, data: [runB] });
    });

    await waitFor(() => {
      expect(view.result.current.runsLoaded).toBe(true);
      expect(view.result.current.isTranscriptLoading).toBe(false);
      expect(view.result.current.currentEvents[0]?.content).toBe(runB.goal);
    });
  });
});
