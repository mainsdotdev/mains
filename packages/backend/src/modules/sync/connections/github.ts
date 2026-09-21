import { Octokit } from "@octokit/rest";

import type {
  EntityInput,
  ResourceFetcher,
  ResourceFetcherArgs,
} from "../sync.dto";
import { normalizeLimit, normalizeDateToIso } from "../sync.connection-utils";

const MAX_ITEMS_PER_PAGE = 100;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
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
    const items = await octokit.issues.listForRepo({
      owner,
      repo,
      state: "open",
      per_page: normalizeLimit(limit, 1, MAX_ITEMS_PER_PAGE),
    });

    const repoId = `${owner}/${repo}`;

    return items.data
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
          labels: extractLabels(i.labels),
          state: i.state,
          assignee: i.assignee?.login || null,
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
