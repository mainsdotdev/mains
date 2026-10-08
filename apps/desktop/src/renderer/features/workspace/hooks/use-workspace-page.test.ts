import runQueueReducer from "@/lib/redux/slices/runQueueSlice";
// @vitest-environment jsdom

import { configureStore } from "@reduxjs/toolkit";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { Provider, useDispatch, useSelector } from "react-redux";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ComponentProps, type ReactNode } from "react";
import workspaceReducer, {
  activateWorkspaceView,
  setActiveTab,
  openNewRunTab,
  openReviewTab,
  addContextItem,
  setContextItemsForKey,
  replaceMcpAppContext,
  setPendingReviewTarget,
} from "@/lib/redux/slices/workspaceSlice";
import { composerOwnerKey, workspaceViewKey } from "../lib/ui-context";
import type { ContextBrowserItem, ContextMcpAppItem, ContextReviewItem } from "../lib/composer-context";
import type { UploadedFile } from "@/components/ui";
import appSettingsReducer from "@/lib/redux/slices/appSettingsSlice";
import { DocumentViewerProvider, useDocumentViewer } from "@/hooks/use-document-viewer";

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  writeSettings: vi.fn(),
  getById: vi.fn(),
  getHistory: vi.fn(),
  getArtifacts: vi.fn(),
  getToolCalls: vi.fn(),
  getTurns: vi.fn(),
  getByWorkspace: vi.fn(),
  executeRun: vi.fn(),
  executeReview: vi.fn(),
  createVoiceConversation: vi.fn(),
  continueRun: vi.fn(),
  steer: vi.fn(),
  checkCanResume: vi.fn(),
  appContext: vi.fn(),
  moveUploads: vi.fn(),
  attachAppRun: vi.fn(),
  panel: false,
  mode: "work",
  workspaceId: undefined as string | undefined,
  voiceState: { phase: "idle", runId: null as string | null, connectionId: null, startedAt: null },
  files: [] as UploadedFile[],
  serializeAttachments: vi.fn(),
}));

vi.mock("@/lib/redux/hooks", () => ({
  useAppDispatch: useDispatch,
  useAppSelector: useSelector,
}));
vi.mock("@/lib/redux", () => ({ store: { getState: () => mocks.getState() } }));
vi.mock("@/hooks/use-mcp-app-panel", () => ({ useMcpAppPanel: () => mocks.panel
  ? { appContext: mocks.appContext, attachRun: mocks.attachAppRun } : null }));
vi.mock("@/lib/transport", () => ({
  getTransport: () => ({ invoke: mocks.writeSettings }),
  appEvents: { runs: { onUpdated: () => () => {} } },
  appApi: {
    account: { get: () => Promise.resolve({ success: true, data: { id: "account-1" } }) },
    runs: {
      getById: mocks.getById,
      getByWorkspace: mocks.getByWorkspace,
      getToolCalls: mocks.getToolCalls,
      getHistory: mocks.getHistory,
    },
    runArtifacts: { getByRun: mocks.getArtifacts },
    runTurns: { getByRun: mocks.getTurns },
  },
}));
vi.mock("@/lib/redux/api/providersApi", () => ({
  useGetProviderByIdQuery: () => ({ data: { config: {} } }),
}));
vi.mock("@/lib/redux/api", () => ({
  workspaceApi: { util: { invalidateTags: () => ({ type: "test/invalidateWorkspaces" }) } },
  runsApi: { util: { invalidateTags: () => ({ type: "test/invalidateRuns" }) } },
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
  useTransientUploads: () => [mocks.files, vi.fn()],
  getTransientUploadsForOwner: () => mocks.files,
  moveTransientUploadsToOwner: mocks.moveUploads,
}));
vi.mock("../lib/run-helpers", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/run-helpers")>(), serializeAttachments: mocks.serializeAttachments,
}));
vi.mock("../lib/run-message-queue", () => ({ runMessageQueue: { send: mocks.steer, remove: vi.fn(), resume: vi.fn() } }));
vi.mock("./use-file-content-loader", () => ({ useFileContentLoader: () => {} }));
vi.mock("./use-run-operations", () => ({
  useRunOperations: ({ registerNewRun }: { registerNewRun: (id: string) => Promise<string | null> }) => ({
    isLoading: false,
    error: null,
    createVoiceConversation: async (...args: unknown[]) => {
      const id = await mocks.createVoiceConversation(...args);
      return id ? registerNewRun(id) : null;
    },
    executeRun: async (...args: unknown[]) => {
      const id = await mocks.executeRun(...args);
      return id ? registerNewRun(id) : null;
    },
    continueRun: mocks.continueRun,
    forkRun: vi.fn(),
    executeReview: mocks.executeReview,
    checkCanResume: mocks.checkCanResume,
  }),
}));
vi.mock("./use-run-sync", () => ({
  useRunSync: () => ({ finalizeRun: vi.fn() }),
}));
vi.mock("./use-streaming-events", () => ({
  useStreamingEvents: () => ({ streamingEvents: [], clearTurnStreams: vi.fn() }),
}));
vi.mock("./use-realtime-voice", () => ({ useRealtimeVoice: () => ({ state: mocks.voiceState }) }));

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
  mocks.voiceState = { phase: "idle", runId: null, connectionId: null, startedAt: null };
  mocks.panel = false;
  mocks.files = [];
  mocks.serializeAttachments.mockResolvedValue([]);
  mocks.appContext.mockReturnValue([]);
  mocks.executeRun.mockResolvedValue(null);
  mocks.createVoiceConversation.mockResolvedValue(null);
  mocks.writeSettings.mockResolvedValue({ success: true });
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
  mocks.getHistory.mockImplementation(async ({ runId }: { runId: string }) => ({
    success: true, data: {
      artifacts: (await mocks.getArtifacts(runId)).data, toolCalls: (await mocks.getToolCalls(runId)).data,
      turns: (await mocks.getTurns(runId)).data,
      start: { timestamp: 1, source: "artifact", id: 1 }, end: null, last: { timestamp: 2, source: "artifact", id: 2 },
      hasOlder: false, hasNewer: false,
    },
  }));
});

function workspacePage(providerId = "claude_code") {
  const store = configureStore({
    reducer: {
      workspace: workspaceReducer,
      runQueue: runQueueReducer,
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

describe("document previews across routes", () => {
  it("parks the chat's PDF on leaving and restores it without replacing Atlas's own preview", () => {
    const store = configureStore({
      reducer: {
        workspace: workspaceReducer,
        runQueue: runQueueReducer,
        appSettings: appSettingsReducer,
        backends: () => ({ activeBackendId: null }),
      },
    });
    mocks.getState.mockImplementation(() => store.getState());
    let panel!: ReturnType<typeof useDocumentViewer>;
    let page!: ReturnType<typeof useWorkspacePage>;
    let navigate!: ReturnType<typeof useNavigate>;
    function Workspace() {
      page = useWorkspacePage("claude_code");
      return null;
    }
    function Navigation() {
      panel = useDocumentViewer();
      navigate = useNavigate();
      return createElement(Routes, null,
        createElement(Route, { path: "/code", element: createElement(Workspace) }),
        createElement(Route, { path: "/atlas", element: null }),
      );
    }
    render(createElement(Provider, { store } as ComponentProps<typeof Provider>,
      createElement(MemoryRouter, { initialEntries: ["/code"] },
        createElement(DocumentViewerProvider, null, createElement(Navigation)),
      ),
    ));
    const chatDoc = { path: "/tmp/chat.pdf", fileName: "chat.pdf", docType: "pdf" as const };
    const atlasDoc = { path: "/tmp/atlas.pdf", fileName: "atlas.pdf", docType: "pdf" as const };
    const chatOwner = page.ownerKey;
    act(() => panel.open(chatDoc));
    expect(panel.isOpen).toBe(true);

    act(() => navigate("/atlas"));
    expect(panel.isOpen).toBe(false);
    expect(panel.currentDoc).toBeNull();
    expect(store.getState().appSettings.documentViewerDocByContext[chatOwner]).toEqual(chatDoc);

    act(() => panel.open(atlasDoc));
    expect(panel.currentDoc).toEqual(atlasDoc);
    act(() => navigate("/code"));
    expect(panel.isOpen).toBe(true);
    expect(panel.currentDoc).toEqual(chatDoc);
    act(() => navigate("/atlas"));
    expect(panel.isOpen).toBe(true);
    expect(panel.currentDoc).toEqual(atlasDoc);

    act(() => navigate("/code"));
    act(() => panel.close());
    act(() => navigate("/atlas"));
    expect(panel.currentDoc).toEqual(atlasDoc);
    act(() => panel.close());
    act(() => navigate("/code"));
    act(() => navigate("/atlas"));
    expect(panel.isOpen).toBe(false);
    act(() => panel.open(atlasDoc));
    act(() => navigate("/code"));
    expect(panel.isOpen).toBe(false);
    expect(panel.currentDoc).toBeNull();
  });
});

describe("messages submitted during a run", () => {
  it.each(["running", "queued"] as const)("queues a Codex follow-up with its attachments while the run is %s", async (status) => {
    const active = { ...run, providerId: "codex", spaceId: "codex-space", status };
    mocks.getById.mockResolvedValue({ success: true, data: active });
    mocks.checkCanResume.mockResolvedValue(true);
    const page = workspacePage("codex");
    act(() => page.store.dispatch(setActiveTab(active.id)));
    await waitFor(() => expect(page.result.current.composerRun?.status).toBe(status));
    await waitFor(() => expect(page.result.current.conversationSettingsReady).toBe(true));
    mocks.files = [{ file: new File(["reference"], "reference.png", { type: "image/png" }), type: "image" }];
    act(() => page.result.current.setGoal("Use the reference in the next response"));
    const ownerKey = page.result.current.ownerKey;
    await act(async () => { expect(await page.result.current.handleExecute()).toBe(active.id); });
    const queue = page.store.getState().runQueue.byOwner[ownerKey];
    expect(queue.mode).toBe("queue");
    expect(queue.messages).toHaveLength(1);
    expect(queue.messages[0]).toMatchObject({
      text: "Use the reference in the next response", status: "queued", attachmentNames: ["reference.png"],
    });
    expect(mocks.moveUploads).toHaveBeenCalledWith(ownerKey, queue.messages[0].uploadOwnerKey);
    expect(page.result.current.goal).toBe("");
    expect(page.result.current.composerRun?.status).toBe(status);
    expect(mocks.executeRun).not.toHaveBeenCalled();
    expect(mocks.continueRun).not.toHaveBeenCalled();
    expect(mocks.steer).not.toHaveBeenCalled();
  });
});

describe("submitted prompt feedback", () => {
  it("shows feedback while an unresumable conversation starts a fresh run", async () => {
    const created = { ...run, id: "replacement-run", status: "running" as const };
    mocks.getById.mockImplementation(async (id: string) => ({ success: true, data: id === created.id ? created : run }));
    let finish!: (id: string) => void;
    mocks.executeRun.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const page = workspacePage();
    act(() => page.store.dispatch(setActiveTab(run.id)));
    await waitFor(() => expect(page.result.current.composerRun?.id).toBe(run.id));
    await waitFor(() => expect(page.result.current.conversationSettingsReady).toBe(true));
    act(() => page.result.current.setGoal("Start a fresh session"));
    let sending!: Promise<string | null>;
    act(() => { sending = page.result.current.handleExecute(); });
    expect(page.result.current.currentEvents.some((event) => event.content === "Start a fresh session")).toBe(true);
    await waitFor(() => expect(mocks.executeRun).toHaveBeenCalled());
    await act(async () => { finish(created.id); await sending; });
    expect(page.result.current.activeTab).toBe(created.id);
    expect(page.result.current.currentEvents.filter((event) => event.content === "Start a fresh session")).toHaveLength(1);
  });

  it("shows file attachments before serialization completes and preserves them when serialization fails", async () => {
    const file = { file: new File(["hi"], "note.txt", { type: "text/plain" }), type: "document" as const };
    mocks.files = [file];
    let fail!: (error: Error) => void;
    mocks.serializeAttachments.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
    const page = workspacePage();
    await waitFor(() => expect(page.result.current.showNewRunTab).toBe(true));
    act(() => page.result.current.setGoal("Read my attachment"));
    let sending!: Promise<string | null>;
    act(() => { sending = page.result.current.handleExecute(); });
    expect(page.result.current.currentEvents[0].metadata?.attachments).toEqual([expect.objectContaining({ name: "note.txt" })]);
    expect(mocks.executeRun).not.toHaveBeenCalled();
    await act(async () => { fail(new Error("Could not read attachment")); await expect(sending).rejects.toThrow("Could not read attachment"); });
    expect(page.result.current.goal).toBe("Read my attachment");
    expect(page.result.current.uploadedFiles).toEqual([file]);
    expect(page.result.current.isSubmitting).toBe(false);
    // The send guard is released after preparation errors, so retry is possible.
    mocks.serializeAttachments.mockResolvedValue([]);
    await act(async () => { await page.result.current.handleExecute(); });
    expect(mocks.executeRun).toHaveBeenCalledOnce();
  });

  it("keeps the submitted text with a failure when the session cannot prepare a persisted prompt", async () => {
    const created = { ...run, id: "failed-session", status: "failed" as const, lastError: "Session unavailable" };
    mocks.getById.mockResolvedValue({ success: true, data: created });
    mocks.getArtifacts.mockResolvedValue({ success: true, data: [] });
    mocks.executeRun.mockResolvedValue(created.id);
    const page = workspacePage();
    await waitFor(() => expect(page.result.current.showNewRunTab).toBe(true));
    act(() => page.result.current.setGoal("Do not lose my input"));
    await act(async () => { await page.result.current.handleExecute(); });
    expect(page.result.current.currentEvents).toEqual([expect.objectContaining({ content: "Do not lose my input", metadata: expect.objectContaining({ sendError: "Session unavailable" }) })]);
    expect(page.result.current.isSubmitting).toBe(false);
  });

  it("shows a new prompt while execution is pending, then replaces it with its persisted identity", async () => {
    const created = { ...run, id: "created-prompt", status: "running" as const, goal: "Hello immediately" };
    mocks.getArtifacts.mockResolvedValue({ success: true, data: [] });
    mocks.getById.mockResolvedValue({ success: true, data: created });
    let finish!: (id: string) => void;
    mocks.executeRun.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const page = workspacePage();
    await waitFor(() => expect(page.result.current.showNewRunTab).toBe(true));
    act(() => page.result.current.setGoal(created.goal));
    let sending!: Promise<string | null>;
    act(() => { sending = page.result.current.handleExecute(); });
    expect(page.result.current.currentEvents).toEqual([expect.objectContaining({ content: created.goal, metadata: expect.objectContaining({ kind: "user-prompt", clientPromptId: expect.any(String) }) })]);
    expect(page.result.current.showEmptyState).toBe(false);
    expect(page.result.current.isSubmitting).toBe(true);
    await waitFor(() => expect(mocks.executeRun).toHaveBeenCalled());
    const clientPromptId = page.result.current.currentEvents[0].metadata!.clientPromptId;
    await act(async () => { finish(created.id); await sending; });
    expect(mocks.getHistory).toHaveBeenCalledWith(expect.objectContaining({ runId: created.id }));
    expect(page.result.current.currentEvents.filter((event) => event.content === created.goal)).toHaveLength(1);
    mocks.getArtifacts.mockResolvedValue({ success: true, data: [{ id: 41, runId: created.id, kind: "user-prompt", content: created.goal, metadata: { clientPromptId }, createdAt: new Date() }] });
    await act(async () => { await page.result.current.history.loadLatest(); });
    expect(page.result.current.currentEvents.filter((event) => event.content === created.goal)).toHaveLength(1);
    expect(page.result.current.currentEvents[0].id).not.toMatch(/^pending-prompt:/);
  });

  it("shows a continuation before the API resolves without matching an older identical prompt", async () => {
    mocks.getById.mockResolvedValue({ success: true, data: run });
    mocks.checkCanResume.mockResolvedValue(true);
    let finish!: (success: boolean) => void;
    mocks.continueRun.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const page = workspacePage();
    act(() => page.store.dispatch(setActiveTab(run.id)));
    await waitFor(() => expect(page.result.current.canResume).toBe(true));
    await waitFor(() => expect(page.result.current.currentEvents).toHaveLength(1));
    act(() => page.result.current.setGoal(run.goal));
    let sending!: Promise<string | null>;
    act(() => { sending = page.result.current.handleExecute(); });
    expect(page.result.current.currentEvents.filter((event) => event.content === run.goal)).toHaveLength(2);
    await waitFor(() => expect(mocks.continueRun).toHaveBeenCalled());
    await act(async () => { finish(true); await sending; });
    expect(page.result.current.currentEvents.filter((event) => event.content === run.goal)).toHaveLength(2);
  });

  it("preserves the draft after a rejected send and removes the unaccepted projection", async () => {
    let finish!: (id: null) => void;
    mocks.executeRun.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const page = workspacePage();
    await waitFor(() => expect(page.result.current.showNewRunTab).toBe(true));
    act(() => page.result.current.setGoal("Keep this draft"));
    let sending!: Promise<string | null>;
    act(() => { sending = page.result.current.handleExecute(); });
    expect(page.result.current.currentEvents).toHaveLength(1);
    await waitFor(() => expect(mocks.executeRun).toHaveBeenCalled());
    await act(async () => { finish(null); await sending; });
    expect(page.result.current.goal).toBe("Keep this draft");
    expect(page.result.current.currentEvents).toHaveLength(0);
    expect(page.result.current.showNewRunTab).toBe(true);
  });

  it("keeps an unpersisted continuation out of older history and restores it when returning to latest", async () => {
    mocks.getById.mockResolvedValue({ success: true, data: run });
    mocks.checkCanResume.mockResolvedValue(true);
    const page = workspacePage();
    act(() => page.store.dispatch(setActiveTab(run.id)));
    await waitFor(() => expect(page.result.current.canResume).toBe(true));
    act(() => page.result.current.setGoal("Latest pending input"));
    await act(async () => { await page.result.current.handleExecute(); });
    expect(page.result.current.currentEvents.some((event) => event.content === "Latest pending input")).toBe(true);
    mocks.getHistory.mockResolvedValueOnce({ success: true, data: {
      artifacts: [{ id: 1, runId: run.id, kind: "user-prompt", content: "Older input", createdAt: new Date(1000) }],
      toolCalls: [], turns: [], start: { timestamp: 1000, source: "artifact", id: 1 },
      end: { timestamp: 2000, source: "artifact", id: 2 }, last: { timestamp: 3000, source: "artifact", id: 3 },
      hasOlder: false, hasNewer: true,
    } });
    await act(async () => { await page.result.current.history.loadOlder(); });
    expect(page.result.current.history.historical).toBe(true);
    expect(page.result.current.currentEvents.map((event) => event.content)).toEqual(["Older input"]);
    await act(async () => { await page.result.current.history.loadLatest(); });
    expect(page.result.current.currentEvents.some((event) => event.content === "Latest pending input")).toBe(true);
  });
});

describe("new conversation context", () => {
  it.each(["manual", "auto", "voice", "review"])("remembers controls after a successful %s start and resets new-run Plan/Goal", async (startVia) => {
    mocks.mode = "developer";
    mocks.workspaceId = "ws-1";
    const settings = { model: "chosen-model", config: {
      modelReasoningEffort: "ultra", thinkingMode: true, sandboxMode: "danger-full-access",
      serviceTier: "fast", goalMode: true, planMode: false,
    } };
    const created = { ...run, id: "remembered-run", providerId: "codex", workspaceId: "ws-1", mode: "developer", configSnapshot: { conversationSettings: settings } };
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [] });
    mocks.getById.mockResolvedValue({ success: true, data: created });
    mocks.executeRun.mockResolvedValue(created.id);
    mocks.createVoiceConversation.mockResolvedValue(created.id);
    mocks.executeReview.mockResolvedValue(created.id);
    const page = workspacePage("codex");
    await waitFor(() => expect(page.result.current.showEmptyState).toBe(true));
    await act(async () => { await page.result.current.setConversationSettings(settings); });
    expect(page.store.getState().workspace.lastRunSettingsByProvider).toEqual({});
    if (startVia === "voice") {
      await act(async () => { await page.result.current.handleCreateVoiceConversation(); });
    } else if (startVia === "review") {
      act(() => page.store.dispatch(setPendingReviewTarget({ type: "uncommittedChanges" })));
      await waitFor(() => expect(page.result.current.activeTab).toBe(created.id));
    } else {
      act(() => { page.result.current.setGoal("Use these settings"); if (startVia === "auto") page.result.current.setAutoExecute(true); });
      if (startVia === "manual") await act(async () => { await page.result.current.handleExecute(); });
      await waitFor(() => expect(page.result.current.activeTab).toBe(created.id));
    }
    expect(page.store.getState().workspace.lastRunSettingsByProvider['["local","codex"]']).toMatchObject({
      ...settings, config: { ...settings.config, goalMode: false, planMode: false },
    });
    act(() => page.store.dispatch(openNewRunTab()));
    expect(page.result.current.conversationSettings).toMatchObject({
      ...settings, config: { ...settings.config, goalMode: false, planMode: false },
    });
    page.unmount();
  });

  it("does not remember selections when a new run fails to start", async () => {
    mocks.mode = "developer";
    mocks.workspaceId = "ws-1";
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [] });
    const page = workspacePage("codex");
    await waitFor(() => expect(page.result.current.showEmptyState).toBe(true));
    await act(async () => {
      await page.result.current.handleModelChange("unsent-model");
      await page.result.current.handleSettingsConfigChange({ serviceTier: "fast", planMode: true });
    });
    act(() => page.result.current.setGoal("Fail this start"));
    await act(async () => { expect(await page.result.current.handleExecute()).toBeNull(); });
    expect(page.store.getState().workspace.lastRunSettingsByProvider).toEqual({});
    page.unmount();
  });

  it.each(["empty", "new-run"])("prepares fresh voice from %s and preserves the unsent draft in the new conversation", async (startAt) => {
    mocks.mode = "developer";
    mocks.workspaceId = "ws-1";
    const created = { ...run, id: "voice-created", providerId: "codex", workspaceId: "ws-1", mode: "developer", goal: null };
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [] });
    mocks.getById.mockResolvedValue({ success: true, data: created });
    mocks.createVoiceConversation.mockResolvedValue(created.id);
    const page = workspacePage("codex");
    await waitFor(() => expect(page.result.current.showEmptyState).toBe(true));
    act(() => {
      if (startAt === "new-run") page.store.dispatch(openNewRunTab());
      page.result.current.setGoal("Unsent written draft");
      page.result.current.handleSettingsConfigChange({ modelReasoningEffort: "ultra" });
    });
    const previousOwner = page.result.current.ownerKey;
    await act(async () => {
      expect(await page.result.current.handleCreateVoiceConversation()).toBe(created.id);
    });
    expect(mocks.createVoiceConversation).toHaveBeenCalledWith("ws-1", null, [], expect.objectContaining({ config: expect.objectContaining({ modelReasoningEffort: "ultra" }) }));
    expect(mocks.executeRun).not.toHaveBeenCalled();
    expect(mocks.continueRun).not.toHaveBeenCalled();
    expect(page.result.current.activeTab).toBe(created.id);
    expect(page.result.current.composerRun?.id).toBe(created.id);
    expect(page.result.current.goal).toBe("Unsent written draft");
    expect(mocks.moveUploads).toHaveBeenCalledWith(previousOwner, page.result.current.ownerKey);
    expect(page.store.getState().workspace.draftTextByKey[previousOwner] ?? "").toBe("");
  });

  it("continues the thread created by voice even when its idle run status never changes", async () => {
    mocks.mode = "developer";
    mocks.workspaceId = "ws-1";
    const blank = { ...run, id: "blank-voice", providerId: "codex", workspaceId: "ws-1", mode: "developer", goal: null, sessionId: null };
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [blank] });
    mocks.getById.mockResolvedValue({ success: true, data: blank });
    const page = workspacePage("codex");
    await waitFor(() => expect(page.result.current.composerRun?.id).toBe(blank.id));
    await waitFor(() => expect(mocks.checkCanResume).toHaveBeenCalledWith(blank.id));
    expect(page.result.current.canResume).toBe(false);
    // Native voice preparation has now persisted a thread, without a work turn.
    mocks.checkCanResume.mockResolvedValue(true);
    mocks.voiceState = { phase: "connected", runId: blank.id, connectionId: null, startedAt: null };
    page.rerender();
    await waitFor(() => expect(page.result.current.canResume).toBe(true));
    mocks.voiceState = { phase: "idle", runId: null, connectionId: null, startedAt: null };
    page.rerender();
    act(() => page.result.current.setGoal("First written follow-up"));
    await act(async () => { await page.result.current.handleExecute(); });
    expect(mocks.continueRun).toHaveBeenCalledWith(blank.id, "First written follow-up", expect.any(String), undefined, [], [], expect.any(Object), expect.any(String));
    expect(mocks.executeRun).not.toHaveBeenCalled();
  });

  it("does not start voice or retarget the composer after selecting another chat during preparation", async () => {
    mocks.mode = "developer";
    mocks.workspaceId = "ws-1";
    const existing = { ...run, providerId: "codex", workspaceId: "ws-1", mode: "developer" };
    const created = { ...existing, id: "voice-prepared", goal: null };
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [existing] });
    mocks.getById.mockImplementation(async (id) => ({ success: true, data: id === created.id ? created : existing }));
    let finish!: (id: string) => void;
    mocks.createVoiceConversation.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const page = workspacePage("codex");
    await waitFor(() => expect(page.result.current.composerRun?.id).toBe(existing.id));
    act(() => page.store.dispatch(openNewRunTab()));
    let creating!: Promise<string | null>;
    act(() => { creating = page.result.current.handleCreateVoiceConversation(); });
    await waitFor(() => expect(mocks.createVoiceConversation).toHaveBeenCalledOnce());
    await act(async () => { expect(await page.result.current.handleCreateVoiceConversation()).toBeNull(); });
    act(() => page.result.current.handleSelectRunTab(existing.id));
    await act(async () => { finish(created.id); expect(await creating).toBeNull(); });
    expect(page.result.current.activeTab).toBe(existing.id);
    expect(page.result.current.composerRun?.id).toBe(existing.id);
    expect(mocks.createVoiceConversation).toHaveBeenCalledOnce();
  });

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
  it.each(["goalMode", "planMode"] as const)("starts an app-requested new chat with %s off and preserves the previous chat's settings", async (toggle) => {
    mocks.mode = "developer"; mocks.workspaceId = "ws-1";
    const settings = { model: "chosen-model", config: {
      sandboxMode: "workspace-write", modelReasoningEffort: "", thinkingMode: false, serviceTier: "fast",
      goalMode: toggle === "goalMode", planMode: toggle === "planMode",
    } };
    const existing = { ...run, providerId: "codex", workspaceId: "ws-1", mode: "developer", configSnapshot: { conversationSettings: settings } };
    const created = { ...existing, id: "new-app-run" };
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [existing] });
    mocks.getById.mockImplementation(async (id) => ({ success: true, data: id === created.id ? created : existing }));
    mocks.executeRun.mockResolvedValue(created.id);
    const page = workspacePage("codex");
    await waitFor(() => expect(page.result.current.composerRun?.id).toBe(existing.id));
    await waitFor(() => expect(page.result.current.conversationSettingsReady).toBe(true));
    const previousOwner = page.result.current.ownerKey;
    await act(async () => { expect(await page.result.current.handleExecute("New app chat", { target: "new" })).toBe(created.id); });
    const expected = { ...settings, config: { ...settings.config, goalMode: false, planMode: false } };
    expect(mocks.executeRun.mock.calls[0][8]).toEqual(expected);
    expect(page.result.current.conversationSettings).toEqual(expected);
    expect(page.store.getState().workspace.conversationSettingsByKey[previousOwner]).toEqual(settings);
    page.unmount();
  });

  it("keeps a newer tab's permission and model after an older continuation finishes", async () => {
    mocks.mode = "developer"; mocks.workspaceId = "ws-1";
    const settingsA = { model: "model-a", config: { sandboxMode: "danger-full-access", modelReasoningEffort: "high" } };
    const settingsB = { model: "model-b", config: { sandboxMode: "read-only", modelReasoningEffort: "low" } };
    const a = { ...run, id: "pending-a", providerId: "codex", workspaceId: "ws-1", mode: "developer", configSnapshot: { conversationSettings: settingsA } };
    const b = { ...a, id: "newer-b", configSnapshot: { conversationSettings: settingsB } };
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [a, b] });
    mocks.getById.mockImplementation(async (id) => ({ success: true, data: id === b.id ? b : a }));
    mocks.checkCanResume.mockResolvedValue(true);
    let finish!: (success: boolean) => void;
    mocks.continueRun.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const page = workspacePage("codex");
    await waitFor(() => expect(page.result.current.composerRun?.id).toBe(a.id));
    await waitFor(() => expect(page.result.current.canResume).toBe(true));
    let sending!: Promise<string | null>;
    act(() => { sending = page.result.current.handleExecute("Continue A"); });
    await waitFor(() => expect(mocks.continueRun).toHaveBeenCalled());
    act(() => page.store.dispatch(setActiveTab(b.id)));
    await waitFor(() => expect(page.result.current.composerRun?.id).toBe(b.id));
    await act(async () => { await page.result.current.handleSettingsConfigChange({ serviceTier: "fast" }); });
    await act(async () => { finish(true); await sending; });
    expect(page.store.getState().workspace.lastRunSettingsByProvider['["local","codex"]'])
      .toMatchObject({ model: "model-b", config: { sandboxMode: "read-only", serviceTier: "fast" } });
    act(() => page.store.dispatch(openNewRunTab()));
    expect(page.result.current.conversationSettings)
      .toMatchObject({ model: "model-b", config: { sandboxMode: "read-only", serviceTier: "fast" } });
    page.unmount();
  });

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
    expect(mocks.continueRun).toHaveBeenCalledWith(existing.id, "Edited app prompt", "", undefined, [selected, activeApp], [], page.result.current.conversationSettings, expect.any(String));
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
    expect(page.result.current.currentEvents.some((event) => event.content === "Reviewed app message")).toBe(true);
    act(() => page.result.current.handleSelectRunTab(second.id));
    await waitFor(() => expect(page.result.current.composerRun?.id).toBe(second.id));
    expect(page.result.current.currentEvents.some((event) => event.content === "Reviewed app message")).toBe(false);
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
    expect(mocks.continueRun).toHaveBeenCalledWith(synced.id, "Continue this conversation", "", undefined, [], [], page.result.current.conversationSettings, expect.any(String));
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
      runQueue: runQueueReducer,
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


describe("Codex running composer", () => {
  it("queues several sends locally and clears the submitted draft", async () => {
    mocks.mode = "developer";
    mocks.workspaceId = "ws-1";
    const live = { ...run, id: "live-codex", providerId: "codex", workspaceId: "ws-1", mode: "developer", status: "running" };
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [live] });
    mocks.getById.mockResolvedValue({ success: true, data: live });
    const page = workspacePage("codex");
    await waitFor(() => expect(page.result.current.composerRun?.id).toBe(live.id));
    act(() => page.result.current.setGoal("first"));
    await act(async () => { await page.result.current.handleExecute(); });
    expect(page.result.current.goal).toBe("");
    act(() => page.result.current.setGoal("second"));
    await act(async () => { await page.result.current.handleExecute(); });
    expect(page.result.current.runQueue?.queue?.mode).toBe("queue");
    expect(page.result.current.runQueue?.queue?.messages.map((message) => message.text)).toEqual(["first", "second"]);
    expect(mocks.continueRun).not.toHaveBeenCalled();
    expect(mocks.executeRun).not.toHaveBeenCalled();
    page.unmount();
  });
});


describe("review conversation", () => {
  const reviewComment: ContextReviewItem = {
    kind: "review", id: "comment-1", workspaceId: "ws-1", filePath: "a.ts", absolutePath: "/repo/a.ts",
    side: "additions", lineNumber: 3, lineText: "newValue", patchId: "patch", comment: "Handle empty input.",
  };
  it("opens review without runs, sends comment-only input, and keeps review selected for the reply", async () => {
    mocks.mode = "developer"; mocks.workspaceId = "ws-1";
    const created = { ...run, id: "review-chat", workspaceId: "ws-1", mode: "developer", status: "running" };
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [] });
    mocks.getById.mockResolvedValue({ success: true, data: created });
    mocks.executeRun.mockResolvedValue(created.id);
    const page = workspacePage();
    await waitFor(() => expect(page.result.current.showEmptyState).toBe(true));
    act(() => { page.store.dispatch(openReviewTab()); page.store.dispatch(addContextItem(reviewComment)); });
    expect(page.result.current.showEmptyState).toBe(false);
    expect(page.result.current.activeTab).toBe("review");
    await act(async () => { expect(await page.result.current.handleExecute()).toBe(created.id); });
    expect(mocks.executeRun.mock.calls[0][0]).toBe("Address the attached review comments.");
    expect(mocks.executeRun.mock.calls[0][5]).toEqual([reviewComment]);
    expect(page.result.current.activeTab).toBe("review");
    expect(page.result.current.composerRun?.id).toBe(created.id);
    expect(page.result.current.activeRunId).toBe(created.id);
    expect(page.result.current.contextItems).toEqual([]);
  });

  it("continues the selected conversation and preserves a comment edited while sending", async () => {
    mocks.mode = "developer"; mocks.workspaceId = "ws-1";
    const existing = { ...run, workspaceId: "ws-1", mode: "developer" };
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [existing] });
    mocks.getById.mockResolvedValue({ success: true, data: existing });
    mocks.checkCanResume.mockResolvedValue(true);
    const page = workspacePage();
    await waitFor(() => expect(page.result.current.canResume).toBe(true));
    act(() => { page.store.dispatch(openReviewTab()); page.store.dispatch(addContextItem(reviewComment)); });
    expect(page.result.current.composerRun?.id).toBe(existing.id);
    let finish!: (value: boolean) => void;
    mocks.continueRun.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    let sending!: Promise<string | null | undefined>;
    act(() => { sending = page.result.current.handleExecute(); });
    await waitFor(() => expect(mocks.continueRun).toHaveBeenCalled());
    const edited = { ...reviewComment, comment: "Updated while sending" };
    act(() => page.store.dispatch(setContextItemsForKey({ key: page.result.current.ownerKey, items: [edited] })));
    await act(async () => { finish(true); await sending; });
    expect(page.result.current.activeTab).toBe("review");
    expect(page.result.current.contextItems).toEqual([edited]);
    act(() => page.result.current.handleSendTargetChange(null));
    expect(page.result.current.composerRun).toBeUndefined();
    expect(page.result.current.sendTarget?.label).toBe("New chat");
  });
});
