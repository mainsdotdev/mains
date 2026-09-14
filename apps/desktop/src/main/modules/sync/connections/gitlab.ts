import type {
  EntityInput,
  ResourceFetcher,
  ResourceFetcherArgs,
} from "../sync.dto";
import { normalizeLimit, normalizeDateToIso } from "../sync.connection-utils";

const MAX_ITEMS_PER_PAGE = 100;
const DEFAULT_DOMAIN = "gitlab.com";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function getBaseUrl(domain: string): string {
  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${cleanDomain}/api/v4`;
}

function extractLabels(labels: unknown): string[] {
  if (!Array.isArray(labels)) return [];
  return labels.filter((s): s is string => typeof s === "string");
}

/**
 * Rewrite relative GitLab image/file URLs to absolute and strip GitLab's
 * `{width=... height=...}` size annotations so markdown renders correctly.
 */
function resolveGitlabBody(
  body: string | null,
  domain: string,
  projectId: string,
): string | null {
  if (!body) return null;
  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return body.replace(
    /!\[([^\]]*)\]\((\/uploads\/[^)]+)\)(\{[^}]*\})?/g,
    (_match, alt, path) =>
      `![${alt}](https://${cleanDomain}/-/project/${projectId}${path})`,
  );
}

function requireToken(secrets: Record<string, string>): string | null {
  return secrets.token || null;
}

function getDomain(metadata: Record<string, unknown>): string {
  return (metadata.domain as string) || DEFAULT_DOMAIN;
}

// ─────────────────────────────────────────────────────────────
// Fetchers
// ─────────────────────────────────────────────────────────────
export const gitlabIssuesFetcher: ResourceFetcher = {
  id: "gitlab:issues",
  provider: "gitlab",
  resourceKind: "gitlab_project",
  defaultLimit: 50,

  async fetchForResource({
    resource,
    secrets,
    metadata,
    limit,
    connectionId,
  }: ResourceFetcherArgs): Promise<EntityInput[]> {
    const token = requireToken(secrets);
    if (!token) return [];

    const domain = getDomain(metadata);
    const projectId = resource.externalId;
    const perPage = normalizeLimit(limit, 1, MAX_ITEMS_PER_PAGE);

    const response = await fetch(
      `${getBaseUrl(domain)}/projects/${encodeURIComponent(projectId)}/issues?state=opened&per_page=${perPage}`,
      {
        headers: { "PRIVATE-TOKEN": token, Accept: "application/json" },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`GitLab API error (${response.status}):`, errorText);
      return [];
    }

    const issues = (await response.json()) as Array<Record<string, unknown>>;

    return issues.map((issue): EntityInput => {
      const resolvedBody = resolveGitlabBody(
        (issue.description as string | null) ?? null,
        domain,
        projectId,
      );
      const description = issue.description as string | null | undefined;

      return {
        kind: "issue",
        title: issue.title as string,
        url: issue.web_url as string,
        body: resolvedBody,
        summary: description?.substring(0, 500) || null,
        occurredAt: normalizeDateToIso(issue.created_at as string),
        externalId: `gitlab:${projectId}#${issue.iid}`,
        connectionId,
        resourceId: resource.id,
        metadata: {
          provider: "gitlab",
          iid: issue.iid as number,
          projectId,
          labels: extractLabels(issue.labels),
          state: issue.state as string,
          assignee:
            (issue.assignee as { username?: string } | null)?.username || null,
        },
      };
    });
  },
};

export const gitlabMergeRequestsFetcher: ResourceFetcher = {
  id: "gitlab:merge_requests",
  provider: "gitlab",
  resourceKind: "gitlab_project",
  defaultLimit: 50,

  async fetchForResource({
    resource,
    secrets,
    metadata,
    limit,
    connectionId,
  }: ResourceFetcherArgs): Promise<EntityInput[]> {
    const token = requireToken(secrets);
    if (!token) return [];

    const domain = getDomain(metadata);
    const projectId = resource.externalId;
    const perPage = normalizeLimit(limit, 1, MAX_ITEMS_PER_PAGE);

    const response = await fetch(
      `${getBaseUrl(domain)}/projects/${encodeURIComponent(projectId)}/merge_requests?state=opened&per_page=${perPage}`,
      {
        headers: { "PRIVATE-TOKEN": token, Accept: "application/json" },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`GitLab API error (${response.status}):`, errorText);
      return [];
    }

    const mergeRequests = (await response.json()) as Array<
      Record<string, unknown>
    >;

    return mergeRequests.map((mr): EntityInput => {
      const resolvedBody = resolveGitlabBody(
        (mr.description as string | null) ?? null,
        domain,
        projectId,
      );
      const description = mr.description as string | null | undefined;

      return {
        kind: "merge_request",
        title: mr.title as string,
        url: mr.web_url as string,
        body: resolvedBody,
        summary: description?.substring(0, 500) || null,
        occurredAt: normalizeDateToIso(mr.created_at as string),
        externalId: `gitlab:${projectId}!${mr.iid}`,
        connectionId,
        resourceId: resource.id,
        metadata: {
          provider: "gitlab",
          iid: mr.iid as number,
          projectId,
          labels: extractLabels(mr.labels),
          state: mr.state as string,
          draft: (mr.draft as boolean | undefined) ?? false,
          assignee:
            (mr.assignee as { username?: string } | null)?.username || null,
        },
      };
    });
  },
};
