import type { IssueWithEntity } from "@/lib/redux/api";

export type TasksTab = "issues" | "pull_requests";

/**
 * What the /tasks sidebar has selected: one connection (`provider`), and
 * optionally one of its linked resources (a repo, team, project, board).
 * `resourceId` is the `connection_resources` row id — the same value every
 * sync fetcher stamps on `entity.resourceId`, so it works for providers whose
 * `issue.repo` is empty or not human-readable (GitLab, Asana, Trello).
 */
export interface TasksScope {
  provider: string | null;
  resourceId: string | null;
}

export const ALL_SCOPE: TasksScope = { provider: null, resourceId: null };

/** Providers the PR inbox can search. GitLab/Bitbucket join with their PrSource. */
const PR_PROVIDERS: readonly string[] = ["github"];

export function supportsPullRequests(provider: string): boolean {
  return PR_PROVIDERS.includes(provider);
}

/**
 * Providers whose users define their own workflow states, which can be mapped
 * onto Mains statuses (their fetchers implement `listStates`). GitHub and
 * GitLab only have open/closed.
 */
const STATUS_MAPPING_PROVIDERS: readonly string[] = ["linear", "jira", "trello", "asana"];

export function supportsStatusMapping(provider: string): boolean {
  return STATUS_MAPPING_PROVIDERS.includes(provider);
}

/**
 * A scope the tab cannot show falls back to "all" rather than rendering an
 * empty list for a provider that has no pull requests to search.
 */
export function scopeForTab(scope: TasksScope, tab: TasksTab): TasksScope {
  if (tab === "pull_requests" && scope.provider && !supportsPullRequests(scope.provider)) {
    return ALL_SCOPE;
  }
  return scope;
}

export function readTasksLocation(params: URLSearchParams): {
  tab: TasksTab;
  scope: TasksScope;
} {
  const tab: TasksTab = params.get("tab") === "pull_requests" ? "pull_requests" : "issues";
  const provider = params.get("provider") || null;
  // A resource only means something under its provider.
  const resourceId = provider ? params.get("resource") || null : null;
  return { tab, scope: scopeForTab({ provider, resourceId }, tab) };
}

/** Defaults are omitted so the plain `/tasks` URL stays the "all issues" view. */
export function tasksLocationParams(tab: TasksTab, scope: TasksScope): URLSearchParams {
  const params = new URLSearchParams();
  if (tab !== "issues") params.set("tab", tab);
  if (scope.provider) {
    params.set("provider", scope.provider);
    if (scope.resourceId) params.set("resource", scope.resourceId);
  }
  return params;
}

/**
 * Display name of a linked resource as `getSelectedResources` returns it —
 * the shape differs per provider (`fullName` for GitHub, `key` for Linear/Jira),
 * only `name` is common.
 */
export function resourceLabel(item: Record<string, unknown>): string {
  return String(item.fullName ?? item.name ?? item.key ?? "");
}

export function matchesIssueScope(row: IssueWithEntity, scope: TasksScope): boolean {
  if (scope.provider && row.issue.provider !== scope.provider) return false;
  if (scope.resourceId && row.entity.resourceId !== scope.resourceId) return false;
  return true;
}

export interface IssueScopeCounts {
  total: number;
  byProvider: Map<string, number>;
  byResource: Map<string, number>;
}

export function issueScopeCounts(rows: readonly IssueWithEntity[]): IssueScopeCounts {
  const byProvider = new Map<string, number>();
  const byResource = new Map<string, number>();
  for (const row of rows) {
    byProvider.set(row.issue.provider, (byProvider.get(row.issue.provider) ?? 0) + 1);
    const resourceId = row.entity.resourceId;
    if (resourceId) byResource.set(resourceId, (byResource.get(resourceId) ?? 0) + 1);
  }
  return { total: rows.length, byProvider, byResource };
}
