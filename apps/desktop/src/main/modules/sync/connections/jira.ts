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
import { normalizeLimit, normalizeDateToIso } from "../sync.connection-utils";

const MAX_ITEMS_PER_PAGE = 100;
const DEFAULT_LIMIT = 50;

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
      name: string;
      statusCategory?: { key: string };
    };
    issuetype: { name: string; iconUrl?: string };
    priority?: { id: string; name: string };
    assignee?: { displayName: string; emailAddress?: string } | null;
    reporter?: { displayName: string };
    labels?: string[];
    created: string;
    updated: string;
    duedate?: string | null;
    project: { key: string; name: string };
  };
}

interface JiraSearchResponse {
  issues: JiraIssue[];
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
  defaultLimit: DEFAULT_LIMIT,

  async fetchForResource({
    resource,
    secrets,
    metadata,
    limit,
    connectionId,
  }: ResourceFetcherArgs): Promise<EntityInput[]> {
    const creds = getJiraCreds(secrets, metadata);
    if (!creds) {
      console.warn("⚠️  Jira connection missing domain/email/apiToken");
      return [];
    }

    const { token, domain, email } = creds;
    const projectKey = resource.externalId;
    const baseUrl = buildBaseUrl(domain);
    const authHeader = buildAuthHeader(email, token);
    const jql = `project = "${projectKey}" AND resolution = Unresolved ORDER BY updated DESC`;

    const response = await fetch(`${baseUrl}/search/jql`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jql,
        maxResults: normalizeLimit(limit, 1, MAX_ITEMS_PER_PAGE),
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
          "project",
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Jira API error (${response.status}):`, error);
      return [];
    }

    const data = (await response.json()) as JiraSearchResponse;

    return data.issues.map((issue): EntityInput => {
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
          type: issue.fields.issuetype.name,
          priority: issue.fields.priority?.name || null,
          priorityId: issue.fields.priority?.id || null,
          assignee: issue.fields.assignee?.displayName || null,
          reporter: issue.fields.reporter?.displayName || null,
          labels: issue.fields.labels || [],
          url: issueUrl,
          updatedAt: issue.fields.updated
            ? new Date(issue.fields.updated).toISOString()
            : null,
          dueDate: issue.fields.duedate || null,
        },
      };
    });
  },
};
