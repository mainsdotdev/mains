/**
 * Jira Connection Fetcher
 *
 * Fetches issues from Jira Cloud using REST API v3.
 * Authentication uses Basic auth with email:api_token.
 *
 * Jira-specific assumptions:
 * - Uses Jira Cloud REST API v3 (https://{domain}.atlassian.net/rest/api/3/)
 * - Credentials stored as: secrets.apiToken; metadata = { domain, email }
 * - Projects are stored as connectionResources with kind = "jira_project"
 * - Issues are normalized to EntityInput with provider = "jira"
 */

import type {
  EntityInput,
  ResourceFetcher,
  ResourceFetcherArgs,
} from "../sync.dto";
import { collectPages, normalizeLimit, normalizeDateToIso } from "../sync.connection-utils";
import { statusFromJiraCategory } from "../sync.issue-status";
import { priorityFromName } from "../sync.issue-display";

const MAX_ITEMS_PER_PAGE = 100;

/** The order Jira's boards show status categories in. */
const JIRA_CATEGORY_ORDER = ["new", "indeterminate", "done"];

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: {
    summary: string;
    description?: string | null | Record<string, unknown>;
    status: {
      id?: string;
      name: string;
      statusCategory?: { key: string };
    };
    issuetype: { name: string; iconUrl?: string };
    priority?: { id: string; name: string };
    assignee?: {
      displayName: string;
      emailAddress?: string;
      avatarUrls?: Record<string, string>;
    } | null;
    reporter?: { displayName: string };
    labels?: string[];
    created: string;
    updated: string;
    duedate?: string | null;
    resolutiondate?: string | null;
    project: { key: string; name: string };
    parent?: { fields?: { summary?: string; issuetype?: { name?: string } } } | null;
  };
}

/** The epic an issue sits under — Jira's grouping above it. A sub-task's parent is no group. */
function epicOf(issue: JiraIssue): { name: string; color: null } | null {
  const parent = issue.fields.parent?.fields;
  return parent?.summary && parent.issuetype?.name === "Epic"
    ? { name: parent.summary, color: null }
    : null;
}

interface JiraSearchResponse {
  issues: JiraIssue[];
  nextPageToken?: string;
  isLast?: boolean;
}

/**
 * A relative JQL date ("-90m"). An absolute one would be read in the Jira
 * user's timezone, which we don't know.
 */
function minutesAgo(since: Date): string {
  return `-${Math.max(1, Math.ceil((Date.now() - since.getTime()) / 60_000))}m`;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string;
  avatarUrls?: { "48x48"?: string };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function buildBaseUrl(domain: string): string {
  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${cleanDomain}/rest/api/3`;
}

function buildAuthHeader(email: string, token: string): string {
  const credentials = Buffer.from(`${email}:${token}`).toString("base64");
  return `Basic ${credentials}`;
}

function extractTextFromADF(adfContent: unknown): string {
  if (!adfContent || typeof adfContent !== "object") return "";
  const adf = adfContent as Record<string, unknown>;

  if (adf.type === "doc" && Array.isArray(adf.content)) {
    return adf.content.map((node) => extractTextFromADF(node)).join("\n");
  }
  if (adf.type === "paragraph" && Array.isArray(adf.content)) {
    return adf.content
      .map((node) => {
        if (typeof node === "object" && node !== null) {
          const tn = node as Record<string, unknown>;
          if (tn.type === "text" && typeof tn.text === "string") return tn.text;
        }
        return "";
      })
      .join("");
  }
  if (adf.type === "text" && typeof adf.text === "string") return adf.text;
  return "";
}

function getJiraCreds(
  secrets: Record<string, string>,
  metadata: Record<string, unknown>,
): { token: string; domain: string; email: string } | null {
  const token = secrets.apiToken;
  const domain = metadata.domain as string | undefined;
  const email = metadata.email as string | undefined;
  if (!token || !domain || !email) return null;
  return { token, domain, email };
}

// ─────────────────────────────────────────────────────────────
// Public helper (still used by the connections module to list projects)
// ─────────────────────────────────────────────────────────────
export async function fetchJiraProjects(
  domain: string,
  email: string,
  token: string,
): Promise<JiraProject[]> {
  const baseUrl = buildBaseUrl(domain);
  const authHeader = buildAuthHeader(email, token);
  const response = await fetch(`${baseUrl}/project/search?maxResults=100`, {
    headers: { Authorization: authHeader, Accept: "application/json" },
  });
  if (!response.ok) {
    const error = await response.text();
    console.error(`Jira API error (${response.status}):`, error);
    throw new Error(`Jira API error: ${response.status}`);
  }
  const data = (await response.json()) as { values?: JiraProject[] };
  return data.values || [];
}

// ─────────────────────────────────────────────────────────────
// Fetcher
// ─────────────────────────────────────────────────────────────
export const jiraIssuesFetcher: ResourceFetcher = {
  id: "jira:issues",
  provider: "jira",
  resourceKind: "jira_project",
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
    const creds = getJiraCreds(secrets, metadata);
    if (!creds) throw new Error("Jira connection is missing its domain, email or API token");

    const { token, domain, email } = creds;
    const projectKey = resource.externalId;
    const baseUrl = buildBaseUrl(domain);
    const authHeader = buildAuthHeader(email, token);
    const jql = `project = "${projectKey}" AND ${
      since ? `updated >= ${minutesAgo(since)}` : "resolution = Unresolved"
    } ORDER BY updated DESC`;

    const issues = await collectPages<JiraIssue, string | undefined>(
      limit,
      undefined,
      async (nextPageToken, pageSize) => {
        const response = await fetch(`${baseUrl}/search/jql`, {
          method: "POST",
          headers: {
            Authorization: authHeader,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            jql,
            maxResults: normalizeLimit(pageSize, 1, MAX_ITEMS_PER_PAGE),
            ...(nextPageToken ? { nextPageToken } : {}),
            fields: [
              "summary",
              "description",
              "status",
              "issuetype",
              "priority",
              "assignee",
              "reporter",
              "labels",
              "created",
              "updated",
              "duedate",
              "resolutiondate",
              "project",
              "parent",
            ],
          }),
        });

        if (!response.ok) {
          const error = await response.text();
          console.error(`Jira API error (${response.status}):`, error);
          throw new Error(`Jira API error: ${response.status}`);
        }

        const data = (await response.json()) as JiraSearchResponse;
        return {
          items: data.issues,
          next: !data.isLast && data.nextPageToken ? data.nextPageToken : null,
        };
      },
    );

    return issues.map((issue): EntityInput => {
      let description: string | null = null;
      if (issue.fields.description) {
        description =
          typeof issue.fields.description === "string"
            ? issue.fields.description
            : extractTextFromADF(issue.fields.description);
      }

      const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
      const issueUrl = `https://${cleanDomain}/browse/${issue.key}`;

      return {
        kind: "issue",
        title: issue.fields.summary,
        url: issueUrl,
        body: description,
        summary: description?.substring(0, 500) || null,
        occurredAt: normalizeDateToIso(issue.fields.created),
        externalId: issue.key,
        connectionId,
        resourceId: resource.id,
        metadata: {
          provider: "jira",
          key: issue.key,
          id: issue.id,
          projectKey: issue.fields.project.key,
          projectName: issue.fields.project.name,
          repo: issue.fields.project.key,
          number: parseInt(issue.key.split("-")[1], 10) || 0,
          state: issue.fields.status.name,
          status: issue.fields.status.name,
          statusCategory: issue.fields.status.statusCategory?.key || null,
          stateId: issue.fields.status.id ?? null,
          statusId: statusFromJiraCategory(
            issue.fields.status.statusCategory?.key,
            issue.fields.status.name,
          ),
          type: issue.fields.issuetype.name,
          priority: issue.fields.priority?.name || null,
          priorityId: issue.fields.priority?.id || null,
          identifier: issue.key,
          assignee: issue.fields.assignee?.displayName || null,
          assigneeAvatarUrl: issue.fields.assignee?.avatarUrls?.["48x48"] ?? null,
          // `priority` stays the name Jira shows; the level is the shared scale.
          priorityLevel: priorityFromName(issue.fields.priority?.name),
          group: epicOf(issue),
          dueAt: issue.fields.duedate || null,
          reporter: issue.fields.reporter?.displayName || null,
          labels: issue.fields.labels || [],
          url: issueUrl,
          updatedAt: issue.fields.updated
            ? new Date(issue.fields.updated).toISOString()
            : null,
          dueDate: issue.fields.duedate || null,
          closedAt: issue.fields.resolutiondate || null,
        },
      };
    });
  },

  async listStates({ resource, secrets, metadata }) {
    const creds = getJiraCreds(secrets, metadata);
    if (!creds) throw new Error("Jira connection is missing its domain, email or API token");

    // Statuses come per issue type; the same status shows up under several.
    const response = await fetch(
      `${buildBaseUrl(creds.domain)}/project/${encodeURIComponent(resource.externalId)}/statuses`,
      {
        headers: {
          Authorization: buildAuthHeader(creds.email, creds.token),
          Accept: "application/json",
        },
      },
    );
    if (!response.ok) {
      const error = await response.text();
      console.error(`Jira API error (${response.status}):`, error);
      throw new Error(`Jira API error: ${response.status}`);
    }

    const issueTypes = (await response.json()) as Array<{
      statuses: Array<{ id: string; name: string; statusCategory?: { key: string } }>;
    }>;
    const byId = new Map<string, { id: string; name: string; category: string | null }>();
    for (const issueType of issueTypes) {
      for (const status of issueType.statuses) {
        if (!byId.has(status.id)) {
          byId.set(status.id, { ...status, category: status.statusCategory?.key ?? null });
        }
      }
    }
    const rank = (category: string | null) => {
      const index = JIRA_CATEGORY_ORDER.indexOf(category ?? "");
      return index === -1 ? JIRA_CATEGORY_ORDER.length : index;
    };
    return [...byId.values()]
      .sort((a, b) => rank(a.category) - rank(b.category))
      .map((status) => ({
        id: status.id,
        name: status.name,
        color: null,
        defaultStatusId: statusFromJiraCategory(status.category, status.name),
      }));
  },
};
