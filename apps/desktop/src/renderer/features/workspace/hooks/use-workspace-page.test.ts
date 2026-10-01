// @vitest-environment jsdom

import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook, waitFor } from "@testing-library/react";
import { Provider, useDispatch, useSelector } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ComponentProps, type ReactNode } from "react";
import workspaceReducer, {
  activateWorkspaceView,
  setActiveTab,
  openNewRunTab,
} from "@/lib/redux/slices/workspaceSlice";
import { workspaceViewKey } from "../lib/ui-context";

const mocks = vi.hoisted(() => ({
  getById: vi.fn(),
  getArtifacts: vi.fn(),
  getToolCalls: vi.fn(),
  getTurns: vi.fn(),
  getByWorkspace: vi.fn(),
  executeRun: vi.fn(),
  continueRun: vi.fn(),
  checkCanResume: vi.fn(),
  mode: "work",
  workspaceId: undefined as string | undefined,
}));

vi.mock("@/lib/redux/hooks", () => ({
  useAppDispatch: useDispatch,
  useAppSelector: useSelector,
}));
vi.mock("@/lib/transport", () => ({
  appApi: {
    account: { get: () => Promise.resolve({ success: true, data: { id: "account-1" } }) },
    runs: {
      getById: mocks.getById,
      getByWorkspace: mocks.getByWorkspace,
      getToolCalls: mocks.getToolCalls,
    },
    runArtifacts: { getByRun: mocks.getArtifacts },
    runTurns: { getByRun: mocks.getTurns },
  },
}));
vi.mock("@/lib/redux/api", () => ({
  workspaceApi: { util: { invalidateTags: () => ({ type: "test/invalidateWorkspaces" }) } },
  useArchiveRunMutation: () => [vi.fn()],
  useUpdateRunMutation: () => [vi.fn()],
}));
vi.mock("@/components/ui", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/hooks/use-active-space", () => ({
  useActiveSpace: () => ({ activeSpaceId: "claude-space" }),
}));
vi.mock("@/hooks/use-mode-config", () => ({
  useModeConfig: () => ({ mode: mocks.mode, showTabs: mocks.mode === "developer" }),
}));
vi.mock("./use-workspace-data", () => ({
  useWorkspaceData: () => ({
    workspaceId: mocks.workspaceId,
    selectedWorkspace: mocks.workspaceId ?? "",
    currentWorkspace: null,
    workspaces: [],
  }),
}));
vi.mock("./use-composer-context", () => ({
  useComposerContext: () => ({ items: [], clear: vi.fn() }),
}));
vi.mock("./use-transient-uploads", () => ({
  useTransientUploads: () => [[], vi.fn()],
}));
vi.mock("./use-file-content-loader", () => ({ useFileContentLoader: () => {} }));
vi.mock("./use-run-operations", () => ({
  useRunOperations: ({ registerNewRun }: { registerNewRun: (id: string) => Promise<string | null> }) => ({
    isLoading: false,
    error: null,
    executeRun: async (...args: unknown[]) => {
      const id = await mocks.executeRun(...args);
      return id ? registerNewRun(id) : null;
    },
    continueRun: mocks.continueRun,
    forkRun: vi.fn(),
    executeReview: vi.fn(),
    checkCanResume: mocks.checkCanResume,
  }),
}));
vi.mock("./use-run-sync", () => ({
  useRunSync: () => ({ finalizeRun: vi.fn() }),
}));
vi.mock("./use-streaming-events", () => ({
  useStreamingEvents: () => ({ streamingEvents: [], clearAllStreams: vi.fn() }),
}));

import { useWorkspacePage } from "./use-workspace-page";

const claudeView = workspaceViewKey({
  backendId: null,
  spaceId: "claude-space",
  providerId: "claude_code",
  mode: "work",
});
const codexView = workspaceViewKey({
  backendId: null,
  spaceId: "codex-space",
  providerId: "codex",
  mode: "work",
});
const run = {
  id: "show-weather",
  accountId: "account-1",
  workspaceId: null,
  collectionId: null,
  spaceId: "claude-space",
  providerId: "claude_code",
  mode: "work" as const,
  status: "succeeded" as const,
  goal: "show_weather Istanbul havası",
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) if (vi.isMockFunction(mock)) mock.mockReset();
  mocks.mode = "work";
  mocks.workspaceId = undefined;
  mocks.executeRun.mockResolvedValue(null);
  mocks.continueRun.mockResolvedValue(true);
  mocks.checkCanResume.mockResolvedValue(false);
  mocks.getById.mockResolvedValue({ success: true, data: run });
  mocks.getArtifacts.mockResolvedValue({
    success: true,
    data: [{
      id: 1,
      runId: run.id,
      kind: "user-prompt",
      content: run.goal,
      createdAt: new Date("2026-09-27T19:00:00Z"),
    }],
  });
  mocks.getToolCalls.mockResolvedValue({ success: true, data: [] });
  mocks.getTurns.mockResolvedValue({ success: true, data: [] });
});

function workspacePage() {
  const store = configureStore({
    reducer: {
      workspace: workspaceReducer,
      appSettings: () => ({ onboardingCompleted: true }),
      backends: () => ({ activeBackendId: null }),
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    Provider,
    { store } as ComponentProps<typeof Provider>,
    createElement(MemoryRouter, { initialEntries: ["/code/ws-1"] }, children),
  );
  return { store, ...renderHook(() => useWorkspacePage("claude_code"), { wrapper }) };
}

describe("workspace conversations across renderers", () => {
  it("loads the parent's newly selected run in an already mounted floating chat", async () => {
    mocks.mode = "developer";
    mocks.workspaceId = "ws-1";
    const first = { ...run, id: "first", workspaceId: "ws-1", mode: "developer" };
    const second = { ...first, id: "second", goal: "second conversation" };
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [first] });
    mocks.getById.mockImplementation(async (id: string) => ({ success: true, data: id === second.id ? second : first }));
    mocks.getArtifacts.mockImplementation(async (id: string) => ({
      success: true,
      data: [{ id: 1, runId: id, kind: "user-prompt", content: id === second.id ? second.goal : first.goal, createdAt: new Date() }],
    }));
    const child = workspacePage();
    await waitFor(() => expect(child.result.current.activeRun?.id).toBe(first.id));

    // The child window stays mounted while the parent is collapsed and starts
    // another run. Reopening it syncs the tab, but its list still has only first.
    act(() => child.store.dispatch(setActiveTab(second.id)));
    await waitFor(() => {
      expect(child.result.current.activeRun?.id).toBe(second.id);
      expect(child.result.current.composerRun?.id).toBe(second.id);
      expect(child.result.current.currentEvents[0]?.content).toBe(second.goal);
    });
  });

  it.each(["empty", "new-run"])("starts a floating conversation from %s and exposes its tab immediately", async (startAt) => {
    mocks.mode = "developer";
    mocks.workspaceId = "ws-1";
    const created = { ...run, id: "created", workspaceId: "ws-1", mode: "developer", status: "running" };
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [] });
    mocks.getById.mockResolvedValue({ success: true, data: created });
    mocks.executeRun.mockResolvedValue(created.id);
    const page = workspacePage();
    await waitFor(() => expect(page.result.current.showEmptyState).toBe(true));
    act(() => {
      if (startAt === "new-run") page.store.dispatch(openNewRunTab());
      page.result.current.setGoal("Start a conversation");
    });
    let submittedId: string | null | undefined;
    await act(async () => { submittedId = await page.result.current.handleExecute(); });
    expect(submittedId).toBe(created.id);
    expect(page.result.current.activeTab).toBe(created.id);
    expect(page.result.current.runs.map((item) => item.id)).toEqual([created.id]);
    expect(page.result.current.composerRun?.id).toBe(created.id);
  });

  it("waits for a synced conversation before sending and then continues that conversation", async () => {
    mocks.mode = "developer";
    mocks.workspaceId = "ws-1";
    const first = { ...run, id: "first", workspaceId: "ws-1", mode: "developer" };
    const synced = { ...first, id: "synced" };
    let resolveRun!: (value: { success: true; data: typeof synced }) => void;
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [first] });
    mocks.getById.mockImplementation((id: string) => id === synced.id
      ? new Promise((resolve) => { resolveRun = resolve; })
      : Promise.resolve({ success: true, data: first }));
    mocks.checkCanResume.mockResolvedValue(true);
    const page = workspacePage();
    await waitFor(() => expect(page.result.current.activeRun?.id).toBe(first.id));
    act(() => page.store.dispatch(setActiveTab(synced.id)));
    act(() => page.result.current.setGoal("Continue this conversation"));
    await act(async () => { await page.result.current.handleExecute(); });
    expect(mocks.executeRun).not.toHaveBeenCalled();
    expect(mocks.continueRun).not.toHaveBeenCalled();
    await act(async () => resolveRun({ success: true, data: synced }));
    await waitFor(() => expect(page.result.current.canResume).toBe(true));
    await act(async () => { expect(await page.result.current.handleExecute()).toBe(synced.id); });
    expect(mocks.continueRun).toHaveBeenCalledWith(synced.id, "Continue this conversation", "", undefined, [], []);
    expect(mocks.executeRun).not.toHaveBeenCalled();
  });

  it("adds a run started in floating chat to the parent's tabs without a reload", async () => {
    mocks.mode = "developer";
    mocks.workspaceId = "ws-1";
    const first = { ...run, id: "first", workspaceId: "ws-1", mode: "developer" };
    const third = { ...first, id: "floating-run", goal: "floating conversation" };
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [first] });
    mocks.getById.mockImplementation(async (id: string) => ({ success: true, data: id === third.id ? third : first }));
    const parent = workspacePage();
    await waitFor(() => expect(parent.result.current.activeRun?.id).toBe(first.id));

    // The selectRun IPC action reaches the real tab handler in the parent.
    act(() => parent.result.current.handleSelectRunTab(third.id));
    await waitFor(() => {
      expect(parent.result.current.runs.map((item) => item.id)).toEqual([third.id, first.id]);
      expect(parent.result.current.activeRun?.id).toBe(third.id);
    });
  });

  it("shows a new composer on New Run even after selecting a running conversation", async () => {
    mocks.mode = "developer";
    mocks.workspaceId = "ws-1";
    const first = { ...run, id: "first", workspaceId: "ws-1", mode: "developer", status: "running" };
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [first] });
    mocks.getById.mockResolvedValue({ success: true, data: first });
    const page = workspacePage();
    await waitFor(() => expect(page.result.current.composerRun?.id).toBe(first.id));

    act(() => page.store.dispatch(openNewRunTab()));
    expect(page.result.current.activeRunId).toBeNull();
    expect(page.result.current.activeRun).toBeUndefined();
    expect(page.result.current.composerRun).toBeUndefined();
  });
});

describe("useWorkspacePage after a space switch", () => {
  it("loads the selected Work run when returning to its space on /code", async () => {
    const store = configureStore({
      reducer: {
        workspace: workspaceReducer,
        appSettings: () => ({ onboardingCompleted: true }),
        backends: () => ({ activeBackendId: null }),
      },
    });
    store.dispatch(activateWorkspaceView({
      key: claudeView,
      workspaceId: null,
      providerId: "claude_code",
    }));
    store.dispatch(setActiveTab(run.id));
    store.dispatch(activateWorkspaceView({
      key: codexView,
      workspaceId: null,
      providerId: "codex",
    }));
    store.dispatch(activateWorkspaceView({
      key: claudeView,
      workspaceId: null,
      providerId: "claude_code",
    }));

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        Provider,
        { store } as ComponentProps<typeof Provider>,
        createElement(MemoryRouter, { initialEntries: ["/code"] }, children),
      );
    const page = renderHook(() => useWorkspacePage("claude_code"), { wrapper });

    expect(page.result.current.activeTab).toBe(run.id);
    await waitFor(() => {
      expect(page.result.current.showEmptyState).toBe(false);
      expect(page.result.current.activeRun?.id).toBe(run.id);
      expect(page.result.current.currentEvents[0]?.content).toBe(run.goal);
    });
    expect(mocks.getById).toHaveBeenCalledWith(run.id);
  });
});
