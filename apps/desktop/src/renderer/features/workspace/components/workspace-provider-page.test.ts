// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MainHeaderProvider, useMainHeader } from "@/hooks/use-main-header";
import { WorkspaceProviderPage } from "./workspace-provider-page";

const page = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
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
  WorkspaceInput: ({ layout }: { layout?: string }) =>
    createElement("div", {
      "data-testid": layout === "centered" ? "centered-input" : "pinned-input",
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
      MainHeaderProvider,
      null,
      createElement(Header),
      createElement(WorkspaceProviderPage, {
        providerId: "codex",
        variant: "codex",
      }),
    ),
  );
}

afterEach(cleanup);

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
        MainHeaderProvider,
        null,
        createElement(Header),
        createElement(WorkspaceProviderPage, {
          providerId: "codex",
          variant: "codex",
        }),
      ),
    );

    expect(screen.queryByTestId("tabs")).toBeNull();
    expect(screen.getByTestId("centered-input")).toBeTruthy();
    expect(screen.queryByTestId("pinned-input")).toBeNull();
  });
});
