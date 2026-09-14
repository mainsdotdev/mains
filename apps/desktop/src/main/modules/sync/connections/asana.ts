/**
 * Asana Connection Fetcher
 *
 * Fetches tasks from Asana using REST API v1.0.
 * Authentication uses a Personal Access Token (PAT).
 *
 * Asana-specific assumptions:
 * - secrets.accessToken = PAT
 * - Projects are stored as connectionResources with kind = "asana_project"
 * - Tasks are normalized to EntityInput with provider = "asana" and kind = "issue"
 */

import type {
  EntityInput,
  ResourceFetcher,
  ResourceFetcherArgs,
} from "../sync.dto";
import { normalizeLimit, normalizeDateToIso } from "../sync.connection-utils";

const ASANA_BASE_URL = "https://app.asana.com/api/1.0";
const MAX_ITEMS_PER_PAGE = 100;
const DEFAULT_LIMIT = 50;

// ─────────────────────────────────────────────────────────────
// Types (kept here for the asana_project sync flow + the
// connections module's list-projects helper)
// ─────────────────────────────────────────────────────────────

interface AsanaTask {
  gid: string;
  name: string;
  notes: string | null;
  permalink_url: string;
  created_at: string;
  modified_at: string;
  completed: boolean;
  completed_at: string | null;
  due_on: string | null;
  due_at: string | null;
  assignee: { gid: string; name: string } | null;
  projects: Array<{ gid: string; name: string }>;
  workspace: { gid: string; name: string };
  tags: Array<{ gid: string; name: string }>;
}

interface AsanaTasksResponse {
  data: AsanaTask[];
}

export interface AsanaProjectInfo {
  gid: string;
  name: string;
  archived: boolean;
  color: string | null;
  created_at: string;
  modified_at: string;
  workspace: { gid: string; name: string };
  team?: { gid: string; name: string } | null;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function buildAuthHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: "application/json" };
}

// ─────────────────────────────────────────────────────────────
// Public list-projects helper (used by the connections module)
// ─────────────────────────────────────────────────────────────

export async function fetchAsanaWorkspaces(
  token: string,
): Promise<Array<{ gid: string; name: string }>> {
  const response = await fetch(`${ASANA_BASE_URL}/workspaces`, {
    headers: buildAuthHeaders(token),
  });
  if (!response.ok) {
    const error = await response.text();
    console.error(`Asana API error (${response.status}):`, error);
    throw new Error(`Asana API error: ${response.status}`);
  }
  const data = (await response.json()) as { data?: Array<{ gid: string; name: string }> };
  return data.data || [];
}

export async function fetchAsanaProjects(
  token: string,
  workspaceGid?: string,
): Promise<AsanaProjectInfo[]> {
  let url = `${ASANA_BASE_URL}/projects?opt_fields=gid,name,archived,color,created_at,modified_at,workspace.gid,workspace.name,team.gid,team.name&limit=100`;
  if (workspaceGid) url += `&workspace=${workspaceGid}`;

  const response = await fetch(url, { headers: buildAuthHeaders(token) });
  if (!response.ok) {
    const error = await response.text();
    console.error(`Asana API error (${response.status}):`, error);
    throw new Error(`Asana API error: ${response.status}`);
  }
  const data = (await response.json()) as { data?: AsanaProjectInfo[] };
  return (data.data || []).filter((p) => !p.archived);
}

// ─────────────────────────────────────────────────────────────
// Fetcher
// ─────────────────────────────────────────────────────────────

export const asanaTasksFetcher: ResourceFetcher = {
  id: "asana:tasks",
  provider: "asana",
  resourceKind: "asana_project",
  defaultLimit: DEFAULT_LIMIT,

  async fetchForResource({
    resource,
    secrets,
    limit,
    connectionId,
  }: ResourceFetcherArgs): Promise<EntityInput[]> {
    const token = secrets.accessToken;
    if (!token) return [];

    const projectGid = resource.externalId;
    const normalizedLimit = normalizeLimit(limit, 1, MAX_ITEMS_PER_PAGE);

    const optFields = [
      "gid",
      "name",
      "notes",
      "permalink_url",
      "created_at",
      "modified_at",
      "completed",
      "completed_at",
      "due_on",
      "due_at",
      "assignee.name",
      "assignee.gid",
      "projects.gid",
      "projects.name",
      "workspace.gid",
      "workspace.name",
      "tags.name",
      "tags.gid",
    ].join(",");

    const url = `${ASANA_BASE_URL}/projects/${projectGid}/tasks?opt_fields=${optFields}&completed_since=now&limit=${normalizedLimit}`;
    const response = await fetch(url, { headers: buildAuthHeaders(token) });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Asana API error (${response.status}):`, error);
      return [];
    }

    const data = (await response.json()) as AsanaTasksResponse;

    return data.data.map((task): EntityInput => {
      const workspaceGid = task.workspace?.gid || "";
      const tagNames = (task.tags || []).map((t) => t.name);

      return {
        kind: "issue",
        title: task.name,
        url: task.permalink_url,
        body: task.notes || null,
        summary: task.notes?.substring(0, 500) || null,
        occurredAt: normalizeDateToIso(task.created_at),
        externalId: `${projectGid}#${task.gid}`,
        connectionId,
        resourceId: resource.id,
        metadata: {
          provider: "asana",
          taskGid: task.gid,
          projectGid,
          workspaceGid,
          completed: task.completed,
          completedAt: task.completed_at,
          dueOn: task.due_on,
          dueAt: task.due_at,
          assignee: task.assignee?.name || null,
          modifiedAt: task.modified_at
            ? new Date(task.modified_at).toISOString()
            : null,
          labels: tagNames,
          repo: projectGid,
          number: parseInt(task.gid, 10) || 0,
          state: task.completed ? "completed" : "open",
        },
      };
    });
  },
};
