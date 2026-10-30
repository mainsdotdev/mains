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
import { collectPages, normalizeLimit, normalizeDateToIso } from "../sync.connection-utils";
import { statusFromName } from "../sync.issue-status";
import { labelColorMap, priorityFromName } from "../sync.issue-display";

const ASANA_BASE_URL = "https://app.asana.com/api/1.0";
const MAX_ITEMS_PER_PAGE = 100;

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
  assignee: { gid: string; name: string; photo?: { image_60x60?: string } | null } | null;
  projects: Array<{ gid: string; name: string }>;
  memberships?: Array<{
    project?: { gid: string };
    section?: { gid: string; name: string } | null;
  }>;
  workspace: { gid: string; name: string };
  tags: Array<{ gid: string; name: string; color?: string | null }>;
  custom_fields?: Array<{ name?: string; enum_value?: { name?: string } | null }>;
}

/**
 * Asana has no built-in priority; many projects add a "Priority" custom field
 * (High / Medium / Low), which reads onto the shared scale.
 */
function priorityOf(task: AsanaTask): number {
  const field = task.custom_fields?.find((f) => f.name?.trim().toLowerCase() === "priority");
  return priorityFromName(field?.enum_value?.name);
}

interface AsanaTasksResponse {
  data: AsanaTask[];
  next_page?: { offset: string } | null;
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

/**
 * The bucket Asana files a project's section-less tasks under. It isn't a
 * section anyone made, so it is no workflow state: such tasks are open until
 * completed, like in a project without sections.
 */
const DEFAULT_SECTION_NAME = "(no section)";

function isDefaultSection(section: { name: string }): boolean {
  return section.name === DEFAULT_SECTION_NAME;
}

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
  defaultLimit: 1000,
  incremental: true,

  async fetchForResource({
    resource,
    secrets,
    limit,
    connectionId,
    since,
  }: ResourceFetcherArgs): Promise<EntityInput[]> {
    const token = secrets.accessToken;
    if (!token) throw new Error("Asana connection has no access token");

    const projectGid = resource.externalId;

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
      "assignee.photo.image_60x60",
      "projects.gid",
      "projects.name",
      "memberships.project.gid",
      "memberships.section.gid",
      "memberships.section.name",
      "workspace.gid",
      "workspace.name",
      "tags.name",
      "tags.gid",
      "tags.color",
      "custom_fields.name",
      "custom_fields.enum_value.name",
    ].join(",");

    // Open tasks come from the project's task list; changes need the
    // `/tasks` search, the one endpoint with `modified_since` — and without
    // `completed_since` it returns completed tasks too, so closures arrive.
    const baseUrl = since
      ? `${ASANA_BASE_URL}/tasks?project=${projectGid}&modified_since=${encodeURIComponent(since.toISOString())}&opt_fields=${optFields}`
      : `${ASANA_BASE_URL}/projects/${projectGid}/tasks?opt_fields=${optFields}&completed_since=now`;

    const tasks = await collectPages<AsanaTask, string>(limit, "", async (offset, pageSize) => {
      const url = `${baseUrl}&limit=${normalizeLimit(pageSize, 1, MAX_ITEMS_PER_PAGE)}${
        offset ? `&offset=${encodeURIComponent(offset)}` : ""
      }`;
      const response = await fetch(url, { headers: buildAuthHeaders(token) });

      if (!response.ok) {
        const error = await response.text();
        console.error(`Asana API error (${response.status}):`, error);
        throw new Error(`Asana API error: ${response.status}`);
      }

      const data = (await response.json()) as AsanaTasksResponse;
      return { items: data.data, next: data.next_page?.offset ?? null };
    });

    return tasks.map((task): EntityInput => {
      const workspaceGid = task.workspace?.gid || "";
      const tagNames = (task.tags || []).map((t) => t.name);
      // A task's section in this project is its workflow state — a column
      // the user named. A task can sit in several projects; take this one's.
      const membership = task.memberships?.find((m) => m.project?.gid === projectGid)?.section;
      const section = membership && !isDefaultSection(membership) ? membership : null;

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
          // The exact time when set, else the day — the shared due date.
          dueAt: task.due_at ?? task.due_on ?? null,
          assignee: task.assignee?.name || null,
          assigneeAvatarUrl: task.assignee?.photo?.image_60x60 ?? null,
          // Tasks have no handle of their own; the gid is no name for people.
          identifier: null,
          labelColors: labelColorMap(task.tags || []),
          priorityLevel: priorityOf(task),
          modifiedAt: task.modified_at
            ? new Date(task.modified_at).toISOString()
            : null,
          labels: tagNames,
          repo: projectGid,
          number: parseInt(task.gid, 10) || 0,
          state: section?.name ?? (task.completed ? "completed" : "open"),
          stateId: section?.gid ?? null,
          statusId: task.completed ? "done" : statusFromName(section?.name),
        },
      };
    });
  },

  async listStates({ resource, secrets }) {
    const token = secrets.accessToken;
    if (!token) throw new Error("Asana connection has no access token");

    const response = await fetch(
      `${ASANA_BASE_URL}/projects/${resource.externalId}/sections?opt_fields=name&limit=${MAX_ITEMS_PER_PAGE}`,
      { headers: buildAuthHeaders(token) },
    );
    if (!response.ok) {
      const error = await response.text();
      console.error(`Asana API error (${response.status}):`, error);
      throw new Error(`Asana API error: ${response.status}`);
    }

    const { data } = (await response.json()) as { data: Array<{ gid: string; name: string }> };
    return data.filter((section) => !isDefaultSection(section)).map((section) => ({
      id: section.gid,
      name: section.name,
      color: null,
      defaultStatusId: statusFromName(section.name),
    }));
  },
};
