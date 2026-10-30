import type { IssueWithEntity } from "@/lib/redux/api";
import { parseLabels } from "@/lib/label-colors";

/**
 * What the Issues filter menu narrows by. Connection and repository only
 * show without the sidebar (mobile), which owns them on desktop.
 */
export const ISSUE_FACETS = ["status", "priority", "assignee", "labels", "project", "provider", "repo"] as const;
export type IssueFacet = (typeof ISSUE_FACETS)[number];

/** Picked values per facet. Empty means the facet doesn't narrow. */
export type IssueFilters = Record<IssueFacet, string[]>;

export const EMPTY_ISSUE_FILTERS: IssueFilters = {
  status: [],
  priority: [],
  assignee: [],
  labels: [],
  project: [],
  provider: [],
  repo: [],
};

/** The assignee value of an unassigned issue, so "No assignee" can be picked. */
export const NO_ASSIGNEE = "";

/** The values a row has for a facet; priority is its 0–4 level as text. */
export function issueFacetValues(row: IssueWithEntity, facet: IssueFacet): string[] {
  const { issue } = row;
  switch (facet) {
    case "status":
      return [issue.statusId];
    case "priority":
      return [String(issue.priority)];
    case "assignee":
      return [issue.assignee || NO_ASSIGNEE];
    case "labels":
      return parseLabels(issue.labels);
    case "project":
      return issue.groupName ? [issue.groupName] : [];
    case "provider":
      return [issue.provider];
    case "repo":
      return issue.repo ? [issue.repo] : [];
  }
}

/**
 * Any picked value of a facet matches (OR), and every facet has to (AND).
 * `except` leaves one facet out, for that facet's own counts.
 */
export function matchesIssueFilters(row: IssueWithEntity, filters: IssueFilters, except?: IssueFacet): boolean {
  return ISSUE_FACETS.every((facet) => {
    const picked = filters[facet];
    if (facet === except || picked.length === 0) return true;
    return issueFacetValues(row, facet).some((value) => picked.includes(value));
  });
}

/**
 * How many of `rows` carry each value of `facet`, under every other facet's
 * picks — so a count says what picking that value would leave.
 */
export function issueFacetCounts(
  rows: readonly IssueWithEntity[],
  filters: IssueFilters,
  facet: IssueFacet,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!matchesIssueFilters(row, filters, facet)) continue;
    for (const value of issueFacetValues(row, facet)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return counts;
}

export function toggleIssueFilter(filters: IssueFilters, facet: IssueFacet, value: string): IssueFilters {
  const picked = filters[facet];
  return {
    ...filters,
    [facet]: picked.includes(value) ? picked.filter((v) => v !== value) : [...picked, value],
  };
}

export function countIssueFilters(filters: IssueFilters): number {
  return ISSUE_FACETS.reduce((total, facet) => total + filters[facet].length, 0);
}

/**
 * Quick views over the open inbox, Linear-style chips beside the filter
 * button. They narrow before the filter menu, like the sidebar scope does.
 */
export const ISSUE_VIEWS = [
  { value: "all", label: "All issues" },
  { value: "active", label: "Active" },
  { value: "backlog", label: "Backlog" },
] as const;
export type IssueView = (typeof ISSUE_VIEWS)[number]["value"];

/** Active is everything open that has left the backlog. */
export function matchesIssueView(row: IssueWithEntity, view: IssueView): boolean {
  if (view === "active") return row.issue.statusId !== "backlog";
  if (view === "backlog") return row.issue.statusId === "backlog";
  return true;
}

/** The search box: title, identifier (rows don't show it), repo, labels or number. */
export function matchesIssueText(row: IssueWithEntity, text: string): boolean {
  const query = text.trim().toLowerCase();
  if (!query) return true;
  const { issue, entity } = row;
  return (
    (entity.title ?? "").toLowerCase().includes(query) ||
    (issue.identifier ?? "").toLowerCase().includes(query) ||
    (issue.repo ?? "").toLowerCase().includes(query) ||
    (issue.labels ?? "").toLowerCase().includes(query) ||
    (issue.number != null && String(issue.number).includes(query))
  );
}
