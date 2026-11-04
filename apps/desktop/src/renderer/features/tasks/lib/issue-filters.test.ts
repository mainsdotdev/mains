import { describe, expect, it } from "vitest";
import type { IssueWithEntity } from "@/lib/redux/api";
import {
  countIssueFilters,
  EMPTY_ISSUE_FILTERS,
  issueFacetCounts,
  matchesIssueFilters,
  matchesIssueText,
  matchesIssueView,
  NO_ASSIGNEE,
  toggleIssueFilter,
} from "./issue-filters";

function row(id: string, issue: Partial<IssueWithEntity["issue"]> = {}, title = id): IssueWithEntity {
  return {
    issue: {
      entityId: id,
      provider: "linear",
      statusId: "todo",
      priority: 0,
      assignee: null,
      labels: null,
      groupName: null,
      repo: null,
      identifier: null,
      number: null,
      ...issue,
    },
    entity: { id, title },
  } as IssueWithEntity;
}

const rows = [
  row("a", { statusId: "todo", labels: JSON.stringify(["Bug"]), assignee: "Okan", priority: 1 }),
  row("b", { statusId: "todo", labels: JSON.stringify(["Feature"]) }),
  row("c", { statusId: "in_progress", labels: JSON.stringify(["Bug", "Feature"]), assignee: "Okan" }),
];

describe("matchesIssueFilters", () => {
  it("ORs values inside a facet and ANDs facets", () => {
    const filters = { ...EMPTY_ISSUE_FILTERS, labels: ["Bug", "Feature"], status: ["todo"] };
    expect(rows.filter((r) => matchesIssueFilters(r, filters)).map((r) => r.issue.entityId)).toEqual(["a", "b"]);
  });

  it("can pick unassigned issues", () => {
    const filters = { ...EMPTY_ISSUE_FILTERS, assignee: [NO_ASSIGNEE] };
    expect(rows.filter((r) => matchesIssueFilters(r, filters)).map((r) => r.issue.entityId)).toEqual(["b"]);
  });
});

describe("issueFacetCounts", () => {
  it("counts a facet under the other facets' picks, never its own", () => {
    const filters = { ...EMPTY_ISSUE_FILTERS, status: ["todo"], labels: ["Bug"] };
    // Status counts ignore the status pick but honor the Bug label.
    expect(issueFacetCounts(rows, filters, "status")).toEqual(new Map([["todo", 1], ["in_progress", 1]]));
    // Label counts ignore the Bug pick but honor Todo.
    expect(issueFacetCounts(rows, filters, "labels")).toEqual(new Map([["Bug", 1], ["Feature", 1]]));
    expect(issueFacetCounts(rows, filters, "priority")).toEqual(new Map([["1", 1]]));
  });
});

describe("toggleIssueFilter / countIssueFilters", () => {
  it("adds and removes a value", () => {
    const once = toggleIssueFilter(EMPTY_ISSUE_FILTERS, "labels", "Bug");
    expect(once.labels).toEqual(["Bug"]);
    expect(countIssueFilters(once)).toBe(1);
    expect(toggleIssueFilter(once, "labels", "Bug").labels).toEqual([]);
  });
});

describe("matchesIssueText", () => {
  it("finds an issue by the identifier rows no longer show", () => {
    const issue = row("x", { identifier: "MAI-200" }, "Windows & Linux");
    expect(matchesIssueText(issue, "mai-200")).toBe(true);
    expect(matchesIssueText(issue, "linux")).toBe(true);
    expect(matchesIssueText(issue, "  ")).toBe(true);
    expect(matchesIssueText(issue, "mac")).toBe(false);
  });
});

describe("matchesIssueView", () => {
  it("splits the open inbox into active work and backlog", () => {
    const backlog = row("b", { statusId: "backlog" });
    const review = row("r", { statusId: "in_review" });
    expect(matchesIssueView(backlog, "all") && matchesIssueView(review, "all")).toBe(true);
    expect(matchesIssueView(backlog, "active")).toBe(false);
    expect(matchesIssueView(review, "active")).toBe(true);
    expect(matchesIssueView(backlog, "backlog")).toBe(true);
    expect(matchesIssueView(review, "backlog")).toBe(false);
  });
});
