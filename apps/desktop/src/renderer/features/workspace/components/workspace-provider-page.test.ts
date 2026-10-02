// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MainHeaderProvider, useMainHeader } from "@/hooks/use-main-header";
import { MemoryRouter } from "react-router-dom";
import { WorkspaceProviderPage } from "./workspace-provider-page";
import appSettingsReducer, {
  setBrowserPanelExpanded,
  setBrowserPanelOpen,
  setRightPaneContextKey,
} from "@/lib/redux/slices/appSettingsSlice";
import { runOwnerKey } from "../../../../shared/ui-state-keys";
import type { BrowserChatAction } from "../../../../shared/browser-chat-window";

const page = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  dispatch: vi.fn(),
}));
const browser = vi.hoisted(() => ({
  isExpanded: false,
  nativeOverlay: false,
  chatHost: null as HTMLElement | null,
  ownerKey: "draft",
  setChatMode: vi.fn(),
}));
const mcp = vi.hoisted(() => ({ panel: null as null | Record<string, unknown> }));
vi.mock("@/hooks/use-mcp-app-panel", () => ({ useMcpAppPanel: () => mcp.panel }));

vi.mock("@/hooks/use-browser-panel", () => ({
  useBrowserPanel: () => ({
    isExpanded: browser.isExpanded,
    nativeOverlay: browser.nativeOverlay,
    chatVisible: true,
    chatHost: browser.chatHost,
    ownerKey: browser.ownerKey,
    chatMode: "input",
    setChatMode: browser.setChatMode,
  }),
}));

vi.mock("@/hooks/use-active-space", () => ({
  useActiveSpace: () => ({
    activeSpace: { id: "space-codex", providerId: "codex", mode: "developer" },
  }),
}));

vi.mock("@/features/workspace/hooks", () => ({
  useWorkspacePage: () => page.state,
  useToolApproval: () => ({ pendingApprovals: [], respond: vi.fn() }),
  useProviderAuthTerminal: () => ({ session: null }),
  PluginLogoProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/features/workspace/components", () => ({
  WorkspaceEmptyState: () => createElement("div", { "data-testid": "empty" }),
  WorkspaceEvents: () => createElement("div", { "data-testid": "events" }),
  WorkspaceInput: ({ layout, floatingStatusPlaceholder, onSubmit }: { layout?: string; floatingStatusPlaceholder?: string | null; onSubmit: () => void }) =>
    createElement("div", {
      "data-testid": layout === "centered" ? "centered-input" : layout === "floating" ? "browser-input" : "pinned-input",
      "data-status-placeholder": floatingStatusPlaceholder ?? "",
      onClick: onSubmit,
    }),
  WorkspaceTabs: () => createElement("div", { "data-testid": "tabs" }),
  TerminalSection: () => null,
  GoalSummaryBar: () => null,
  TodoSummaryBar: () => null,
}));

vi.mock("@/lib/provider-variants", () => ({
  getProviderVariant: () => ({
    planExit: null,
    enableForkRun: false,
    enableSuggestions: false,
    label: "Codex",
    supportsGoalMode: false,
  }),
}));

vi.mock("@/lib/redux/api", () => ({
  useAbortRunMutation: () => [vi.fn()],
  useGetAccountQuery: () => ({}),
  useGetCollectionQuery: () => ({}),
  useGetProviderByIdQuery: () => ({}),
  useUpdateProviderMutation: () => [vi.fn()],
}));

vi.mock("@/lib/redux/hooks", () => ({
  useAppDispatch: () => page.dispatch,
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({
      workspace: { selectedCollectionId: null },
      appSettings: { onboardingCompleted: true },
    }),
}));

vi.mock("@/hooks/use-bottom-terminal", () => ({
  useBottomTerminal: () => ({ isOpen: false }),
}));
vi.mock("@/hooks/use-mode-config", () => ({
  useModeConfig: () => ({ mode: "developer", showTabs: true, showTerminal: false }),
}));
vi.mock("@/hooks/use-workspace-route-top-rounding", () => ({
  useWorkspaceRouteTopRounding: () => "",
}));
vi.mock("@/components/layout/sidebar/project-icon", () => ({
  ProjectIcon: () => null,
}));

function Header() {
  const { header } = useMainHeader();
  return createElement("header", null, header);
}

function renderPage(browserChatOnly = false) {
  return render(
    createElement(
      MemoryRouter,
      null,
      createElement(MainHeaderProvider, null,
        createElement(Header),
        createElement(WorkspaceProviderPage, {
          providerId: "codex",
          variant: "codex",
          browserChatOnly,
        }),
      ),
    ),
  );
}

afterEach(() => {
  cleanup();
  (mcp.panel?.chatHost as HTMLElement | undefined)?.remove();
  mcp.panel = null;
  browser.isExpanded = false;
  browser.nativeOverlay = false;
  browser.chatHost?.remove();
  browser.chatHost = null;
  browser.ownerKey = "draft";
  browser.setChatMode.mockClear();
  page.dispatch.mockReset();
  vi.unstubAllGlobals();
});

describe("WorkspaceProviderPage while changing spaces", () => {
  it.each([false, true])("opens a floating browser chat's app in the main panel (automatic=%s)", (automatic) => {
    page.state = { runs: [{ id: "run-1", goal: "Open a template", status: "succeeded" }], runsLoaded: true,
      activeTab: "run-1", selectedFile: null, openIssueTabs: [], openSignalTabs: [], openNoteTabs: [],
      showEmptyState: false, isEmptyStatePending: false, showNewRunTab: false,
      currentWorkspace: { id: "workspace-1", rootPath: "/tmp/workspace-1" }, currentEvents: [], currentTurns: [],
      activeRunId: "run-1", activeRun: { id: "run-1", status: "succeeded" }, composerRun: { id: "run-1" }, goal: "", uploadedFiles: [] };
    browser.isExpanded = true;
    browser.nativeOverlay = true;
    const openTool = vi.fn();
    mcp.panel = { isExpanded: false, openTool };
    let onAction: ((action: BrowserChatAction) => void) | undefined;
    vi.stubGlobal("api", { browserChat: { publishContext: vi.fn(), onAction: (callback: typeof onAction) => {
      onAction = callback; return vi.fn();
    } } });
    renderPage();
    const result = { runId: "run-1", title: "MagicPath", input: { projectId: "project-1" }, output: { content: [] },
      app: { server: "codex_apps", tool: "magicpath.open", resourceUri: "ui://magicpath", originCallId: "call-1" } };
    act(() => onAction?.({ type: "openMcpApp", ownerKey: "draft", result, automatic }));
    expect(openTool).toHaveBeenCalledWith(result, automatic);
    expect(document.querySelector("iframe")).toBeNull();
    act(() => onAction?.({ type: "openMcpApp", ownerKey: "another-owner", result, automatic }));
    act(() => onAction?.({ type: "openMcpApp", ownerKey: "draft", result: { ...result, runId: "another-run" }, automatic }));
    expect(openTool).toHaveBeenCalledOnce();
  });

  it("uses the normal conversation in an expanded MCP panel and restores it when docked", () => {
    const send = vi.fn();
    page.state = { runs: [{ id: "app-run", goal: "Existing app chat", status: "succeeded" }], runsLoaded: true,
      activeTab: "app-run", selectedFile: null, openIssueTabs: [], openSignalTabs: [], openNoteTabs: [],
      showEmptyState: false, isEmptyStatePending: false, showNewRunTab: false,
      currentWorkspace: { id: "workspace-1", rootPath: "/tmp/workspace-1" }, currentEvents: [], currentTurns: [],
      activeRunId: "app-run", activeRun: { id: "app-run", goal: "Existing app chat", status: "succeeded" },
      composerRun: { id: "app-run" }, goal: "Follow up", uploadedFiles: [], handleExecute: send };
    const host = document.createElement("div"); document.body.appendChild(host);
    mcp.panel = { isExpanded: true, chatVisible: true, chatHost: host, chatMode: "details", setChatMode: vi.fn() };
    browser.nativeOverlay = true;
    const publishContext = vi.fn();
    vi.stubGlobal("api", { browserChat: { onAction: () => vi.fn(), publishContext } });
    const view = renderPage();
    expect(host.querySelector('[data-testid="events"]')).toBeTruthy();
    expect(screen.queryByTestId("pinned-input")).toBeNull();
    fireEvent.click(screen.getByTestId("browser-input"));
    expect(send).toHaveBeenCalledTimes(1);
    expect(publishContext).not.toHaveBeenCalled();
    mcp.panel.isExpanded = false;
    view.rerender(createElement(MemoryRouter, null, createElement(MainHeaderProvider, null,
      createElement(Header), createElement(WorkspaceProviderPage, { providerId: "codex", variant: "codex" }))));
    expect(host.querySelector('[data-testid="events"]')).toBeNull();
    expect(screen.getByTestId("pinned-input")).toBeTruthy();
    expect(screen.getByTestId("events")).toBeTruthy();
  });

  it("does not flash the tab strip and pinned input while the next empty space loads", () => {
    page.state = {
      runs: [],
      runsLoaded: false,
      activeTab: "editor",
      selectedFile: null,
      openIssueTabs: [],
      openSignalTabs: [],
      openNoteTabs: [],
      showEmptyState: false,
      isEmptyStatePending: true,
      showNewRunTab: false,
      currentWorkspace: { id: "workspace-1", rootPath: "/tmp/workspace-1" },
      currentEvents: [],
      currentTurns: [],
      activeRunId: null,
      activeRun: null,
      composerRun: null,
      goal: "",
      uploadedFiles: [],
    };

    const view = renderPage();
    expect(screen.queryByTestId("tabs")).toBeNull();
    expect(screen.queryByTestId("pinned-input")).toBeNull();

    page.state = {
      ...page.state,
      runsLoaded: true,
      showEmptyState: true,
      isEmptyStatePending: false,
    };
    view.rerender(
      createElement(
        MemoryRouter,
        null,
        createElement(MainHeaderProvider, null,
          createElement(Header),
          createElement(WorkspaceProviderPage, {
            providerId: "codex",
            variant: "codex",
          }),
        ),
      ),
    );

    expect(screen.queryByTestId("tabs")).toBeNull();
    expect(screen.getByTestId("centered-input")).toBeTruthy();
    expect(screen.queryByTestId("pinned-input")).toBeNull();
  });

  it("opens the selected chat when entering the expanded browser", () => {
    page.state = {
      runs: [{ id: "run-1", status: "succeeded" }],
      runsLoaded: true,
      activeTab: "run-1",
      selectedFile: null,
      openIssueTabs: [],
      openSignalTabs: [],
      openNoteTabs: [],
      showEmptyState: false,
      isEmptyStatePending: false,
      showNewRunTab: false,
      currentWorkspace: { id: "workspace-1", rootPath: "/tmp/workspace-1" },
      currentEvents: [],
      currentTurns: [],
      activeRunId: "run-1",
      activeRun: { id: "run-1", status: "succeeded" },
      composerRun: null,
      goal: "",
      uploadedFiles: [],
    };

    const view = renderPage();
    expect(browser.setChatMode).not.toHaveBeenCalled();
    browser.isExpanded = true;
    view.rerender(
      createElement(
        MemoryRouter,
        null,
        createElement(MainHeaderProvider, null,
          createElement(Header),
          createElement(WorkspaceProviderPage, {
            providerId: "codex",
            variant: "codex",
          }),
        ),
      ),
    );
    expect(browser.setChatMode).toHaveBeenCalledWith("details");
  });

  it("shows the selected run's activity in the compact browser composer until the run ends", () => {
    const selectedRun = {
      id: "run-1",
      goal: "Review this page",
      providerId: "codex",
      status: "running",
    };
    page.state = {
      runs: [selectedRun],
      runsLoaded: true,
      activeTab: "run-1",
      selectedFile: null,
      openIssueTabs: [],
      openSignalTabs: [],
      openNoteTabs: [],
      showEmptyState: false,
      isEmptyStatePending: false,
      showNewRunTab: false,
      currentWorkspace: { id: "workspace-1", rootPath: "/tmp/workspace-1" },
      currentEvents: [{
        id: "event-1",
        type: "artifact",
        content: "Inspecting the layout",
        timestamp: new Date(),
        metadata: { kind: "thinking", streaming: true },
      }],
      currentTurns: [],
      activeRunId: "run-1",
      activeRun: selectedRun,
      composerRun: selectedRun,
      goal: "",
      uploadedFiles: [],
    };
    browser.isExpanded = true;
    browser.chatHost = document.createElement("div");
    document.body.appendChild(browser.chatHost);

    const view = renderPage();
    expect(screen.getByTestId("browser-input").getAttribute("data-status-placeholder"))
      .toBe("Working for 0s · Inspecting the layout");

    page.state = {
      ...page.state,
      activeRun: { ...selectedRun, status: "succeeded" },
      composerRun: { ...selectedRun, status: "succeeded" },
    };
    view.rerender(
      createElement(
        MemoryRouter,
        null,
        createElement(MainHeaderProvider, null,
          createElement(Header),
          createElement(WorkspaceProviderPage, {
            providerId: "codex",
            variant: "codex",
          }),
        ),
      ),
    );
    expect(screen.getByTestId("browser-input").getAttribute("data-status-placeholder"))
      .toBe("");
  });

  it.each([false, true])("registers the child chat's first run even if the browser collapsed while sending (%s)", (collapseBeforeReply) => {
    let paneState = appSettingsReducer(undefined, setRightPaneContextKey({ ownerKey: "draft", browserExpansionKey: "draft" }));
    paneState = appSettingsReducer(paneState, setBrowserPanelOpen(true));
    paneState = appSettingsReducer(paneState, setBrowserPanelExpanded(true));
    page.dispatch.mockImplementation((action) => {
      paneState = appSettingsReducer(paneState, action);
      return action;
    });
    page.state = {
      runs: [],
      runsLoaded: true,
      activeTab: "new-run",
      selectedFile: null,
      openIssueTabs: [],
      openSignalTabs: [],
      openNoteTabs: [],
      showEmptyState: false,
      isEmptyStatePending: false,
      showNewRunTab: true,
      currentWorkspace: { id: "workspace-1", rootPath: "/tmp/workspace-1" },
      currentEvents: [],
      currentTurns: [],
      activeRunId: null,
      activeRun: null,
      composerRun: null,
      goal: "",
      uploadedFiles: [],
      handleSelectRunTab: vi.fn(),
    };
    browser.isExpanded = true;
    browser.nativeOverlay = true;
    let onAction: ((action: { type: "selectRun"; ownerKey: string; runId: string }) => void) | undefined;
    vi.stubGlobal("api", {
      browserChat: {
        publishContext: vi.fn(),
        onAction: (callback: typeof onAction) => {
          onAction = callback;
          return vi.fn();
        },
      },
    });

    const view = renderPage();
    expect(onAction).toBeDefined();
    expect(window.api.browserChat.publishContext).toHaveBeenCalledWith(
      expect.objectContaining({
        activeSpace: expect.objectContaining({ id: "space-codex", providerId: "codex" }),
      }),
    );
    if (collapseBeforeReply) {
      browser.isExpanded = false;
      view.rerender(createElement(MemoryRouter, null,
        createElement(MainHeaderProvider, null,
          createElement(WorkspaceProviderPage, { providerId: "codex", variant: "codex" }),
        ),
      ));
    }
    act(() => onAction?.({ type: "selectRun", ownerKey: "draft", runId: "run-1" }));
    const runKey = runOwnerKey("local", "run-1");
    paneState = appSettingsReducer(paneState, setRightPaneContextKey({ ownerKey: runKey, browserExpansionKey: runKey }));

    expect(paneState.browserPanelOpen).toBe(true);
    expect(paneState.browserPanelExpanded).toBe(true);
    expect(page.state.handleSelectRunTab).toHaveBeenCalledWith("run-1");
  });

  it("reports the submitted run even when parent context echoes have changed the child's tab", async () => {
    page.state = {
      runs: [], activeTab: "new-run", selectedFile: null,
      openIssueTabs: [], openSignalTabs: [], openNoteTabs: [],
      showEmptyState: false, isEmptyStatePending: false, showNewRunTab: true,
      currentWorkspace: null, currentEvents: [], currentTurns: [],
      activeRunId: null, activeRun: null, composerRun: null,
      goal: "new conversation", uploadedFiles: [],
      handleExecute: vi.fn().mockResolvedValue("created-run"),
    };
    browser.isExpanded = true;
    browser.nativeOverlay = true;
    browser.chatHost = document.createElement("div");
    document.body.appendChild(browser.chatHost);
    const postAction = vi.fn();
    vi.stubGlobal("api", { browserChat: { postAction } });
    renderPage(true);
    fireEvent.click(screen.getByTestId("browser-input"));
    await waitFor(() => expect(postAction).toHaveBeenCalledWith({
      type: "selectRun", ownerKey: "draft", runId: "created-run",
    }));
  });
});
