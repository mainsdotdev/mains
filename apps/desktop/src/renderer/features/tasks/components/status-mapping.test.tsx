// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connections: [] as Array<Record<string, unknown>>,
  resources: [] as Array<Record<string, unknown>>,
  states: {} as Record<string, unknown>,
  setMapping: vi.fn(),
}));

vi.mock("@/lib/redux/api", () => ({
  useGetConnectionStatesQuery: () => ({ data: mocks.connections }),
  useGetSelectedResourcesQuery: () => ({
    data: { items: mocks.resources, connectionId: "c" },
    isLoading: false,
  }),
  useGetIssueStatusesQuery: () => ({
    data: [
      { id: "backlog", name: "Backlog", category: "open", sortOrder: 0 },
      { id: "todo", name: "Todo", category: "open", sortOrder: 1 },
      { id: "in_progress", name: "In progress", category: "open", sortOrder: 2 },
      { id: "in_review", name: "In review", category: "open", sortOrder: 3 },
      { id: "done", name: "Done", category: "closed", sortOrder: 4 },
      { id: "canceled", name: "Canceled", category: "closed", sortOrder: 5 },
    ],
  }),
  useGetIssueStatesQuery: (resourceId: string) => ({
    data: mocks.states[resourceId],
    isLoading: false,
    error: undefined,
  }),
  useSetIssueStatusMappingMutation: () => [mocks.setMapping],
}));

import { StatusMappingButton, StatusMappingModal } from "./status-mapping";

function state(id: string, name: string, defaultStatusId: string, statusId = defaultStatusId) {
  return { id, name, color: null, defaultStatusId, statusId, mapped: statusId !== defaultStatusId };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  mocks.setMapping.mockReturnValue({ unwrap: () => Promise.resolve({ updated: 1 }) });
  mocks.connections = [
    { id: "linear", displayName: "Linear", category: "issues", isConnected: true, sortOrder: 1 },
    { id: "github", displayName: "GitHub", category: "issues", isConnected: true, sortOrder: 0 },
    { id: "jira", displayName: "Jira", category: "issues", isConnected: false, sortOrder: 2 },
    { id: "sentry", displayName: "Sentry", category: "monitoring", isConnected: true, sortOrder: 3 },
  ];
  mocks.resources = [
    { id: "t-mains", key: "MAI", name: "Mains" },
    { id: "t-sides", key: "SID", name: "Sides" },
  ];
  mocks.states = {
    "t-mains": {
      resourceId: "t-mains",
      supported: true,
      states: [
        state("s-todo", "Todo", "todo"),
        state("s-qa", "Ready for QA", "in_progress", "in_review"),
      ],
    },
    "t-sides": { resourceId: "t-sides", supported: true, states: [state("s-sides-todo", "Todo", "todo")] },
  };
});

afterEach(cleanup);

async function choose(selectName: string, option: string | RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: selectName }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("option", { name: option }));
  });
}

describe("StatusMappingButton", () => {
  it("shows on every scope, All issues and open/closed providers included", () => {
    const { rerender } = render(<StatusMappingButton scope={{ provider: "linear", resourceId: null }} />);
    expect(screen.getByRole("button", { name: "Statuses" })).toBeTruthy();

    rerender(<StatusMappingButton scope={{ provider: "github", resourceId: null }} />);
    expect(screen.getByRole("button", { name: "Statuses" })).toBeTruthy();

    rerender(<StatusMappingButton scope={{ provider: null, resourceId: null }} />);
    expect(screen.getByRole("button", { name: "Statuses" })).toBeTruthy();
  });
});

describe("StatusMappingModal", () => {
  it("lists every linked team's states with the status each maps to", () => {
    render(<StatusMappingModal provider="linear" resourceId={null} onClose={() => {}} />);

    expect(screen.getByRole("region", { name: "Mains" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Sides" })).toBeTruthy();
    // Unmapped states show sync's own pick; mapped ones show the user's.
    expect(screen.getAllByRole("button", { name: "Status for Todo" })[0].textContent).toContain("Todo");
    expect(screen.getByRole("button", { name: "Status for Ready for QA" }).textContent).toContain("In review");
  });

  it("narrows to the scoped team", () => {
    render(<StatusMappingModal provider="linear" resourceId="t-mains" onClose={() => {}} />);
    expect(screen.getByText("Ready for QA")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Sides" })).toBeNull();
  });

  it("maps a state onto a status", async () => {
    render(<StatusMappingModal provider="linear" resourceId="t-mains" onClose={() => {}} />);
    await choose("Status for Todo", "Backlog");
    expect(mocks.setMapping).toHaveBeenCalledWith({
      resourceId: "t-mains",
      stateId: "s-todo",
      statusId: "backlog",
    });
  });

  it("drops a mapping back to automatic", async () => {
    render(<StatusMappingModal provider="linear" resourceId="t-mains" onClose={() => {}} />);
    await choose("Status for Ready for QA", /Automatic/);
    expect(mocks.setMapping).toHaveBeenCalledWith({
      resourceId: "t-mains",
      stateId: "s-qa",
      statusId: null,
    });
  });

  it("explains an Asana project without sections instead of listing nothing", () => {
    mocks.resources = [{ id: "p-site", name: "Website Launch" }];
    mocks.states = { "p-site": { resourceId: "p-site", supported: true, states: [] } };
    render(<StatusMappingModal provider="asana" resourceId={null} onClose={() => {}} />);
    expect(screen.getByText(/No sections in this project/)).toBeTruthy();
  });

  it("shows an open/closed provider's fixed rule instead of selects", () => {
    render(<StatusMappingModal provider="github" resourceId={null} onClose={() => {}} />);
    expect(screen.getByText("GitHub statuses")).toBeTruthy();
    expect(screen.getByText(/only open or closed/)).toBeTruthy();
    expect(screen.getByText("Closed as not planned")).toBeTruthy();
    expect(screen.getByText("Canceled")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Status for/ })).toBeNull();
  });

  it("gives every connected issue connection its own section under All issues", () => {
    render(<StatusMappingModal provider={null} resourceId={null} onClose={() => {}} />);
    expect(screen.getByText("Statuses")).toBeTruthy();
    const sections = screen
      .getAllByRole("region")
      .filter((region) => ["GitHub", "Linear", "Jira", "Sentry"].includes(region.getAttribute("aria-label") ?? ""))
      .map((region) => region.getAttribute("aria-label"));
    // Sidebar order; not-connected and non-issue connections stay out.
    expect(sections).toEqual(["GitHub", "Linear"]);
    expect(screen.getByText(/only open or closed/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Status for Ready for QA" })).toBeTruthy();
  });

  it("explains a connection without linked teams", () => {
    mocks.resources = [];
    render(<StatusMappingModal provider="linear" resourceId={null} onClose={() => {}} />);
    expect(screen.getByText(/No teams or projects are linked/)).toBeTruthy();
  });
});
