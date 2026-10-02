// @vitest-environment jsdom

import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook, waitFor } from "@testing-library/react";
import { Provider, useDispatch, useSelector } from "react-redux";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ComponentProps, type ReactNode } from "react";
import workspaceReducer, {
  activateWorkspaceView,
  setActiveTab,
  openNewRunTab,
  setContextItemsForKey,
  replaceMcpAppContext,
} from "@/lib/redux/slices/workspaceSlice";
import { composerOwnerKey, workspaceViewKey } from "../lib/ui-context";
import type { ContextBrowserItem, ContextMcpAppItem } from "../lib/composer-context";

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  getById: vi.fn(),
  getArtifacts: vi.fn(),
  getToolCalls: vi.fn(),
  getTurns: vi.fn(),
  getByWorkspace: vi.fn(),
  executeRun: vi.fn(),
  continueRun: vi.fn(),
  checkCanResume: vi.fn(),
  appContext: vi.fn(),
  moveUploads: vi.fn(),
  attachAppRun: vi.fn(),
  panel: false,
  mode: "work",
  workspaceId: undefined as string | undefined,
}));

vi.mock("@/lib/redux/hooks", () => ({
  useAppDispatch: useDispatch,
  useAppSelector: useSelector,
}));
vi.mock("@/lib/redux", () => ({ store: { getState: () => mocks.getState() } }));
vi.mock("@/hooks/use-mcp-app-panel", () => ({ useMcpAppPanel: () => mocks.panel
  ? { appContext: mocks.appContext, attachRun: mocks.attachAppRun } : null }));
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
  useComposerContext: () => ({ items: useSelector((state: { workspace: { contextItems: unknown[] } }) => state.workspace.contextItems), clear: vi.fn() }),
}));
vi.mock("./use-transient-uploads", () => ({
  useTransientUploads: () => [[], vi.fn()],
  getTransientUploadsForOwner: () => [],
  moveTransientUploadsToOwner: mocks.moveUploads,
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
  mocks.panel = false;
  mocks.appContext.mockReturnValue([]);
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

function workspacePage(providerId = "claude_code") {
  const store = configureStore({
    reducer: {
      workspace: workspaceReducer,
      appSettings: () => ({ onboardingCompleted: true }),
      backends: () => ({ activeBackendId: null }),
    },
  });
  mocks.getState.mockImplementation(() => store.getState());
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    Provider,
    { store } as ComponentProps<typeof Provider>,
    createElement(MemoryRouter, { initialEntries: ["/code/ws-1"] }, children),
  );
  return { store, ...renderHook(() => ({
    ...useWorkspacePage(providerId),
    pathname: useLocation().pathname,
  }), { wrapper }) };
}

describe("new conversation context", () => {
  it.each(["work", "chat"])("retargets a %s draft to a project without losing its text or context", async (mode) => {
    mocks.mode = mode;
    const page = workspacePage();
    await waitFor(() => expect(page.result.current.showNewRunTab).toBe(true));
    const previousOwner = page.result.current.ownerKey;
    const context = { kind: "skill" as const, name: "trip-planning" };
    act(() => {
      page.result.current.setGoal("Plan a trip");
      page.store.dispatch(setContextItemsForKey({ key: previousOwner, items: [context] }));
    });
    act(() => page.result.current.handleNewConversationContextChange({ collectionId: "trips" }));
    expect(page.result.current.goal).toBe("Plan a trip");
    expect(page.result.current.contextItems).toEqual([context]);
    expect(page.store.getState().workspace.selectedCollectionId).toBe("trips");
    expect(page.result.current.pathname).toBe("/code");
    expect(page.result.current.showNewRunTab).toBe(true);
    expect(mocks.moveUploads).toHaveBeenCalledWith(previousOwner, page.result.current.ownerKey);
    await act(async () => { await page.result.current.handleExecute(); });
    expect(mocks.executeRun.mock.calls[0][6]).toBe("trips");
    act(() => page.result.current.handleNewConversationContextChange({ collectionId: null }));
    expect(page.store.getState().workspace.selectedCollectionId).toBeNull();
    expect(page.result.current.goal).toBe("Plan a trip");
  });

  it("opens a destination workspace's new-run draft instead of its saved run", async () => {
    mocks.mode = "developer";
    mocks.workspaceId = "ws-1";
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [] });
    const page = workspacePage("codex");
    await waitFor(() => expect(page.result.current.showEmptyState).toBe(true));
    const previousOwner = page.result.current.ownerKey;
    const destination = { ...page.result.current.contextParts, workspaceId: "ws-2" };
    act(() => {
      page.result.current.setGoal("Fix the settings panel");
      page.store.dispatch(activateWorkspaceView({ key: workspaceViewKey(destination), workspaceId: "ws-2", providerId: "codex" }));
      page.store.dispatch(setActiveTab("saved-run"));
      page.store.dispatch(activateWorkspaceView({ key: workspaceViewKey(page.result.current.contextParts), workspaceId: "ws-1", providerId: "codex" }));
    });
    mocks.workspaceId = "ws-2";
    act(() => page.result.current.handleNewConversationContextChange({ workspaceId: "ws-2" }));
    expect(page.result.current.pathname).toBe("/code/ws-2");
    expect(page.result.current.showNewRunTab).toBe(true);
    expect(page.result.current.goal).toBe("Fix the settings panel");
    expect(page.result.current.ownerKey).toBe(composerOwnerKey(destination, null));
    expect(mocks.moveUploads).toHaveBeenCalledWith(previousOwner, page.result.current.ownerKey);
    await act(async () => { await page.result.current.handleExecute(); });
    expect(mocks.executeRun.mock.calls[0][1]).toBe("ws-2");
  });
});

describe("browser annotation submission", () => {
  const element = {
    selector: "h1", tagName: "h1", text: "Introduction", styles: {},
    rect: { x: 0, y: 0, width: 100, height: 30 }, pageRect: { x: 0, y: 0, width: 100, height: 30 },
    scroll: { x: 0, y: 0 }, viewport: { width: 1000, height: 800 }, devicePixelRatio: 1,
  };
  const annotation: ContextBrowserItem = {
    ...element, kind: "browser", id: "annotation-1", url: "https://example.com", title: "Docs",
    elements: [element], comment: "Explain this heading", timestamp: "2026-10-02T11:00:00Z", screenshotMimeType: "image/png",
  };

  it("sends an annotation's comment when the main prompt is empty", async () => {
    const page = workspacePage();
    await waitFor(() => expect(page.result.current.showNewRunTab).toBe(true));
    act(() => page.store.dispatch(setContextItemsForKey({ key: page.result.current.ownerKey, items: [annotation] })));
    await act(async () => { await page.result.current.handleExecute(); });
    expect(mocks.executeRun.mock.calls[0][0]).toBe("Explain this heading");
    expect(mocks.executeRun.mock.calls[0][5]).toEqual([annotation]);
  });

  it("keeps an annotation edited while the previous comment is being sent", async () => {
    mocks.mode = "developer"; mocks.workspaceId = "ws-1";
    const existing = { ...run, workspaceId: "ws-1", mode: "developer" };
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [existing] });
    mocks.getById.mockResolvedValue({ success: true, data: existing });
    mocks.checkCanResume.mockResolvedValue(true);
    const page = workspacePage();
    await waitFor(() => expect(page.result.current.canResume).toBe(true));
    const key = page.result.current.ownerKey;
    act(() => page.store.dispatch(setContextItemsForKey({ key, items: [annotation] })));
    let finish!: (success: boolean) => void;
    mocks.continueRun.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    let sending!: Promise<string | null | undefined>;
    act(() => { sending = page.result.current.handleExecute(); });
    await waitFor(() => expect(mocks.continueRun).toHaveBeenCalled());
    const edited = { ...annotation, comment: "Make this heading smaller" };
    act(() => page.store.dispatch(setContextItemsForKey({ key, items: [edited] })));
    await act(async () => { finish(true); await sending; });
    expect(page.result.current.contextItems).toEqual([edited]);
  });
});

describe("workspace additional directory payload", () => {
  it.each([
    ["copilot_cli", false],
    ["cursor", false],
    ["copilot_cli", true],
    ["cursor", true],
  ] as const)("omits directory grants for a new %s prompt (auto=%s)", async (providerId, auto) => {
    mocks.mode = "developer";
    mocks.workspaceId = "ws-1";
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [] });
    const page = workspacePage(providerId);
    await waitFor(() => expect(page.result.current.showEmptyState).toBe(true));

    act(() => {
      page.result.current.setGoal("hi");
      if (auto) page.result.current.setAutoExecute(true);
    });
    if (!auto) await act(async () => { await page.result.current.handleExecute(); });
    await waitFor(() => expect(mocks.executeRun).toHaveBeenCalled());
    expect(mocks.executeRun.mock.calls[0][7]).toBeUndefined();
  });

  it.each([
    ["copilot_cli", false],
    ["cursor", false],
    ["copilot_cli", true],
    ["cursor", true],
  ] as const)("omits directory grants for a %s follow-up (auto=%s)", async (providerId, auto) => {
    mocks.mode = "developer";
    mocks.workspaceId = "ws-1";
    const existing = { ...run, providerId, workspaceId: "ws-1", mode: "developer" };
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [existing] });
    mocks.getById.mockResolvedValue({ success: true, data: existing });
    mocks.checkCanResume.mockResolvedValue(true);
    const page = workspacePage(providerId);
    await waitFor(() => expect(page.result.current.canResume).toBe(true));

    act(() => {
      page.result.current.setGoal("continue");
      if (auto) page.result.current.setAutoExecute(true);
    });
    if (!auto) await act(async () => { await page.result.current.handleExecute(); });
    await waitFor(() => expect(mocks.continueRun).toHaveBeenCalled());
    expect(mocks.continueRun.mock.calls[0][5]).toBeUndefined();
    expect(mocks.executeRun).not.toHaveBeenCalled();
  });

  it.each(["claude_code", "codex"])("keeps directory grants and explicit clearing for %s", async (providerId) => {
    mocks.mode = "developer";
    mocks.workspaceId = "ws-1";
    const existing = {
      ...run,
      providerId,
      workspaceId: "ws-1",
      mode: "developer",
      configSnapshot: { additionalDirectories: ["/tmp/extra-project"] },
    };
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [existing] });
    mocks.getById.mockResolvedValue({ success: true, data: existing });
    mocks.checkCanResume.mockResolvedValue(true);
    const page = workspacePage(providerId);
    await waitFor(() => expect(page.result.current.canResume).toBe(true));

    act(() => page.result.current.setGoal("read the extra folder"));
    await act(async () => { await page.result.current.handleExecute(); });
    expect(mocks.continueRun.mock.calls[0][5]).toEqual(["/tmp/extra-project"]);

    act(() => {
      page.result.current.setAdditionalDirectories([]);
      page.result.current.setGoal("stop using the extra folder");
    });
    await act(async () => { await page.result.current.handleExecute(); });
    expect(mocks.continueRun.mock.calls[1][5]).toEqual([]);
  });
});

describe("workspace conversations across renderers", () => {
  it("sends reviewed app text through the normal run and preserves newer selections and draft edits", async () => {
    mocks.mode = "developer"; mocks.workspaceId = "ws-1"; mocks.panel = true;
    const existing = { ...run, providerId: "codex", workspaceId: "ws-1", mode: "developer" };
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [existing] });
    mocks.getById.mockResolvedValue({ success: true, data: existing });
    mocks.checkCanResume.mockResolvedValue(true);
    const page = workspacePage("codex");
    await waitFor(() => expect(page.result.current.canResume).toBe(true));
    const ownerKey = page.result.current.ownerKey;
    const selected: ContextMcpAppItem = { kind: "mcp-app", id: "selection", sessionId: "document-1", appName: "MagicPath",
      updateId: "before", label: "Canvas selection", hidden: false, block: { type: "text", text: "Canvas A" } };
    const activeApp: ContextMcpAppItem = { ...selected, id: "app", updateId: "app", hidden: true, label: "MagicPath" };
    mocks.appContext.mockReturnValue([activeApp]);
    act(() => { page.store.dispatch(setContextItemsForKey({ key: ownerKey, items: [selected] })); page.result.current.setGoal("My unfinished draft"); });
    let finish!: (value: boolean) => void;
    mocks.continueRun.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    let sending!: Promise<string | null | undefined>;
    act(() => { sending = page.result.current.handleExecute("Edited app prompt"); });
    await waitFor(() => expect(mocks.continueRun).toHaveBeenCalled());
    expect(mocks.continueRun).toHaveBeenCalledWith(existing.id, "Edited app prompt", "", undefined, [selected, activeApp], []);
    const newer = { ...selected, updateId: "after" };
    act(() => { page.store.dispatch(replaceMcpAppContext({ key: ownerKey, sessionId: "document-1", items: [newer] }));
      page.result.current.setGoal("Newer draft edit"); });
    await act(async () => { finish(true); expect(await sending).toBe(existing.id); });
    expect(page.result.current.goal).toBe("Newer draft edit");
    expect(page.result.current.contextItems).toEqual([newer]);
    expect(mocks.attachAppRun).toHaveBeenCalledWith(ownerKey, existing.id, page.result.current.contextParts);
    expect(mocks.executeRun).not.toHaveBeenCalled();
  });

  it("starts an app-requested new chat without moving the previous conversation's draft", async () => {
    mocks.mode = "developer"; mocks.workspaceId = "ws-1";
    const existing = { ...run, workspaceId: "ws-1", mode: "developer" };
    const created = { ...existing, id: "new-app-run" };
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [existing] });
    mocks.getById.mockImplementation(async (id) => ({ success: true, data: id === created.id ? created : existing }));
    mocks.executeRun.mockResolvedValue(created.id);
    const page = workspacePage();
    await waitFor(() => expect(page.result.current.composerRun?.id).toBe(existing.id));
    const previousOwner = page.result.current.ownerKey;
    act(() => page.result.current.setGoal("Unfinished previous message"));
    await act(async () => { expect(await page.result.current.handleExecute("New app chat", { target: "new" })).toBe(created.id); });
    expect(mocks.continueRun).not.toHaveBeenCalled();
    expect(page.store.getState().workspace.draftTextByKey[previousOwner]).toBe("Unfinished previous message");
    expect(page.result.current.goal).toBe("");
    expect(page.result.current.activeRun?.id).toBe(created.id);
  });

  it("does not switch back to an app conversation after the user selects another chat during send", async () => {
    mocks.mode = "developer"; mocks.workspaceId = "ws-1";
    const first = { ...run, id: "first", workspaceId: "ws-1", mode: "developer" };
    const second = { ...first, id: "second" };
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [first, second] });
    mocks.getById.mockImplementation(async (id) => ({ success: true, data: id === second.id ? second : first }));
    mocks.checkCanResume.mockResolvedValue(true);
    const page = workspacePage();
    await waitFor(() => expect(page.result.current.canResume).toBe(true));
    let finish!: (value: boolean) => void;
    mocks.continueRun.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    let sending!: Promise<string | null | undefined>;
    act(() => { sending = page.result.current.handleExecute("Reviewed app message"); });
    await waitFor(() => expect(mocks.continueRun).toHaveBeenCalled());
    act(() => page.result.current.handleSelectRunTab(second.id));
    await waitFor(() => expect(page.result.current.composerRun?.id).toBe(second.id));
    await act(async () => { finish(true); expect(await sending).toBe(first.id); });
    expect(page.result.current.activeTab).toBe(second.id);
    expect(page.result.current.composerRun?.id).toBe(second.id);
  });

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

    mocks.getState.mockImplementation(() => store.getState());
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
