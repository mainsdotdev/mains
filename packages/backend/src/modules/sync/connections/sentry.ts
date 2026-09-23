import type {
  EntityInput,
  ResourceFetcher,
  ResourceFetcherArgs,
} from "../sync.dto";
import { normalizeLimit, normalizeDateToIso } from "../sync.connection-utils";

const SENTRY_API_BASE = "https://sentry.io/api/0";
const DEFAULT_LIMIT = 50;

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface SentryIssue {
  id: string;
  title: string;
  culprit: string;
  permalink: string;
  shortId: string;
  level: string;
  status: string;
  type: string;
  count: string;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  metadata: {
    value?: string;
    type?: string;
    filename?: string;
    function?: string;
  };
  assignedTo?: { name?: string; email?: string } | null;
  project: { slug: string; name: string };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function parseSentryLevel(level: string): string {
  const map: Record<string, string> = {
    fatal: "fatal",
    error: "error",
    warning: "warning",
    info: "info",
    debug: "info",
  };
  return map[level] || "error";
}

function parseSentryCategory(type: string): string {
  const map: Record<string, string> = {
    error: "exception",
    default: "bug",
    csp: "alert",
    hpkp: "alert",
    expectct: "alert",
    expectstaple: "alert",
    transaction: "other",
  };
  return map[type] || "bug";
}

// ─────────────────────────────────────────────────────────────
// Fetcher
// ─────────────────────────────────────────────────────────────

export const sentryIssuesFetcher: ResourceFetcher = {
  id: "sentry:issues",
  provider: "sentry",
  resourceKind: "sentry_project",
  defaultLimit: DEFAULT_LIMIT,

  async fetchForResource({
    resource,
    secrets,
    metadata,
    limit,
    connectionId,
  }: ResourceFetcherArgs): Promise<EntityInput[]> {
    const token = secrets.token;
    if (!token) return [];

    const orgSlug = metadata.organization as string | undefined;
    if (!orgSlug) {
      console.warn("⚠️  Sentry connection missing organization slug");
      return [];
    }

    const projectSlug = resource.externalId;
    const url = `${SENTRY_API_BASE}/projects/${orgSlug}/${projectSlug}/issues/?query=is:unresolved&sort=date&limit=${normalizeLimit(limit, 1, 100)}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error(
        `Sentry API error ${response.status}: ${response.statusText}`,
      );
      return [];
    }

    const issues = (await response.json()) as SentryIssue[];

    return issues.map((issue): EntityInput => {
      const sentryState =
        issue.status === "resolved"
          ? "resolved"
          : issue.status === "ignored"
            ? "ignored"
            : "open";

      return {
        kind: "signal",
        title: issue.title,
        url: issue.permalink,
        body: issue.metadata?.value || null,
        summary: `${issue.metadata?.type || "Error"}: ${issue.title}`.substring(
          0,
          500,
        ),
        occurredAt: normalizeDateToIso(issue.firstSeen),
        externalId: issue.id,
        connectionId,
        resourceId: resource.id,
        metadata: {
          source: "sentry",
          level: parseSentryLevel(issue.level),
          category: parseSentryCategory(issue.type),
          state: sentryState,
          eventCount: parseInt(issue.count, 10) || 1,
          affectedUsers: issue.userCount ?? 0,
          firstSeenAt: issue.firstSeen,
          lastSeenAt: issue.lastSeen,
          file: issue.metadata?.filename ?? "",
          function: issue.metadata?.function || issue.culprit || "",
          assignee:
            issue.assignedTo?.name || issue.assignedTo?.email || "",
          shortId: issue.shortId,
          projectSlug: issue.project?.slug ?? "",
          projectName: issue.project?.name ?? "",
          exceptionType: issue.metadata?.type ?? "",
        },
      };
    });
  },
};
