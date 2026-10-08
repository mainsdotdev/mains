// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { Link, MemoryRouter } from "react-router-dom";
import appSettings from "@/lib/redux/slices/appSettingsSlice";
import workspace from "@/lib/redux/slices/workspaceSlice";
import backends from "@/lib/redux/slices/backendsSlice";
import { setStatusBarVisible } from "@/lib/redux/slices/appSettingsSlice";

const mocks = vi.hoisted(() => ({
  contextListeners: new Set<(data: unknown) => void>(),
  limitsQuery: vi.fn((_providerId: string, _options?: unknown) => ({ currentData: {
    primary: { usedPercent: 25, windowDurationMins: 300 },
    secondary: { usedPercent: 10, windowDurationMins: 10080 },
  }, refetch: vi.fn(), isFetching: false, isError: false })),
}));

vi.mock("@/hooks/use-active-space", () => ({
  useActiveSpace: () => ({ activeSpace: { id: "space", name: "Code", mode: "developer", providerId: "claude_code" } }),
}));
vi.mock("@/hooks/use-space-provider-variant", async () => {
  const { getProviderVariant } = await import("@/lib/provider-variants");
  return { useSpaceProviderVariant: () => getProviderVariant("claude") };
});
vi.mock("@/lib/redux/api", () => ({
  useGetAccountQuery: () => ({ data: { id: "account" } }),
  useGetWorkspaceQuery: () => ({ currentData: { id: "workspace", name: "mains", rootPath: "/projects/mains", projectId: "project" } }),
  useListWorkspaceGitStatesQuery: () => ({ data: [{ workspaceId: "workspace", branch: "feat/status-bar", pathExists: true }] }),
  useGetProviderRateLimitsQuery: mocks.limitsQuery,
  useGetProviderPluginsQuery: () => ({ currentData: { marketplaces: [{ plugins: [
    { id: "enabled", installed: true, enabled: true },
    { id: "disabled", installed: true, enabled: false },
    { id: "catalog", installed: false, enabled: true },
  ] }] } }),
}));
vi.mock("@/lib/redux/api/providersApi", () => ({ providersApi: { util: { updateQueryData: vi.fn() } } }));
vi.mock("@/lib/redux/api/atlasApi", () => ({
  useAtlasPageQuery: (_args: unknown, options: { skip: boolean }) => ({
    currentData: options.skip ? undefined : { item: { title: "Product plan", version: 7 } },
  }),
}));
vi.mock("@/lib/transport", () => ({ appEvents: {
  runs: { onContextUsage: (listener: (data: unknown) => void) => {
    mocks.contextListeners.add(listener);
    return () => mocks.contextListeners.delete(listener);
  } },
  providers: { onRateLimitsUpdated: () => () => {} },
} }));

import { AppStatusBar } from "./app-status-bar";

afterEach(() => { cleanup(); mocks.contextListeners.clear(); vi.clearAllMocks(); });

function mount(route = "/code/workspace") {
  const store = configureStore({
    reducer: { appSettings, workspace, backends },
    preloadedState: { workspace: {
      ...workspace(undefined, { type: "init" }),
      activeWorkspaceId: "workspace", activeTab: "run-1", composerContextReady: true,
    } },
  });
  render(<Provider store={store}><MemoryRouter initialEntries={[route]}>
    <Link to="/plugins?provider=codex">Go to plugins</Link>
    <Link to="/atlas/page-1">Go to Atlas</Link>
    <AppStatusBar />
  </MemoryRouter></Provider>);
  return store;
}

describe("application status bar", () => {
  it("retains this chat's live context while hiding and re-showing the bar", () => {
    const store = mount();
    expect(screen.getByText("mains")).toBeTruthy();
    expect(screen.getByText("feat/status-bar")).toBeTruthy();
    const push = (runId: string) => act(() => {
      for (const listener of mocks.contextListeners) listener({ runId, event: {
        totalTokens: 4200, maxTokens: 10000, percentage: 42, ts: 1,
      } });
    });
    push("other-run");
    expect(screen.getByRole("button", { name: "Context —" })).toBeTruthy();
    push("run-1");
    expect(screen.getByRole("button", { name: "Context 42%" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide status bar" }));
    expect(store.getState().appSettings.statusBarVisible).toBe(false);
    expect(screen.queryByRole("contentinfo")).toBeNull();
    act(() => { store.dispatch(setStatusBarVisible(true)); });
    expect(screen.getByRole("button", { name: "Context 42%" })).toBeTruthy();
  });

  it("shows remaining allowance rather than used percentages", () => {
    mount();
    expect(screen.getByRole("button", { name: "Claude remaining limits: 5h 75% left, Weekly 90% left" })).toBeTruthy();
  });

  it("switches to the Plugins route's provider and excludes the previous chat's context", () => {
    mount();
    fireEvent.click(screen.getByText("Go to plugins"));
    expect(screen.getByText("Plugins · 1 enabled")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Context/ })).toBeNull();
    expect(screen.queryByText("feat/status-bar")).toBeNull();
    expect(mocks.limitsQuery.mock.calls.at(-1)?.[0]).toBe("codex");
  });

  it("describes the Atlas page instead of the workspace left behind", () => {
    mount();
    fireEvent.click(screen.getByText("Go to Atlas"));
    expect(screen.getByText("Atlas · Product plan")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Context/ })).toBeNull();
    expect(screen.queryByText("feat/status-bar")).toBeNull();
  });
});
