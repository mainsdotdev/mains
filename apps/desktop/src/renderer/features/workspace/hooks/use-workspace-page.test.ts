// @vitest-environment jsdom

import { configureStore } from "@reduxjs/toolkit";
import { renderHook, waitFor } from "@testing-library/react";
import { Provider, useDispatch, useSelector } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ComponentProps, type ReactNode } from "react";
import workspaceReducer, {
  activateWorkspaceView,
  setActiveTab,
} from "@/lib/redux/slices/workspaceSlice";
import { workspaceViewKey } from "../lib/ui-context";

const mocks = vi.hoisted(() => ({
  getById: vi.fn(),
  getArtifacts: vi.fn(),
  getToolCalls: vi.fn(),
  getTurns: vi.fn(),
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
      getToolCalls: mocks.getToolCalls,
    },
    runArtifacts: { getByRun: mocks.getArtifacts },
    runTurns: { getByRun: mocks.getTurns },
  },
}));
vi.mock("@/lib/redux/api", () => ({
  workspaceApi: { util: { invalidateTags: vi.fn() } },
  useArchiveRunMutation: () => [vi.fn()],
}));
vi.mock("@/components/ui", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/hooks/use-active-space", () => ({
  useActiveSpace: () => ({ activeSpaceId: "claude-space" }),
}));
vi.mock("@/hooks/use-mode-config", () => ({
  useModeConfig: () => ({ mode: "work", showTabs: false }),
}));
vi.mock("./use-workspace-data", () => ({
  useWorkspaceData: () => ({
    workspaceId: undefined,
    selectedWorkspace: "",
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
vi.mock("./use-tab-handlers", () => ({ useTabHandlers: () => ({}) }));
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
  for (const mock of Object.values(mocks)) mock.mockReset();
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
