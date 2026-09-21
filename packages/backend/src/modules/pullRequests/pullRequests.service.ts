// ─────────────────────────────────────────────────────────────
// Pull Requests Service
// Live PR inbox across providers. Throw-style: plain values out,
// user-readable errors thrown to the IPC seam.
// ─────────────────────────────────────────────────────────────

import { getConnectionWithSecrets } from "../connections";
import { getSelectedResources } from "../sync/sync.connection-utils";
import {
  createPrSource,
  isSupportedPrProvider,
} from "./sources/source.factory";
import type {
  PrDiff,
  PrLifecycle,
  PrMergeMethod,
  PrRelationship,
  PrSearchPage,
  PrSource,
  PrViewer,
  PullRequestDetail,
} from "./sources/source.types";

const RELATIONSHIPS: PrRelationship[] = [
  "all",
  "authored",
  "review_requested",
  "reviewed",
];
const LIFECYCLES: PrLifecycle[] = ["all", "open", "merged", "closed"];
const MERGE_METHODS: PrMergeMethod[] = ["merge", "squash", "rebase"];

export interface PrAvailability {
  provider: string;
  connected: boolean;
  viewer: PrViewer | null;
  /** Set when connected but the token failed (revoked, missing scope). */
  error: string | null;
}

export interface PrSearchInput {
  provider?: string;
  relationship?: PrRelationship;
  lifecycle?: PrLifecycle;
  text?: string;
  /** "owner/name" repository slugs, OR-combined. */
  repos?: string[];
  cursor?: string | null;
  pageSize?: number;
}

const REPO_SLUG_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Resource kind holding a provider's selected repositories. */
const REPO_RESOURCE_KIND: Record<"github", string> = {
  github: "github_repo",
};

/**
 * The repos selected on the provider's connection (Settings → Connections),
 * i.e. the same set issue sync pulls from. Empty when the provider isn't
 * connected or nothing is selected.
 */
async function getConnectionRepoScope(provider: "github"): Promise<string[]> {
  const connection = await getConnectionWithSecrets(provider);
  if (!connection) return [];
  const resources = await getSelectedResources(
    connection.id,
    REPO_RESOURCE_KIND[provider],
  );
  return resources
    .map((resource) => resource.externalId)
    .filter((slug) => REPO_SLUG_PATTERN.test(slug));
}

export interface PrRefInput {
  provider?: string;
  owner: string;
  repo: string;
  number: number;
}

function resolveProvider(provider: string | undefined): "github" {
  const id = provider ?? "github";
  if (!isSupportedPrProvider(id)) {
    throw new Error(`Pull requests are not supported for "${id}" yet`);
  }
  return id;
}

async function requireSource(provider: string | undefined): Promise<PrSource> {
  const source = await createPrSource(resolveProvider(provider));
  if (!source) {
    throw new Error(
      "GitHub is not connected. Add a GitHub connection in Settings → Connections.",
    );
  }
  return source;
}

function validateRef(ref: PrRefInput): { owner: string; repo: string; number: number } {
  const owner = typeof ref.owner === "string" ? ref.owner.trim() : "";
  const repo = typeof ref.repo === "string" ? ref.repo.trim() : "";
  if (!owner || !repo) throw new Error("Repository owner and name are required");
  if (!Number.isInteger(ref.number) || ref.number <= 0) {
    throw new Error("Pull request number is required");
  }
  return { owner, repo, number: ref.number };
}

export const pullRequestsService = {
  /**
   * Whether the provider is ready to serve the PR inbox, and who the
   * searches run as. Never throws for the common "not connected" case —
   * the renderer renders that as an empty state, not an error.
   */
  async getAvailability(provider?: string): Promise<PrAvailability> {
    const id = resolveProvider(provider);
    const source = await createPrSource(id);
    if (!source) {
      return { provider: id, connected: false, viewer: null, error: null };
    }

    try {
      const viewer = await source.getViewer();
      return { provider: id, connected: true, viewer, error: null };
    } catch {
      return {
        provider: id,
        connected: true,
        viewer: null,
        error:
          "GitHub rejected the stored token. Reconnect GitHub in Settings → Connections.",
      };
    }
  },

  async search(input: PrSearchInput = {}): Promise<PrSearchPage> {
    const id = resolveProvider(input.provider);

    const relationship = input.relationship ?? "all";
    if (!RELATIONSHIPS.includes(relationship)) {
      throw new Error(`Unknown pull request filter "${relationship}"`);
    }
    const lifecycle = input.lifecycle ?? "open";
    if (!LIFECYCLES.includes(lifecycle)) {
      throw new Error(`Unknown pull request state filter "${lifecycle}"`);
    }

    let repos = (input.repos ?? []).filter(
      (slug) => typeof slug === "string" && REPO_SLUG_PATTERN.test(slug),
    );
    // No explicit repo filter → scope to the repos selected on the
    // connection (the same set issue sync pulls from). With none selected
    // the search stays global (involves:@me).
    if (repos.length === 0) {
      repos = await getConnectionRepoScope(id);
    }

    const source = await requireSource(id);

    return source.search(
      {
        relationship,
        lifecycle,
        text: typeof input.text === "string" ? input.text : undefined,
        repos,
      },
      {
        cursor: input.cursor ?? null,
        pageSize: input.pageSize,
      },
    );
  },

  async getDetail(input: PrRefInput): Promise<PullRequestDetail> {
    const source = await requireSource(input.provider);
    return source.getDetail(validateRef(input));
  },

  async getDiff(input: PrRefInput): Promise<PrDiff> {
    const source = await requireSource(input.provider);
    return source.getDiff(validateRef(input));
  },

  async merge(
    input: PrRefInput & { method?: PrMergeMethod },
  ): Promise<void> {
    const method = input.method ?? "merge";
    if (!MERGE_METHODS.includes(method)) {
      throw new Error(`Unknown merge method "${method}"`);
    }
    const source = await requireSource(input.provider);
    await source.merge(validateRef(input), method);
  },

  async markReady(input: {
    provider?: string;
    nodeId: string;
  }): Promise<void> {
    if (typeof input.nodeId !== "string" || !input.nodeId) {
      throw new Error("Pull request id is required");
    }
    const source = await requireSource(input.provider);
    await source.markReady(input.nodeId);
  },

  async addComment(input: PrRefInput & { body?: string }): Promise<void> {
    const body = typeof input.body === "string" ? input.body.trim() : "";
    if (!body) throw new Error("Comment text is required");
    const source = await requireSource(input.provider);
    await source.addComment(validateRef(input), body);
  },

  async addReviewComment(
    input: PrRefInput & {
      path?: string;
      line?: number;
      side?: string;
      body?: string;
    },
  ): Promise<void> {
    const body = typeof input.body === "string" ? input.body.trim() : "";
    if (!body) throw new Error("Comment text is required");
    const path = typeof input.path === "string" ? input.path.trim() : "";
    if (!path) throw new Error("File path is required");
    if (!Number.isInteger(input.line) || (input.line as number) <= 0) {
      throw new Error("Line number is required");
    }
    const source = await requireSource(input.provider);
    await source.addReviewComment(validateRef(input), {
      path,
      line: input.line as number,
      side: input.side === "left" ? "left" : "right",
      body,
    });
  },

  async replyToThread(input: {
    provider?: string;
    threadId: string;
    body?: string;
  }): Promise<void> {
    if (typeof input.threadId !== "string" || !input.threadId) {
      throw new Error("Review thread id is required");
    }
    const body = typeof input.body === "string" ? input.body.trim() : "";
    if (!body) throw new Error("Comment text is required");
    const source = await requireSource(input.provider);
    await source.replyToReviewThread(input.threadId, body);
  },

  async resolveThread(input: {
    provider?: string;
    threadId: string;
    resolved: boolean;
  }): Promise<void> {
    if (typeof input.threadId !== "string" || !input.threadId) {
      throw new Error("Review thread id is required");
    }
    const source = await requireSource(input.provider);
    await source.resolveThread(input.threadId, input.resolved !== false);
  },
};
