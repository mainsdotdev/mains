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
  execute: vi.fn(), continue: vi.fn(), abort: vi.fn(), prepare: vi.fn(), jump: vi.fn(),
  spaces: [{ id: "work-space", accountId: "account", name: "Codex Work", mode: "work", providerId: "codex", model: "test-model" }],
  runId: null as string | null,
  runMode: "work",
  selection: undefined as unknown,
  getState: vi.fn(), invoke: vi.fn(),
  chatProvider: vi.fn(),
  chatMode: vi.fn(),
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
    const activeRun = mocks.runId ? { id: mocks.runId, mode: mocks.runMode, providerId: "codex", spaceId: "work-space", status: "succeeded", goal: "Edit page",
      model: mocks.settings.model, configSnapshot: { conversationSettings: mocks.settings } } : undefined;
    return { runsLoaded: true, runs: activeRun ? [activeRun] : [], activeRunId: mocks.runId, activeRun,
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
  useGetAppSettingsQuery: () => ({ data: { activeSpaceId: mocks.spaces[0]?.id }, isLoading: false }),
  useGetSpacesQuery: () => ({ data: mocks.spaces, isLoading: false }),
  useAbortRunMutation: () => [mocks.abort],
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
    <AtlasPageChat accountId="account" id={id} title={`Page ${id}`} collectionId="project" disabled={false} prepareMessage={mocks.prepare} />
  </MemoryRouter></Provider>;
  const result = render(tree("one"));
  return { store, switchPage: (id: string) => result.rerender(tree(id)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runId = null;
  mocks.runMode = "work";
  mocks.spaces = [{ id: "work-space", accountId: "account", name: "Codex Work", mode: "work", providerId: "codex", model: "test-model" }];
  mocks.settings = { model: "test-model", config: { modelReasoningEffort: "medium", serviceTier: "" } };
  mocks.invoke.mockResolvedValue(undefined);
  mocks.prepare.mockResolvedValue("Atlas instruction with the saved page version");
  mocks.execute.mockImplementation(async (...args: unknown[]) => {
    mocks.settings = args[8] as typeof mocks.settings;
    mocks.runId = "page-run";
    mocks.runMode = "work";
    return mocks.runId;
  });
  mocks.continue.mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  for (const id of ["one", "two"]) clearTransientUploads(JSON.stringify(["local", "atlas-page", "account", id, "work-space"]));
});

describe("Atlas floating page chat", () => {
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
    expect(mocks.prepare).not.toHaveBeenCalled();
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
    expect(mocks.prepare).toHaveBeenCalledWith("Edit this page");
    expect(mocks.execute).toHaveBeenCalledWith("Atlas instruction with the saved page version", undefined, "codex", "test-model", undefined, [], "project", undefined, mocks.settings);
    expect(mocks.selection).toEqual({ selection: "local" });
    expect(mocks.jump).not.toHaveBeenCalled();
    typeInstruction("Expand the summary");
    fireEvent.click(screen.getByRole("button", { name: "Send page instruction" }));
    await waitFor(() => expect(mocks.continue).toHaveBeenCalledWith("page-run", "Atlas instruction with the saved page version", "test-model", undefined, [], undefined, mocks.settings));
    expect(mocks.execute).toHaveBeenCalledOnce();
  });

  it("keeps the draft and does not start a run when the page cannot be saved", async () => {
    mocks.prepare.mockResolvedValue(null);
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
    expect(mocks.prepare).toHaveBeenCalledWith("Use the attached context to work on this page.");
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
