import { Octokit } from "@octokit/rest";

import type {
  EntityInput,
  ResourceFetcher,
  ResourceFetcherArgs,
} from "../sync.dto";
import { collectPages, normalizeLimit, normalizeDateToIso } from "../sync.connection-utils";
import { statusFromOpenClosed } from "../sync.issue-status";
import { labelColorMap } from "../sync.issue-display";

const MAX_ITEMS_PER_PAGE = 100;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
/** The issue's labels that carry a color (the API gives plain strings for some). */
function labelObjects(labels: unknown): Array<{ name?: string | null; color?: string | null }> {
  if (!Array.isArray(labels)) return [];
  return labels.filter((l): l is { name?: string; color?: string } => typeof l === "object" && l !== null);
}

function extractLabels(labels: unknown): string[] {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((l) => (typeof l === "string" ? l : (l as { name?: string })?.name))
    .filter((s): s is string => typeof s === "string");
}

function parseRepoIdentifier(
  identifier: string,
): { owner: string; repo: string } | null {
  const parts = identifier.split("/");
  if (parts.length !== 2) return null;
  return { owner: parts[0], repo: parts[1] };
}

function requireToken(secrets: Record<string, string>): string | null {
  return secrets.token || null;
}

// ─────────────────────────────────────────────────────────────
// Fetchers
// ─────────────────────────────────────────────────────────────
export const githubIssuesFetcher: ResourceFetcher = {
  id: "github:issues",
  provider: "github",
  resourceKind: "github_repo",
  defaultLimit: 1000,
  incremental: true,

  async fetchForResource({
    resource,
    secrets,
    limit,
    connectionId,
    since,
  }: ResourceFetcherArgs): Promise<EntityInput[]> {
    const token = requireToken(secrets);
    if (!token) throw new Error("GitHub connection has no token");

    const parsed = parseRepoIdentifier(resource.externalId);
    if (!parsed) throw new Error(`Not an owner/repo identifier: ${resource.externalId}`);
    const { owner, repo } = parsed;

    const octokit = new Octokit({ auth: token });
    // Page numbers index fixed-size pages, so the size can't shrink per page.
    const perPage = normalizeLimit(limit, 1, MAX_ITEMS_PER_PAGE);
    // `since` filters on update time; with it, closed issues come back too.
    const items = await collectPages(limit, 1, async (page) => {
      const response = await octokit.issues.listForRepo({
        owner,
        repo,
        state: since ? "all" : "open",
        ...(since ? { since: since.toISOString() } : {}),
        per_page: perPage,
        page,
      });
      return {
        items: response.data,
        next: response.data.length < perPage ? null : page + 1,
      };
    });

    const repoId = `${owner}/${repo}`;

    // The issues endpoint lists pull requests too.
    return items
      .filter((i) => !i.pull_request)
      .map((i): EntityInput => ({
        kind: "issue",
        title: i.title,
        url: i.html_url,
        body: i.body || null,
        summary: i.body?.substring(0, 500) || null,
        occurredAt: normalizeDateToIso(i.created_at),
        externalId: `${repoId}#${i.number}`,
        connectionId,
        resourceId: resource.id,
        metadata: {
          provider: "github",
          number: i.number,
          repo: repoId,
          identifier: `#${i.number}`,
          labels: extractLabels(i.labels),
          labelColors: labelColorMap(labelObjects(i.labels)),
          state: i.state,
          stateId: i.state,
          statusId: statusFromOpenClosed(i.state, i.state_reason),
          closedAt: i.closed_at ?? null,
          assignee: i.assignee?.login || null,
          assigneeAvatarUrl: i.assignee?.avatar_url ?? null,
          group: i.milestone ? { name: i.milestone.title, color: null } : null,
        },
      }));
  },
};

export const githubPullRequestsFetcher: ResourceFetcher = {
  id: "github:pull_requests",
  provider: "github",
  resourceKind: "github_repo",
  defaultLimit: 50,

  async fetchForResource({
    resource,
    secrets,
    limit,
    connectionId,
  }: ResourceFetcherArgs): Promise<EntityInput[]> {
    const token = requireToken(secrets);
    if (!token) return [];

    const parsed = parseRepoIdentifier(resource.externalId);
    if (!parsed) return [];
    const { owner, repo } = parsed;

    const octokit = new Octokit({ auth: token });
    const items = await octokit.pulls.list({
      owner,
      repo,
      state: "open",
      per_page: normalizeLimit(limit, 1, MAX_ITEMS_PER_PAGE),
    });

    const repoId = `${owner}/${repo}`;

    return items.data.map((pr): EntityInput => ({
      kind: "pull_request",
      title: pr.title,
      url: pr.html_url,
      body: pr.body || null,
      summary: pr.body?.substring(0, 500) || null,
      occurredAt: normalizeDateToIso(pr.created_at),
      externalId: `${repoId}#${pr.number}`,
      connectionId,
      resourceId: resource.id,
      metadata: {
        provider: "github",
        number: pr.number,
        repo: repoId,
        labels: extractLabels(pr.labels),
        state: pr.state,
        draft: pr.draft ?? false,
      },
    }));
  },
};
