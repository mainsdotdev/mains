// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueWithEntity } from "@/lib/redux/api";

const mocks = vi.hoisted(() => ({ resources: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/redux/api", () => ({
  useGetSelectedResourcesQuery: () => ({ data: { items: mocks.resources } }),
  useGetIssueStatusesQuery: () => ({
    data: [
      { id: "todo", name: "Todo", category: "open", sortOrder: 1 },
      { id: "in_review", name: "In review", category: "open", sortOrder: 3 },
    ],
  }),
}));

import { IssueDetail } from "./issue-detail";

function issue(extra: Partial<IssueWithEntity["issue"]> = {}): IssueWithEntity {
  return {
    issue: {
      entityId: "e1",
      provider: "asana",
      state: "Doing",
      statusId: "in_review",
      repo: "978471125127219",
      number: null,
      identifier: null,
      priority: 2,
      assignee: "Okan Bilal Balcı",
      assigneeAvatarUrl: null,
      labels: JSON.stringify(["Feature"]),
      labelColors: null,
      groupName: null,
      groupColor: null,
      dueAt: "2025-03-01",
      ...extra,
    },
    entity: {
      id: "e1",
      resourceId: "r-site",
      title: "Initiate landing page",
      body: "qweqwe",
      url: "https://app.asana.com/0/1/2",
      occurredAt: "2025-02-02T10:00:00Z",
    },
  } as unknown as IssueWithEntity;
}

beforeEach(() => {
  mocks.resources = [{ id: "r-site", name: "Website Launch" }];
});
afterEach(cleanup);

describe("IssueDetail", () => {
  it("names where the issue lives instead of showing provider ids", () => {
    render(<IssueDetail issue={issue()} />);
    expect(screen.getByText("Website Launch")).toBeTruthy();
    expect(screen.queryByText(/978471125127219/)).toBeNull();
  });

  it("never falls back to an opaque id when the resource isn't linked", () => {
    mocks.resources = [];
    render(<IssueDetail issue={issue()} />);
    expect(screen.queryByText(/978471125127219/)).toBeNull();
  });

  it("shows a readable repo and the identifier", () => {
    mocks.resources = [];
    render(<IssueDetail issue={issue({ provider: "github", repo: "acme/api", identifier: "#42" })} />);
    expect(screen.getByText("acme/api")).toBeTruthy();
    expect(screen.getByText("#42")).toBeTruthy();
  });

  it("lists the issue's properties under the title", () => {
    render(<IssueDetail issue={issue()} />);
    const value = (label: string) => screen.getByText(label).nextElementSibling?.textContent;

    expect(screen.getByRole("heading", { name: "Initiate landing page" })).toBeTruthy();
    // Mains status first, then the provider's own state when it says more.
    expect(value("Status")).toBe("In review· Doing");
    expect(value("Priority")).toBe("High");
    expect(value("Assignee")).toBe("Okan Bilal Balcı");
    expect(value("Labels")).toBe("Feature");
    expect(value("Due")).toBe("Mar 1 ’25");
    expect(screen.queryByText("Project")).toBeNull();
    expect(screen.getByText("qweqwe")).toBeTruthy();
  });
});
