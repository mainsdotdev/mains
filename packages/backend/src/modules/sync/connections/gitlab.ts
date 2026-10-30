import type {
  EntityInput,
  ResourceFetcher,
  ResourceFetcherArgs,
} from "../sync.dto";
import { collectPages, normalizeLimit, normalizeDateToIso } from "../sync.connection-utils";
import { statusFromOpenClosed } from "../sync.issue-status";
import { labelColorMap } from "../sync.issue-display";

const MAX_ITEMS_PER_PAGE = 100;
const DEFAULT_DOMAIN = "gitlab.com";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function getBaseUrl(domain: string): string {
  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${cleanDomain}/api/v4`;
}

/** Label names — plain strings, or `{ name, color }` with `with_labels_details`. */
function extractLabels(labels: unknown): string[] {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((l) => (typeof l === "string" ? l : (l as { name?: string })?.name))
    .filter((s): s is string => typeof s === "string");
}

function labelObjects(labels: unknown): Array<{ name?: string | null; color?: string | null }> {
  if (!Array.isArray(labels)) return [];
  return labels.filter((l): l is { name?: string; color?: string } => typeof l === "object" && l !== null);
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
  defaultLimit: 1000,
  incremental: true,

  async fetchForResource({
    resource,
    secrets,
    metadata,
    limit,
    connectionId,
    since,
  }: ResourceFetcherArgs): Promise<EntityInput[]> {
    const token = requireToken(secrets);
    if (!token) throw new Error("GitLab connection has no token");

    const domain = getDomain(metadata);
    const projectId = resource.externalId;
    // Page numbers index fixed-size pages, so the size can't shrink per page.
    const perPage = normalizeLimit(limit, 1, MAX_ITEMS_PER_PAGE);
    // With `since`, every state — so closed issues come back.
    const filter = since
      ? `state=all&updated_after=${encodeURIComponent(since.toISOString())}`
      : "state=opened";
    // Label objects carry their colors; plain names don't.
    const query = `${filter}&with_labels_details=true`;

    const issues = await collectPages(limit, 1, async (page) => {
      const response = await fetch(
        `${getBaseUrl(domain)}/projects/${encodeURIComponent(projectId)}/issues?${query}&per_page=${perPage}&page=${page}`,
        {
          headers: { "PRIVATE-TOKEN": token, Accept: "application/json" },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`GitLab API error (${response.status}):`, errorText);
        throw new Error(`GitLab API error: ${response.status}`);
      }

      const items = (await response.json()) as Array<Record<string, unknown>>;
      return { items, next: items.length < perPage ? null : page + 1 };
    });

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
          identifier: `#${issue.iid}`,
          labels: extractLabels(issue.labels),
          labelColors: labelColorMap(labelObjects(issue.labels)),
          state: issue.state as string,
          stateId: issue.state as string,
          statusId: statusFromOpenClosed(issue.state as string),
          closedAt: (issue.closed_at as string | null) ?? null,
          assignee:
            (issue.assignee as { username?: string } | null)?.username || null,
          assigneeAvatarUrl:
            (issue.assignee as { avatar_url?: string } | null)?.avatar_url ?? null,
          group: (issue.milestone as { title?: string } | null)?.title
            ? { name: (issue.milestone as { title: string }).title, color: null }
            : null,
          dueAt: (issue.due_date as string | null) ?? null,
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
