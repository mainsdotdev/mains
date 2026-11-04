import { LinearClient } from "@linear/sdk";

import type {
  EntityInput,
  ResourceFetcher,
  ResourceFetcherArgs,
  FetchAllArgs,
} from "../sync.dto";
import { collectPages, normalizeDateToIso } from "../sync.connection-utils";
import { statusFromLinearType } from "../sync.issue-status";
import { hexColor, labelColorMap } from "../sync.issue-display";

// ─────────────────────────────────────────────────────────────
// Query
//
// One raw GraphQL request per page. The SDK's model objects resolve
// `state`, `assignee` and `labels` lazily — three more requests per
// issue — which paging through a whole team would turn into
// thousands of calls against Linear's rate limit.
// ─────────────────────────────────────────────────────────────
const ISSUES_QUERY = `
  query SyncIssues($first: Int!, $after: String, $filter: IssueFilter) {
    issues(first: $first, after: $after, filter: $filter, orderBy: updatedAt) {
      nodes {
        id
        identifier
        title
        url
        description
        priority
        createdAt
        updatedAt
        completedAt
        dueDate
        state { id name type }
        assignee { name avatarUrl }
        labels { nodes { name color } }
        project { name color }
        team { key }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

type LinearIssueNode = {
  id: string;
  identifier: string;
  title: string;
  url: string;
  description?: string | null;
  priority?: number | null;
  createdAt: string;
  updatedAt?: string | null;
  completedAt?: string | null;
  dueDate?: string | null;
  state?: { id: string; name: string; type?: string } | null;
  assignee?: { name: string; avatarUrl?: string | null } | null;
  labels?: { nodes: Array<{ name: string; color?: string | null }> } | null;
  project?: { name: string; color?: string | null } | null;
  team?: { key: string } | null;
};

type IssuesPage = {
  issues: {
    nodes: LinearIssueNode[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

const STATES_QUERY = `
  query TeamStates($filter: WorkflowStateFilter) {
    workflowStates(first: 250, filter: $filter) {
      nodes { id name type color position }
    }
  }
`;

type StatesPage = {
  workflowStates: {
    nodes: Array<{ id: string; name: string; type: string; color?: string | null; position: number }>;
  };
};

/** The order Linear's own board shows state types in. */
const STATE_TYPE_ORDER = [
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
  "duplicate",
];

/** Linear's own definition of "still open": neither completed nor canceled. */
const OPEN_FILTER = { completedAt: { null: true }, canceledAt: { null: true } };

async function fetchIssues(
  apiKey: string,
  filter: Record<string, unknown>,
  limit: number,
): Promise<LinearIssueNode[]> {
  const client = new LinearClient({ apiKey });
  return collectPages<LinearIssueNode, string | undefined>(
    limit,
    undefined,
    async (after, first) => {
      const data = await client.client.request<IssuesPage, Record<string, unknown>>(
        ISSUES_QUERY,
        { first, after, filter },
      );
      const { nodes, pageInfo } = data.issues;
      return {
        items: nodes,
        next: pageInfo.hasNextPage && pageInfo.endCursor ? pageInfo.endCursor : null,
      };
    },
  );
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function parseIssueNumber(identifier: string): number | null {
  // Linear identifiers are like "ABC-123" — extract the number suffix.
  const match = identifier.match(/-(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

function normalizeIssue(
  issue: LinearIssueNode,
  connectionId: string,
  resourceId: string | null,
): EntityInput {
  const teamKey = issue.team?.key || "UNKNOWN";
  const labels = issue.labels?.nodes ?? [];
  const labelNames = labels.map((l) => l.name).filter(Boolean);

  return {
    kind: "issue",
    title: issue.title,
    url: issue.url,
    body: issue.description || null,
    summary: issue.description?.substring(0, 500) || null,
    occurredAt: normalizeDateToIso(issue.createdAt),
    externalId: issue.id,
    connectionId,
    resourceId,
    metadata: {
      provider: "linear",
      identifier: issue.identifier,
      number: parseIssueNumber(issue.identifier),
      teamKey,
      repo: teamKey,
      state: issue.state?.name || "Unknown",
      stateId: issue.state?.id ?? null,
      statusId: statusFromLinearType(issue.state?.type, issue.state?.name),
      labels: labelNames,
      labelColors: labelColorMap(labels),
      assignee: issue.assignee?.name || null,
      assigneeAvatarUrl: issue.assignee?.avatarUrl ?? null,
      // Linear's own 0–4 scale is the shared one.
      priority: issue.priority || 0,
      group: issue.project
        ? { name: issue.project.name, color: hexColor(issue.project.color) }
        : null,
      dueAt: issue.dueDate ?? null,
      url: issue.url,
      updatedAt: issue.updatedAt ? new Date(issue.updatedAt).toISOString() : null,
      completedAt: issue.completedAt ? new Date(issue.completedAt).toISOString() : null,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Fetcher
// ─────────────────────────────────────────────────────────────
export const linearIssuesFetcher: ResourceFetcher = {
  id: "linear:issues",
  provider: "linear",
  resourceKind: "linear_team",
  defaultLimit: 1000,
  incremental: true,

  async fetchForResource({
    resource,
    secrets,
    limit,
    connectionId,
    since,
  }: ResourceFetcherArgs): Promise<EntityInput[]> {
    const apiKey = secrets.apiKey;
    if (!apiKey) throw new Error("Linear connection has no API key");

    const filter = {
      team: { key: { eq: resource.externalId } },
      // Changes include completed and canceled issues, so closures arrive.
      ...(since ? { updatedAt: { gt: since.toISOString() } } : OPEN_FILTER),
    };
    const issues = await fetchIssues(apiKey, filter, limit);
    return issues.map((issue) => normalizeIssue(issue, connectionId, resource.id));
  },

  /**
   * Linear-specific fallback: when no teams are selected, fetch open issues
   * from every team the API key has access to. Other providers return []
   * in this case. Not incremental — there is no resource to keep a cursor on.
   */
  async fetchAll({ secrets, limit, connectionId }: FetchAllArgs): Promise<EntityInput[]> {
    const apiKey = secrets.apiKey;
    if (!apiKey) return [];

    const issues = await fetchIssues(apiKey, OPEN_FILTER, limit);
    return issues.map((issue) => normalizeIssue(issue, connectionId, null));
  },

  async listStates({ resource, secrets }) {
    const apiKey = secrets.apiKey;
    if (!apiKey) throw new Error("Linear connection has no API key");

    const client = new LinearClient({ apiKey });
    const data = await client.client.request<StatesPage, Record<string, unknown>>(
      STATES_QUERY,
      { filter: { team: { key: { eq: resource.externalId } } } },
    );
    const rank = (type: string) => {
      const index = STATE_TYPE_ORDER.indexOf(type);
      return index === -1 ? STATE_TYPE_ORDER.length : index;
    };
    return [...data.workflowStates.nodes]
      .sort((a, b) => rank(a.type) - rank(b.type) || a.position - b.position)
      .map((state) => ({
        id: state.id,
        name: state.name,
        color: state.color ?? null,
        defaultStatusId: statusFromLinearType(state.type, state.name),
      }));
  },
};
