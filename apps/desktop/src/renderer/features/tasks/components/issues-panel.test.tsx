// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueWithEntity } from "@/lib/redux/api";

const mocks = vi.hoisted(() => ({ issues: [] as unknown[] }));

vi.mock("@/lib/redux/api", () => ({
  useGetIssuesInboxQuery: () => ({ currentData: mocks.issues, isLoading: false, isFetching: false }),
  useGetIssueStatusesQuery: () => ({
    data: [
      { id: "backlog", name: "Backlog", category: "open", sortOrder: 0 },
      { id: "todo", name: "Todo", category: "open", sortOrder: 1 },
      { id: "in_progress", name: "In progress", category: "open", sortOrder: 2 },
      { id: "in_review", name: "In review", category: "open", sortOrder: 3 },
      { id: "done", name: "Done", category: "closed", sortOrder: 4 },
    ],
  }),
}));
vi.mock("@/lib/platform", () => ({ useIsMobile: () => false }));

import { IssuesPanel } from "./issues-panel";

function issue(
  id: string,
  provider: string,
  statusId: string,
  extra: Partial<IssueWithEntity["issue"]> = {},
): IssueWithEntity {
  return {
    issue: {
      entityId: id,
      provider,
      statusId,
      state: statusId,
      priority: 0,
      labels: null,
      labelColors: null,
      assignee: null,
      assigneeAvatarUrl: null,
      groupName: null,
      groupColor: null,
      identifier: null,
      repo: null,
      number: null,
      ...extra,
    },
    entity: { id, title: `Issue ${id}`, resourceId: `${provider}-res`, occurredAt: null },
  } as unknown as IssueWithEntity;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  // The view tabs measure their sliding highlight.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  mocks.issues = [
    issue("a1", "asana", "todo"),
    issue("a2", "asana", "todo"),
    issue("l1", "linear", "in_progress", { labels: JSON.stringify(["Bug"]), priority: 2, identifier: "MAI-1" }),
    issue("l2", "linear", "in_progress", { labels: JSON.stringify(["Feature"]), priority: 1 }),
    issue("l3", "linear", "backlog"),
  ];
});

function renderPanel(provider: string | null = null) {
  return render(
    <IssuesPanel scope={{ provider, resourceId: null }} activeEntityId={null} onSelectIssue={() => {}} />,
  );
}

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Filter issues" }));
  return screen.getByRole("menu", { name: "Issue filters" });
}

function openGroup(name: string) {
  fireEvent.click(screen.getByRole("menuitem", { name }));
  return screen.getByRole("menu", { name });
}

const titles = () => screen.queryAllByText(/^Issue /).map((node) => node.textContent);

describe("IssuesPanel filters", () => {
  it("counts within the sidebar scope, not across every connection", () => {
    renderPanel("asana");
    openMenu();
    const status = openGroup("Status");

    expect(within(status).getByRole("menuitemcheckbox", { name: /Todo/ }).textContent).toContain("2 issues");
    // The open workflow is listed even where this scope has nothing.
    expect(within(status).getByRole("menuitemcheckbox", { name: /In progress/ }).textContent).not.toContain("issue");
    // Asana issues carry no priority, so there is nothing to tell apart.
    expect(screen.queryByRole("menuitem", { name: "Priority" })).toBeNull();
  });

  it("narrows the list by a picked value and shows it as a removable chip", () => {
    renderPanel();
    openMenu();
    fireEvent.click(within(openGroup("Labels")).getByRole("menuitemcheckbox", { name: /Bug/ }));

    expect(titles()).toEqual(["Issue l1"]);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Remove Labels filter" }));
    expect(titles()).toHaveLength(5);
  });

  it("counts a group under the other groups' picks", () => {
    renderPanel();
    openMenu();
    fireEvent.click(within(openGroup("Priority")).getByRole("menuitemcheckbox", { name: /Urgent/ }));
    const status = openGroup("Status");
    expect(within(status).getByRole("menuitemcheckbox", { name: /In progress/ }).textContent).toContain("1 issue");
    expect(within(status).getByRole("menuitemcheckbox", { name: /Todo/ }).textContent).not.toContain("issue");
  });

  it("searches every group's values from the menu's search field", () => {
    renderPanel();
    openMenu();
    const search = screen.getByRole("textbox", { name: "Find a filter" });
    fireEvent.change(search, { target: { value: "feat" } });

    const result = screen.getByRole("menuitemcheckbox", { name: /Feature/ });
    expect(result.textContent).toContain("Labels");
    fireEvent.keyDown(search, { key: "Enter" });
    expect(titles()).toEqual(["Issue l2"]);
  });

  it("narrows by a view chip, and the filter menu counts within it", () => {
    renderPanel();
    expect(screen.getByRole("radio", { name: "All issues" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("radio", { name: "Backlog" }));
    expect(titles()).toEqual(["Issue l3"]);

    fireEvent.keyDown(screen.getByRole("radio", { name: "Backlog" }), { key: "ArrowLeft" });
    expect(screen.getByRole("radio", { name: "Active" }).getAttribute("aria-checked")).toBe("true");
    expect(titles()).toEqual(["Issue a1", "Issue a2", "Issue l1", "Issue l2"]);

    openMenu();
    const status = openGroup("Status");
    expect(within(status).getByRole("menuitemcheckbox", { name: /Backlog/ }).textContent).not.toContain("issue");
  });

  it("finds an issue by its hidden identifier", () => {
    renderPanel();
    fireEvent.change(screen.getByRole("textbox", { name: "Search issues" }), { target: { value: "mai-1" } });
    expect(titles()).toEqual(["Issue l1"]);
    expect(screen.queryByText("MAI-1")).toBeNull();
  });
});
