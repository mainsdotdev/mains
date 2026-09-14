import { LinearClient } from "@linear/sdk";

import type {
  EntityInput,
  ResourceFetcher,
  ResourceFetcherArgs,
  FetchAllArgs,
} from "../sync.dto";
import { normalizeLimit, normalizeDateToIso } from "../sync.connection-utils";

const MAX_ITEMS_PER_PAGE = 100;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function extractLabels(
  labels: { nodes: Array<{ name: string }> } | undefined,
): string[] {
  if (!labels?.nodes || !Array.isArray(labels.nodes)) return [];
  return labels.nodes.map((l) => l.name).filter(Boolean);
}

function parseIssueNumber(identifier: string): number | null {
  // Linear identifiers are like "ABC-123" — extract the number suffix.
  const match = identifier.match(/-(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

function requireApiKey(secrets: Record<string, string>): string | null {
  return secrets.apiKey || null;
}

type LinearIssueNode = {
  id: string;
  title: string;
  url: string;
  description?: string | null;
  identifier: string;
  priority?: number;
  createdAt: string | Date;
  updatedAt: string | Date;
  completedAt?: string | Date | null;
  state: Promise<{ name: string } | undefined>;
  assignee: Promise<{ name: string } | undefined>;
  labels(): Promise<{ nodes: Array<{ name: string }> }>;
  team?: Promise<{ key: string } | undefined>;
};

async function normalizeIssue(
  issue: LinearIssueNode,
  teamKey: string,
  connectionId: string,
  resourceId: string | null,
): Promise<EntityInput> {
  const state = await issue.state;
  const assignee = await issue.assignee;
  const labels = await issue.labels();
  const labelNames = extractLabels(labels);
  const number = parseIssueNumber(issue.identifier);

  return {
    kind: "issue",
    title: issue.title,
    url: issue.url,
    body: issue.description || null,
    summary: issue.description?.substring(0, 500) || null,
    occurredAt: normalizeDateToIso(
      issue.createdAt as unknown as string | number | Date,
    ),
    externalId: issue.id,
    connectionId,
    resourceId,
    metadata: {
      provider: "linear",
      identifier: issue.identifier,
      number,
      teamKey,
      repo: teamKey,
      state: state?.name || "Unknown",
      labels: labelNames,
      assignee: assignee?.name || null,
      priority: issue.priority || 0,
      url: issue.url,
      updatedAt: issue.updatedAt
        ? new Date(issue.updatedAt as unknown as string).toISOString()
        : null,
      completedAt: issue.completedAt
        ? new Date(issue.completedAt as unknown as string).toISOString()
        : null,
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
  defaultLimit: 50,

  async fetchForResource({
    resource,
    secrets,
    limit,
    connectionId,
  }: ResourceFetcherArgs): Promise<EntityInput[]> {
    const apiKey = requireApiKey(secrets);
    if (!apiKey) return [];

    const teamKey = resource.externalId;
    const client = new LinearClient({ apiKey });

    const teams = await client.teams({ filter: { key: { eq: teamKey } } });
    const team = teams.nodes[0];
    if (!team) {
      console.warn(`Linear team with key "${teamKey}" not found.`);
      return [];
    }

    const issuesConnection = await team.issues({
      first: normalizeLimit(limit, 1, MAX_ITEMS_PER_PAGE),
      filter: {
        completedAt: { null: true },
        canceledAt: { null: true },
      },
    });

    const entities: EntityInput[] = [];
    for (const issue of issuesConnection.nodes) {
      entities.push(
        await normalizeIssue(
          issue as unknown as LinearIssueNode,
          teamKey,
          connectionId,
          resource.id,
        ),
      );
    }
    return entities;
  },

  /**
   * Linear-specific fallback: when no teams are selected, fetch issues
   * from every team the API key has access to. Other providers return []
   * in this case.
   */
  async fetchAll({
    secrets,
    limit,
    connectionId,
  }: FetchAllArgs): Promise<EntityInput[]> {
    const apiKey = requireApiKey(secrets);
    if (!apiKey) return [];

    const client = new LinearClient({ apiKey });
    const issuesConnection = await client.issues({
      first: normalizeLimit(limit, 1, MAX_ITEMS_PER_PAGE),
      filter: {
        completedAt: { null: true },
        canceledAt: { null: true },
      },
    });

    const entities: EntityInput[] = [];
    for (const issue of issuesConnection.nodes) {
      const team = await (issue as unknown as LinearIssueNode).team;
      const teamKey = team?.key || "UNKNOWN";
      entities.push(
        await normalizeIssue(
          issue as unknown as LinearIssueNode,
          teamKey,
          connectionId,
          null,
        ),
      );
    }
    return entities;
  },
};
