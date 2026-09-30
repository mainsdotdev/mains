// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
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
  WorkspaceInput: ({ layout, browserStatusPlaceholder }: { layout?: string; browserStatusPlaceholder?: string | null }) =>
    createElement("div", {
      "data-testid": layout === "centered" ? "centered-input" : layout === "browser" ? "browser-input" : "pinned-input",
      "data-status-placeholder": browserStatusPlaceholder ?? "",
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

function renderPage() {
  return render(
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
}

afterEach(() => {
  cleanup();
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

  it("keeps the expanded browser when the child chat starts its first run", () => {
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

    renderPage();
    expect(onAction).toBeDefined();
    expect(window.api.browserChat.publishContext).toHaveBeenCalledWith(
      expect.objectContaining({
        activeSpace: expect.objectContaining({ id: "space-codex", providerId: "codex" }),
      }),
    );
    act(() => onAction?.({ type: "selectRun", ownerKey: "draft", runId: "run-1" }));
    const runKey = runOwnerKey("local", "run-1");
    paneState = appSettingsReducer(paneState, setRightPaneContextKey({ ownerKey: runKey, browserExpansionKey: runKey }));

    expect(paneState.browserPanelOpen).toBe(true);
    expect(paneState.browserPanelExpanded).toBe(true);
    expect(page.state.handleSelectRunTab).toHaveBeenCalledWith("run-1");
  });
});
