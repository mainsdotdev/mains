// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import atlasReducer, { updateAtlasPageChat } from "@/lib/redux/slices/atlasSlice";
import workspaceReducer, { addContextItem, setComposerContextKey } from "@/lib/redux/slices/workspaceSlice";
import { clearTransientUploads } from "@/features/workspace/hooks/use-transient-uploads";
import { AtlasPageChat } from "./atlas-page-chat";
import { useActiveSpace } from "@/hooks/use-active-space";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(), continue: vi.fn(), abort: vi.fn(), beforeSend: vi.fn(), jump: vi.fn(),
  spaces: [{ id: "work-space", accountId: "account", name: "Codex Work", mode: "work", providerId: "codex", model: "test-model" }],
  runId: null as string | null,
  runMode: "work",
  runProviderId: "codex",
  runSpaceId: "work-space",
  activeSpaceId: undefined as string | undefined,
  selection: undefined as unknown,
  getState: vi.fn(), invoke: vi.fn(),
  chatProvider: vi.fn(),
  chatMode: vi.fn(),
  pageRuns: [] as Array<{ id: string; accountId: string; providerId: string; spaceId: string; mode: string; title: string; configSnapshot: Record<string, unknown> }>,
  historyLoading: false,
  historyError: undefined as unknown,
  listPageRuns: vi.fn(),
  settings: { model: "test-model", config: { modelReasoningEffort: "medium", serviceTier: "" } },
  provider: { defaultModel: "test-model", config: { modelReasoningEffort: "medium", serviceTier: "" } },
  models: [
    { id: "test-model", displayName: "Test Model", supportedEffortLevels: ["low", "medium", "high"], supportsFastMode: true },
    { id: "other-model", displayName: "Other Model", supportedEffortLevels: ["low", "medium", "high"], supportsFastMode: true },
  ],
  empty: [],
}));
vi.mock("@/lib/redux", () => ({ store: { getState: () => mocks.getState() } }));
vi.mock("@/features/workspace/hooks/use-workspace-runs", () => ({
  useWorkspaceRuns: (_workspace: unknown, _provider: unknown, _mode: unknown, _run: unknown, _prefetch: unknown, selection: unknown) => {
    mocks.chatProvider(_provider);
    mocks.chatMode(_mode);
    mocks.selection = selection;
    const savedRun = mocks.pageRuns.find((run) => run.id === _run);
    const runId = savedRun?.id ?? (_run === mocks.runId ? mocks.runId : null);
    const activeRun = runId ? { id: runId, mode: mocks.runMode, providerId: mocks.runProviderId, spaceId: mocks.runSpaceId, status: "succeeded", goal: "Edit page",
      model: mocks.settings.model, configSnapshot: { conversationSettings: mocks.settings }, ...savedRun } : undefined;
    return { runsLoaded: true, runs: activeRun ? [activeRun] : [], activeRunId: runId, activeRun,
      currentEvents: [], currentTurns: [], eventsEndRef: { current: null }, history: undefined,
      isLoading: false, error: null, executeRun: mocks.execute, continueRun: mocks.continue };
  },
}));
vi.mock("@/features/workspace/hooks/use-tool-approval", () => ({ useToolApproval: () => ({ pendingApprovals: [], respond: vi.fn() }) }));
vi.mock("@/features/workspace/hooks/use-jump-to-run", () => ({ useJumpToRun: () => mocks.jump }));
vi.mock("@/features/workspace/hooks/use-plugin-logos", () => ({ PluginLogoProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/features/workspace/components/workspace-events", () => ({ WorkspaceEvents: () => <div>Page conversation</div> }));
vi.mock("@/features/workspace/components/tools/tool-approval-dialog", () => ({ ToolApprovalDialog: () => null }));
vi.mock("@/lib/redux/api", () => ({
  useGetAppSettingsQuery: () => ({ data: { activeSpaceId: mocks.activeSpaceId ?? mocks.spaces[0]?.id }, isLoading: false }),
  useGetSpacesQuery: () => ({ data: mocks.spaces, isLoading: false }),
  useAbortRunMutation: () => [mocks.abort],
  useListRecentRunsQuery: (options: { accountId: string; providerId: string; spaceId: string; atlasPageId: string }) => {
    mocks.listPageRuns(options);
    return { currentData: mocks.historyLoading || mocks.historyError ? undefined : mocks.pageRuns.filter((run) =>
      run.accountId === options.accountId && run.providerId === options.providerId && run.spaceId === options.spaceId
      && run.mode === "work" && run.configSnapshot.atlasPageId === options.atlasPageId),
      isLoading: mocks.historyLoading, isFetching: mocks.historyLoading, error: mocks.historyError };
  },
  useGetProviderAccountInfoQuery: () => ({ data: undefined }),
}));
vi.mock("@/lib/redux/api/providersApi", () => ({
  useGetProviderByIdQuery: () => ({ data: mocks.provider }),
  useGetProviderModelsQuery: () => ({ data: mocks.models }),
  useGetProviderCommandsQuery: () => ({ data: mocks.empty }),
  useGetProviderSkillsQuery: () => ({ data: mocks.empty }),
}));
vi.mock("@/lib/transport", () => ({
  getTransport: () => "test-transport",
  appEvents: { providers: { onModelsUpdated: () => () => {} } },
}));
vi.mock("@/providers/keyboard-shortcuts-provider", () => ({ useKeyboardShortcut: () => {}, useKeyboardShortcutBinding: () => null }));
vi.mock("@/features/workspace/hooks/use-realtime-voice", () => ({
  useRealtimeVoice: () => ({ state: { phase: "idle", runId: null, muted: false } }),
}));
vi.mock("@/features/workspace/hooks/use-context-usage", () => ({ useContextUsage: () => null }));
vi.mock("@/features/workspace/hooks/use-open-file-in-editor", () => ({ useOpenFileInEditor: () => vi.fn() }));
vi.mock("@/hooks/use-document-viewer", () => ({ useDocumentViewer: () => ({ open: vi.fn() }) }));
vi.mock("@/features/workspace/components/unified-context-dropdown", () => ({ UnifiedContextDropdown: () => null }));
vi.mock("@/features/workspace/lib/conversation-settings-writer", () => ({ persistConversationSettings: (...args: unknown[]) => mocks.invoke(...args) }));

function typeInstruction(text: string) {
  const input = screen.getByRole("textbox", { name: "Page instruction" });
  input.textContent = text;
  fireEvent.input(input);
}
function SpaceMode() {
  return <output data-testid="saved-space-mode">{useActiveSpace().activeSpace?.mode}</output>;
}

function setup(starter = false) {
  const store = configureStore({ reducer: { atlas: atlasReducer, workspace: workspaceReducer, backends: () => ({ activeBackendId: null }) } });
  if (starter) store.dispatch(updateAtlasPageChat({ ownerKey: '["local","account"]', id: "one", patch: { draft: "Create a page about ", mode: "details" } }));
  mocks.getState.mockImplementation(() => store.getState());
  const tree = (id: string) => <Provider store={store}><MemoryRouter>
    <SpaceMode />
    <AtlasPageChat accountId="account" id={id} title={`Page ${id}`} collectionId="project" disabled={false} beforeSend={mocks.beforeSend} />
  </MemoryRouter></Provider>;
  const result = render(tree("one"));
  return { store, switchPage: (id: string) => result.rerender(tree(id)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runId = null;
  mocks.runMode = "work";
  mocks.runProviderId = "codex";
  mocks.runSpaceId = "work-space";
  mocks.activeSpaceId = undefined;
  mocks.pageRuns = [];
  mocks.historyLoading = false;
  mocks.historyError = undefined;
  mocks.spaces = [{ id: "work-space", accountId: "account", name: "Codex Work", mode: "work", providerId: "codex", model: "test-model" }];
  mocks.settings = { model: "test-model", config: { modelReasoningEffort: "medium", serviceTier: "" } };
  mocks.invoke.mockResolvedValue(undefined);
  mocks.beforeSend.mockResolvedValue(true);
  mocks.execute.mockImplementation(async (...args: unknown[]) => {
    mocks.settings = args[8] as typeof mocks.settings;
    mocks.runId = "page-run";
    mocks.runMode = "work";
    mocks.runProviderId = args[2] as string;
    mocks.runSpaceId = mocks.activeSpaceId ?? mocks.spaces[0].id;
    return mocks.runId;
  });
  mocks.continue.mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  for (const id of ["one", "two"]) clearTransientUploads(JSON.stringify(["local", "atlas-page", "account", id, "work-space"]));
});

describe("Atlas floating page chat", () => {
  it("restores a saved Page conversation after opening with fresh renderer state", async () => {
    mocks.pageRuns = [{ id: "saved-run", accountId: "account", providerId: "codex", spaceId: "work-space", mode: "work",
      title: "Saved page chat", configSnapshot: { atlasPageId: "one", conversationSettings: mocks.settings } }];
    setup();
    fireEvent.click(screen.getByRole("textbox", { name: "Page instruction" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Saved page chat" })).toBeTruthy());
    typeInstruction("Continue after reload");
    fireEvent.click(screen.getByRole("button", { name: "Send page instruction" }));
    await waitFor(() => expect(mocks.continue).toHaveBeenCalledWith("saved-run", "Continue after reload", "test-model", undefined, [], undefined, mocks.settings, undefined, "one"));
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("selects an older Page chat from the floating title and keeps an explicit new-chat choice", async () => {
    mocks.pageRuns = ["Latest chat", "Older chat"].map((title, index) => ({ id: `saved-${index}`, accountId: "account",
      providerId: "codex", spaceId: "work-space", mode: "work", title,
      configSnapshot: { atlasPageId: "one", conversationSettings: mocks.settings } }));
    const view = setup(true);
    fireEvent.click(await screen.findByRole("button", { name: "Latest chat" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Older chat" }));
    typeInstruction("Expand the old discussion");
    fireEvent.click(screen.getByRole("button", { name: "Send page instruction" }));
    await waitFor(() => expect(mocks.continue.mock.calls[0]?.[0]).toBe("saved-1"));
    fireEvent.click(screen.getByRole("button", { name: "Older chat" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "New page chat" }));
    view.switchPage("two");
    view.switchPage("one");
    typeInstruction("Start another discussion");
    fireEvent.click(screen.getByRole("button", { name: "Send page instruction" }));
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce());
    expect(mocks.continue).toHaveBeenCalledOnce();
  });

  it("waits for Page chat discovery before allowing a send and retains the draft on discovery failure", async () => {
    mocks.historyLoading = true;
    const view = setup(true);
    typeInstruction("Keep this request");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send page instruction" }).disabled).toBe(true);
    expect(mocks.execute).not.toHaveBeenCalled();
    mocks.historyLoading = false;
    mocks.historyError = { message: "Could not load chats" };
    view.switchPage("one");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send page instruction" }).disabled).toBe(true);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Page instruction" }).textContent).toBe("Keep this request");
  });

  it("opens a seeded prompt for the user to complete without starting a run", async () => {
    const view = setup(true);
    const input = screen.getByRole("textbox", { name: "Page instruction" });
    expect(input.textContent).toBe("Create a page about ");
    await waitFor(() => expect(document.activeElement).toBe(input));
    const selection = window.getSelection()!;
    const beforeCaret = document.createRange();
    beforeCaret.selectNodeContents(input);
    beforeCaret.setEnd(selection.anchorNode!, selection.anchorOffset);
    expect(selection.isCollapsed).toBe(true);
    expect(beforeCaret.toString()).toBe("Create a page about ");
    expect(screen.getByTestId("floating-chat-surface").getAttribute("data-state")).toBe("details");
    expect(mocks.beforeSend).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    typeInstruction("Create a page about our launch plan");
    expect(view.store.getState().atlas.byOwner['["local","account"]'].chats.one.draft).toBe("Create a page about our launch plan");
    view.switchPage("two");
    view.switchPage("one");
    expect(screen.getByRole("textbox", { name: "Page instruction" }).textContent).toBe("Create a page about our launch plan");
  });

  it("uses a Work space belonging to the active provider instead of the first unrelated Work space", () => {
    mocks.spaces = [
      { ...mocks.spaces[0], id: "claude-chat", name: "Claude Chat", mode: "chat", providerId: "claude_code" },
      mocks.spaces[0],
      { ...mocks.spaces[0], id: "claude-work", name: "Claude Work", providerId: "claude_code" },
    ];
    setup(true);
    expect(mocks.chatProvider).toHaveBeenLastCalledWith("claude_code");
    expect(screen.getByRole("textbox", { name: "Page instruction" }).textContent).toBe("Create a page about ");
  });

  it("opens the starter using the active agent even when it has no saved Work space", () => {
    mocks.spaces = [
      { ...mocks.spaces[0], id: "claude-chat", name: "Claude Chat", mode: "chat", providerId: "claude_code" },
      mocks.spaces[0],
    ];
    setup(true);
    expect(mocks.chatProvider).toHaveBeenLastCalledWith("claude_code");
    expect(mocks.chatMode).toHaveBeenLastCalledWith("work");
    expect(screen.getByRole("textbox", { name: "Page instruction" }).textContent).toBe("Create a page about ");
    expect(screen.getByTestId("saved-space-mode").textContent).toBe("chat");
  });

  it.each(["chat", "developer"])("works from a %s space without changing its saved mode", async (mode) => {
    mocks.spaces = [{ ...mocks.spaces[0], mode }];
    setup();
    expect(screen.queryByPlaceholderText("Set a space to Work mode to work with this page")).toBeNull();
    expect(screen.queryByRole("button", { name: "Permission mode" })).toBeNull();
    typeInstruction("Edit this page");
    fireEvent.click(screen.getByRole("button", { name: "Send page instruction" }));
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce());
    expect(mocks.chatMode).toHaveBeenLastCalledWith("work");
    expect(mocks.spaces[0].mode).toBe(mode);
    expect(screen.getByTestId("saved-space-mode").textContent).toBe(mode);
  });

  it("starts a Work conversation instead of continuing a remembered Chat run", async () => {
    const { store } = setup();
    mocks.runId = "chat-run";
    mocks.runMode = "chat";
    act(() => store.dispatch(updateAtlasPageChat({ ownerKey: '["local","account"]', id: "one",
      patch: { runId: "chat-run", spaceId: "work-space", draft: "Edit this page" } })));
    fireEvent.click(screen.getByRole("button", { name: "Send page instruction" }));
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce());
    expect(mocks.continue).not.toHaveBeenCalled();
  });

  it("uses the shared overlay, expands on focus, minimizes, and retains each page's unsent draft", () => {
    const view = setup();
    expect(screen.getByTestId("floating-chat-surface").getAttribute("data-state")).toBe("input");
    const input = screen.getByRole("textbox", { name: "Page instruction" });
    expect(screen.queryByRole("button", { name: "Show page chat" })).toBeNull();
    fireEvent.click(input);
    typeInstruction("Keep this page's draft");
    expect(screen.getByTestId("floating-chat-surface").getAttribute("data-state")).toBe("details");
    fireEvent.click(screen.getByRole("button", { name: "Minimize chat" }));
    expect(screen.getByTestId("floating-chat-surface").getAttribute("data-state")).toBe("icon");
    fireEvent.click(screen.getByRole("button", { name: "Show chat" }));
    view.switchPage("two");
    expect(screen.getByRole("textbox", { name: "Page instruction" }).textContent).toBe("");
    view.switchPage("one");
    expect(screen.getByRole("textbox", { name: "Page instruction" }).textContent).toBe("Keep this page's draft");
  });

  it("starts and continues the same conversation inside the page without changing workspace selection", async () => {
    setup();
    typeInstruction("Edit this page");
    fireEvent.click(screen.getByRole("button", { name: "Send page instruction" }));
    await screen.findByText("Page conversation");
    expect(mocks.beforeSend).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledWith("Edit this page", undefined, "codex", "test-model", undefined, [], "project", undefined, mocks.settings, undefined, "one");
    expect(mocks.selection).toEqual({ selection: "local" });
    expect(mocks.jump).not.toHaveBeenCalled();
    typeInstruction("Expand the summary");
    fireEvent.click(screen.getByRole("button", { name: "Send page instruction" }));
    await waitFor(() => expect(mocks.continue).toHaveBeenCalledWith("page-run", "Expand the summary", "test-model", undefined, [], undefined, mocks.settings, undefined, "one"));
    expect(mocks.execute).toHaveBeenCalledOnce();
  });

  it("starts a fresh page conversation from the header menu without reopening or deleting the old chat", async () => {
    const { store } = setup(true);
    typeInstruction("Edit this page");
    fireEvent.click(screen.getByRole("button", { name: "Send page instruction" }));
    await screen.findByText("Page conversation");
    fireEvent.click(screen.getByRole("button", { name: "Page chat options" }));
    expect(screen.queryByRole("button", { name: "Open chat" })).toBeNull();
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
    expect(screen.queryByText("Codex Work")).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "New page chat" }));
    expect(store.getState().atlas.byOwner['["local","account"]'].chats.one).toMatchObject({
      runId: null, spaceId: "work-space", mode: "details",
    });
    expect(screen.queryByText("Page conversation")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(mocks.abort).not.toHaveBeenCalled();
    expect(mocks.jump).not.toHaveBeenCalled();
    typeInstruction("A fresh request");
    fireEvent.click(screen.getByRole("button", { name: "Send page instruction" }));
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(2));
    expect(mocks.continue).not.toHaveBeenCalled();
  });

  it("uses the active Space's provider instead of a remembered page-specific Space", async () => {
    mocks.spaces.push({ ...mocks.spaces[0], id: "claude-work", name: "Claude Work", providerId: "claude_code" });
    mocks.runId = "old-claude-run";
    mocks.runProviderId = "claude_code";
    mocks.runSpaceId = "claude-work";
    const { store } = setup(true);
    act(() => store.dispatch(updateAtlasPageChat({ ownerKey: '["local","account"]', id: "one",
      patch: { spaceId: "claude-work", runId: "old-claude-run" } })));
    expect(mocks.chatProvider).toHaveBeenLastCalledWith("codex");
    expect(screen.queryByText("Page conversation")).toBeNull();
    expect(screen.queryByRole("button", { name: "Page chat options" })).toBeNull();
    typeInstruction("Keep this instruction");
    fireEvent.click(screen.getByRole("button", { name: "Send page instruction" }));
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce());
    expect(mocks.execute.mock.calls[0][2]).toBe("codex");
    expect(mocks.continue).not.toHaveBeenCalled();
    expect(store.getState().atlas.byOwner['["local","account"]'].chats.one.spaceId).toBe("work-space");
    fireEvent.click(screen.getByRole("button", { name: "Page chat options" }));
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    expect(screen.getByRole("menuitem", { name: "New page chat" })).toBeTruthy();
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
    expect(screen.queryByText("Claude Work")).toBeNull();
  });

  it("follows active Space changes without continuing the previous provider's run or losing the draft", async () => {
    mocks.spaces.push({ ...mocks.spaces[0], id: "claude-work", name: "Claude Work", providerId: "claude_code" });
    const view = setup(true);
    typeInstruction("Start in Codex");
    fireEvent.click(screen.getByRole("button", { name: "Send page instruction" }));
    await screen.findByText("Page conversation");
    typeInstruction("Keep this instruction");
    mocks.activeSpaceId = "claude-work";
    view.switchPage("one");
    expect(mocks.chatProvider).toHaveBeenLastCalledWith("claude_code");
    expect(screen.queryByText("Page conversation")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Page instruction" }).textContent).toBe("Keep this instruction");
    fireEvent.click(screen.getByRole("button", { name: "Send page instruction" }));
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(2));
    expect(mocks.execute.mock.calls[1][2]).toBe("claude_code");
    expect(mocks.continue).not.toHaveBeenCalled();
    expect(mocks.abort).not.toHaveBeenCalled();
    const store = view.store;
    expect(store.getState().atlas.byOwner['["local","account"]'].chats.one).toMatchObject({
      runId: "page-run", spaceId: "claude-work", mode: "details",
    });
  });

  it("keeps the draft and does not start a run when the page cannot be saved", async () => {
    mocks.beforeSend.mockResolvedValue(false);
    const { store } = setup();
    typeInstruction("Do not lose this");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send page instruction" })); });
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(store.getState().atlas.byOwner['["local","account"]'].chats.one.draft).toBe("Do not lose this");
  });

  it("opens the attachment menu, retains files per Page, and sends their bytes without requiring typed text", async () => {
    const view = setup();
    fireEvent.click(screen.getByRole("button", { name: "Upload file" }));
    expect(screen.getByRole("menuitem", { name: "Images" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Documents" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Codex Work" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Documents" }));
    const file = new File(["page context"], "notes.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Upload files"), { target: { files: [file] } });
    expect(screen.getByText("notes.txt")).toBeTruthy();
    view.switchPage("two");
    expect(screen.queryByText("notes.txt")).toBeNull();
    view.switchPage("one");
    expect(screen.getByText("notes.txt")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send page instruction" }));
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce());
    expect(mocks.beforeSend).toHaveBeenCalledOnce();
    expect(mocks.execute.mock.calls[0][4]).toEqual([{ name: "notes.txt", type: "document", mimeType: "text/plain", data: btoa("page context") }]);
    await waitFor(() => expect(screen.queryByText("notes.txt")).toBeNull());
  });

  it("uses the shared model and Fast controls, omits Work permissions, and submits the chosen settings", async () => {
    setup();
    expect(screen.queryByRole("button", { name: "Permission mode" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Model and effort" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Other Model/ }));
    fireEvent.click(screen.getByRole("button", { name: /Fast/ }));
    fireEvent.click(screen.getByRole("textbox", { name: "Page instruction" }));
    expect(screen.queryByRole("button", { name: "Permission mode" })).toBeNull();
    typeInstruction("Write a summary");
    fireEvent.click(screen.getByRole("button", { name: "Send page instruction" }));
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce());
    expect(mocks.execute.mock.calls[0][3]).toBe("other-model");
    expect(mocks.execute.mock.calls[0][8]).toMatchObject({ model: "other-model", config: { serviceTier: "fast" } });
  });

  it("isolates explicit context from other Pages and restores the previous workspace context after leaving", async () => {
    const view = setup();
    const pageContext = { kind: "mcp-app" as const, id: "context", sessionId: "app", appName: "App", updateId: "update", label: "Page context", hidden: false };
    act(() => view.store.dispatch(addContextItem(pageContext)));
    view.switchPage("two");
    expect(view.store.getState().workspace.contextItems).toEqual([]);
    view.switchPage("one");
    expect(view.store.getState().workspace.contextItems).toEqual([pageContext]);
    fireEvent.click(screen.getByRole("button", { name: "Send page instruction" }));
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce());
    expect(mocks.execute.mock.calls[0][5]).toEqual([pageContext]);
    await waitFor(() => expect(view.store.getState().workspace.contextItems).toEqual([]));
    act(() => view.store.dispatch(setComposerContextKey("another-workspace")));
    cleanup();
    expect(view.store.getState().workspace.composerContextKey).toBe("another-workspace");
  });
});
