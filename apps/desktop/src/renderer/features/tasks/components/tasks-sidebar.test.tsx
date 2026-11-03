// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connections: [] as Array<Record<string, unknown>>,
  issues: [] as Array<Record<string, unknown>>,
  resources: {} as Record<string, Array<Record<string, unknown>>>,
  refetch: vi.fn(),
  activeModal: null as string | null,
  runSync: vi.fn(),
}));

vi.mock("@/lib/redux/api", () => ({
  useGetConnectionStatesQuery: () => ({
    data: mocks.connections,
    isSuccess: true,
    refetch: mocks.refetch,
  }),
  useGetIssuesInboxQuery: () => ({ currentData: mocks.issues }),
  useGetSelectedResourcesQuery: (provider: string) => ({
    data: { items: mocks.resources[provider] ?? [], connectionId: "c" },
    isSuccess: true,
  }),
  useRunEntitySyncMutation: () => [mocks.runSync, { isLoading: false }],
}));
vi.mock("@/features/settings/components/connections/connection-modals", () => ({
  ConnectionModalHost: ({ activeModal }: { activeModal: string | null }) => {
    mocks.activeModal = activeModal;
    return activeModal ? <div data-testid="modal">{activeModal}</div> : null;
  },
}));

import { TasksSidebar } from "./tasks-sidebar";
import appSettingsReducer from "@/lib/redux/slices/appSettingsSlice";

function connection(id: string, displayName: string, isConnected: boolean, category = "issues") {
  return { id, displayName, isConnected, category, sortOrder: 0, iconPath: "", connectionId: null };
}
function issue(provider: string, resourceId: string | null) {
  return { issue: { provider, repo: null }, entity: { resourceId } };
}

function Probe() {
  const { search } = useLocation();
  return <div data-testid="search">{search}</div>;
}

function renderSidebar(initial = "/tasks") {
  const store = configureStore({ reducer: { appSettings: appSettingsReducer } });
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initial]}>
        <TasksSidebar />
        <Probe />
      </MemoryRouter>
    </Provider>,
  );
}

const search = () => screen.getByTestId("search").textContent;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.activeModal = null;
  mocks.connections = [
    connection("github", "GitHub", true),
    connection("linear", "Linear", true),
    connection("jira", "Jira", false),
    connection("sentry", "Sentry", true, "monitoring"),
  ];
  mocks.resources = {
    github: [
      { id: "r-api", fullName: "acme/api", name: "api" },
      { id: "r-web", fullName: "acme/web", name: "web" },
    ],
    linear: [{ id: "t-eng", key: "ENG", name: "Engineering" }],
  };
  mocks.issues = [
    issue("github", "r-api"),
    issue("github", "r-api"),
    issue("github", "r-web"),
    issue("linear", "t-eng"),
  ];
});

afterEach(cleanup);

describe("TasksSidebar", () => {
  it("lists connected issue trackers with their resources, skipping other categories", () => {
    renderSidebar();
    expect(screen.getByText("GitHub")).toBeTruthy();
    expect(screen.getByText("Linear")).toBeTruthy();
    expect(screen.getByText("acme/api")).toBeTruthy();
    expect(screen.getByText("Engineering")).toBeTruthy();
    expect(screen.queryByText("Sentry")).toBeNull();
    // Not connected: no group, and offered only once "Add connection" opens
    // (the closed list stays mounted for its animation, hidden and inert).
    expect(screen.queryByLabelText("Jira scope")).toBeNull();
    expect(screen.queryByRole("button", { name: /Jira/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Add connection/ }));
    expect(screen.getByRole("button", { name: /Jira/ })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Available connections" }).closest("[inert]")).toBeNull();
    expect(screen.queryByLabelText("Jira scope")).toBeNull();
  });

  it("syncs every connection from the header", () => {
    mocks.runSync.mockReturnValue({
      unwrap: () => Promise.resolve({ success: true, total: 3 }),
    });
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Sync issues" }));
    expect(mocks.runSync).toHaveBeenCalledWith();
  });

  it("hides the sync button until something is connected", () => {
    mocks.connections = [connection("jira", "Jira", false)];
    renderSidebar();
    expect(screen.queryByRole("button", { name: "Sync issues" })).toBeNull();
  });

  it("shows open-issue counts per resource and in total", () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: /All issues\s*4/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /acme\/api\s*2/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Engineering\s*1/ })).toBeTruthy();
  });

  it("selecting a resource writes the scope to the URL", () => {
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /acme\/web/ }));
    expect(search()).toBe("?provider=github&resource=r-web");
    expect(
      screen.getByRole("button", { name: /acme\/web/ }).getAttribute("aria-current"),
    ).toBe("page");

    fireEvent.click(screen.getByRole("button", { name: /All issues/ }));
    expect(search()).toBe("");
  });

  it("selecting a connection's All row scopes to the provider", () => {
    renderSidebar();
    const linear = screen.getByLabelText("Linear scope");
    fireEvent.click(linear.querySelector("button") as HTMLButtonElement);
    expect(search()).toBe("?provider=linear");
  });

  it("only lists GitHub and GitLab on the pull request tab, keeping GitLab's placeholder", () => {
    mocks.connections.push(
      connection("gitlab", "GitLab", true),
      connection("asana", "Asana", true),
      connection("trello", "Trello", true),
    );
    renderSidebar("/tasks?tab=pull_requests");
    expect(screen.getByText("All pull requests")).toBeTruthy();
    expect(screen.getByText("GitHub")).toBeTruthy();
    expect(screen.getByText("GitLab")).toBeTruthy();
    expect(screen.getByLabelText("GitLab scope").textContent).toContain(
      "No pull request support yet",
    );
    for (const provider of ["Linear", "Asana", "Trello", "Jira", "Sentry"]) {
      expect(screen.queryByText(provider)).toBeNull();
    }
    expect(screen.queryByRole("button", { name: /Add connection/ })).toBeNull();
    // GitHub keeps its rows, without issue counts.
    expect(screen.getByRole("button", { name: /^acme\/api$/ })).toBeTruthy();
  });

  it("opens the connection modal for an available connection and for Manage", () => {
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /Add connection/ }));
    fireEvent.click(screen.getByRole("button", { name: /Jira/ }));
    expect(screen.getByTestId("modal").textContent).toBe("jira");

    cleanup();
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Manage GitHub" }));
    expect(screen.getByTestId("modal").textContent).toBe("github");
  });

  it("offers connections straight away when none is connected", () => {
    mocks.connections = [
      connection("github", "GitHub", false),
      connection("linear", "Linear", false),
    ];
    renderSidebar();
    expect(screen.getByRole("button", { name: /GitHub/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add connection/ })).toBeNull();
    expect(screen.getByText(/Connect a service/)).toBeTruthy();
  });

  it("leaves a scope whose connection was revoked", () => {
    renderSidebar("/tasks?provider=jira");
    expect(search()).toBe("");
  });

  it("leaves a scope whose resource was unlinked", () => {
    renderSidebar("/tasks?provider=github&resource=gone");
    expect(search()).toBe("?provider=github");
  });
});
