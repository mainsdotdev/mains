// ─────────────────────────────────────────────────────────────
// GitHub PR Source
// Live GraphQL search against api.github.com using the stored
// connection token — no `gh` CLI dependency.
// ─────────────────────────────────────────────────────────────

import { Octokit } from "@octokit/rest";

import type {
  PrCheck,
  PrCiStatus,
  PrComment,
  PrDiff,
  PrMergeMethod,
  PrNewReviewComment,
  PrRef,
  PrReviewThread,
  PrSearchFilters,
  PrSearchPage,
  PrSearchPageInput,
  PrSource,
  PrState,
  PrViewer,
  PullRequestDetail,
  PullRequestSummary,
} from "./source.types";

/**
 * Cap on the diff text sent to the renderer. Oversized diffs are cut at the
 * last complete file section under the cap and flagged as truncated.
 */
const MAX_DIFF_CHARS = 300_000;

export function truncateDiffAtFileBoundary(diffText: string): PrDiff {
  if (diffText.length <= MAX_DIFF_CHARS) {
    return { diffText, truncated: false };
  }
  const cutoff = diffText.lastIndexOf("\ndiff --git ", MAX_DIFF_CHARS);
  return {
    diffText: cutoff > 0 ? diffText.slice(0, cutoff + 1) : diffText.slice(0, MAX_DIFF_CHARS),
    truncated: true,
  };
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;

const SEARCH_QUERY = `
  query ($searchQuery: String!, $first: Int!, $after: String) {
    search(query: $searchQuery, type: ISSUE, first: $first, after: $after) {
      issueCount
      nodes {
        __typename
        ... on PullRequest {
          id
          number
          title
          url
          bodyText
          isDraft
          state
          reviewDecision
          additions
          deletions
          baseRefName
          headRefName
          createdAt
          updatedAt
          author {
            login
            avatarUrl(size: 48)
          }
          repository {
            name
            owner {
              login
            }
          }
          commits(last: 1) {
            nodes {
              commit {
                statusCheckRollup {
                  state
                }
              }
            }
          }
        }
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
`;

const DETAIL_QUERY = `
  query ($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        id
        number
        title
        url
        body
        isDraft
        state
        reviewDecision
        additions
        deletions
        baseRefName
        headRefName
        createdAt
        updatedAt
        mergedAt
        mergeable
        mergeStateStatus
        viewerCanUpdate
        autoMergeRequest {
          enabledAt
        }
        author {
          login
          avatarUrl(size: 48)
        }
        repository {
          name
          owner {
            login
          }
        }
        comments(first: 50) {
          nodes {
            id
            author {
              login
              avatarUrl(size: 48)
            }
            body
            createdAt
            url
          }
        }
        latestReviews(first: 20) {
          nodes {
            author {
              login
            }
            state
          }
        }
        reviewThreads(first: 50) {
          nodes {
            id
            isResolved
            path
            line
            diffSide
            viewerCanResolve
            viewerCanUnresolve
            comments(first: 30) {
              nodes {
                id
                author {
                  login
                  avatarUrl(size: 48)
                }
                body
                createdAt
                url
              }
            }
          }
        }
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                state
                contexts(first: 50) {
                  nodes {
                    __typename
                    ... on CheckRun {
                      name
                      status
                      conclusion
                    }
                    ... on StatusContext {
                      context
                      state
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

interface GraphQlPullRequestNode {
  __typename: string;
  id: string;
  number: number;
  title: string;
  url: string;
  bodyText: string | null;
  isDraft: boolean;
  state: "OPEN" | "CLOSED" | "MERGED";
  reviewDecision: string | null;
  additions: number;
  deletions: number;
  baseRefName: string;
  headRefName: string;
  createdAt: string;
  updatedAt: string;
  author: { login: string; avatarUrl: string | null } | null;
  repository: { name: string; owner: { login: string } };
  commits: {
    nodes: Array<{
      commit: { statusCheckRollup: { state: string } | null };
    } | null>;
  } | null;
}

interface GraphQlSearchResponse {
  search: {
    issueCount: number;
    nodes: Array<GraphQlPullRequestNode | null>;
    pageInfo: { endCursor: string | null; hasNextPage: boolean };
  };
}

interface GraphQlCommentNode {
  id: string;
  author: { login: string; avatarUrl: string | null } | null;
  body: string;
  createdAt: string;
  url: string | null;
}

interface GraphQlCheckContext {
  __typename: string;
  name?: string;
  status?: string;
  conclusion?: string | null;
  context?: string;
  state?: string;
}

interface GraphQlDetailNode extends GraphQlPullRequestNode {
  body: string;
  mergedAt: string | null;
  mergeable: string;
  mergeStateStatus: string | null;
  viewerCanUpdate: boolean;
  autoMergeRequest: { enabledAt: string | null } | null;
  commits: {
    nodes: Array<{
      commit: {
        statusCheckRollup: {
          state: string;
          contexts?: { nodes: Array<GraphQlCheckContext | null> } | null;
        } | null;
      };
    } | null>;
  } | null;
  comments: { nodes: Array<GraphQlCommentNode | null> } | null;
  latestReviews: {
    nodes: Array<{ author: { login: string } | null; state: string } | null>;
  } | null;
  reviewThreads: {
    nodes: Array<{
      id: string;
      isResolved: boolean;
      path: string | null;
      line: number | null;
      diffSide: "LEFT" | "RIGHT" | null;
      viewerCanResolve: boolean;
      viewerCanUnresolve: boolean;
      comments: { nodes: Array<GraphQlCommentNode | null> } | null;
    } | null>;
  } | null;
}

interface GraphQlDetailResponse {
  repository: { pullRequest: GraphQlDetailNode | null } | null;
}

/** GitHub caps search queries at 256 characters. */
const MAX_SEARCH_QUERY_CHARS = 256;

/**
 * Build the GitHub search qualifier string. Mirrors the qualifiers GitHub's
 * own PR inbox uses. Without a repo scope, `all` narrows to `involves:@me`
 * because an unqualified `is:pr` search would span every public repository;
 * with a repo scope the repos themselves bound the search, so `all` means
 * every PR in those repos.
 */
export function buildSearchQuery(filters: PrSearchFilters): string {
  const repos = filters.repos ?? [];
  const parts = ["is:pr"];

  switch (filters.relationship) {
    case "all":
      if (repos.length === 0) parts.push("involves:@me");
      break;
    case "authored":
      parts.push("author:@me");
      break;
    case "review_requested":
      parts.push("review-requested:@me");
      break;
    case "reviewed":
      parts.push("reviewed-by:@me");
      break;
  }

  switch (filters.lifecycle) {
    case "all":
      break;
    case "open":
      parts.push("is:open");
      break;
    case "merged":
      parts.push("is:merged");
      break;
    case "closed":
      parts.push("is:closed", "is:unmerged");
      break;
  }

  const repoStart = parts.length;
  for (const repo of repos) {
    parts.push(`repo:${repo}`);
  }

  const text = filters.text?.replace(/\s+/g, " ").trim();
  if (text) {
    parts.push(`"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  }

  parts.push("sort:updated-desc");

  // Stay under GitHub's query-length cap by dropping trailing repo
  // qualifiers — a slightly wider scope beats a failed search. Under the
  // `all` relationship at least one repo must survive: it is the only
  // qualifier bounding the search.
  const minRepos = filters.relationship === "all" && repos.length > 0 ? 1 : 0;
  let query = parts.join(" ");
  let repoEnd = repoStart + repos.length;
  while (query.length > MAX_SEARCH_QUERY_CHARS && repoEnd > repoStart + minRepos) {
    repoEnd--;
    parts.splice(repoEnd, 1);
    query = parts.join(" ");
  }
  return query;
}

function toPrState(state: GraphQlPullRequestNode["state"]): PrState {
  if (state === "MERGED") return "merged";
  if (state === "CLOSED") return "closed";
  return "open";
}

function toCiStatus(node: GraphQlPullRequestNode): PrCiStatus {
  const rollup = node.commits?.nodes?.[0]?.commit?.statusCheckRollup;
  if (!rollup) return "none";
  switch (rollup.state) {
    case "SUCCESS":
      return "passing";
    case "FAILURE":
    case "ERROR":
      return "failing";
    case "PENDING":
    case "EXPECTED":
      return "pending";
    default:
      return "none";
  }
}

function toSummary(node: GraphQlPullRequestNode): PullRequestSummary {
  return {
    nodeId: node.id,
    provider: "github",
    number: node.number,
    title: node.title,
    url: node.url,
    repo: { owner: node.repository.owner.login, repo: node.repository.name },
    author: node.author
      ? { login: node.author.login, avatarUrl: node.author.avatarUrl }
      : null,
    state: toPrState(node.state),
    isDraft: node.isDraft,
    additions: node.additions,
    deletions: node.deletions,
    headRefName: node.headRefName,
    baseRefName: node.baseRefName,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    ciStatus: toCiStatus(node),
    reviewDecision: node.reviewDecision,
    bodyText: node.bodyText ? node.bodyText.slice(0, 2000) : null,
  };
}

function toComment(node: GraphQlCommentNode): PrComment {
  return {
    id: node.id,
    author: node.author
      ? { login: node.author.login, avatarUrl: node.author.avatarUrl }
      : null,
    body: node.body,
    createdAt: node.createdAt,
    url: node.url ?? null,
  };
}

function checkContextStatus(ctx: GraphQlCheckContext): PrCiStatus {
  if (ctx.__typename === "CheckRun") {
    if (ctx.status !== "COMPLETED") return "pending";
    if (ctx.conclusion === "SUCCESS" || ctx.conclusion === "NEUTRAL" || ctx.conclusion === "SKIPPED") {
      return "passing";
    }
    return "failing";
  }
  switch (ctx.state) {
    case "SUCCESS":
      return "passing";
    case "FAILURE":
    case "ERROR":
      return "failing";
    default:
      return "pending";
  }
}

function toChecks(node: GraphQlDetailNode): PrCheck[] {
  const contexts =
    node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
  return contexts
    .filter((ctx): ctx is GraphQlCheckContext => ctx != null)
    .map((ctx) => ({
      name: ctx.name ?? ctx.context ?? "check",
      status: checkContextStatus(ctx),
    }));
}

function toDetail(node: GraphQlDetailNode): PullRequestDetail {
  const threads: PrReviewThread[] = (node.reviewThreads?.nodes ?? [])
    .filter((t): t is NonNullable<typeof t> => t != null)
    .map((t) => ({
      id: t.id,
      isResolved: t.isResolved,
      path: t.path,
      line: t.line,
      side:
        t.diffSide === "LEFT" ? ("left" as const)
        : t.diffSide === "RIGHT" ? ("right" as const)
        : null,
      viewerCanResolve: t.viewerCanResolve,
      viewerCanUnresolve: t.viewerCanUnresolve,
      comments: (t.comments?.nodes ?? [])
        .filter((c): c is GraphQlCommentNode => c != null)
        .map(toComment),
    }));

  return {
    ...toSummary(node),
    body: node.body,
    mergedAt: node.mergedAt,
    mergeable: node.mergeable,
    mergeStateStatus: node.mergeStateStatus,
    autoMergeEnabled: node.autoMergeRequest != null,
    viewerCanUpdate: node.viewerCanUpdate,
    comments: (node.comments?.nodes ?? [])
      .filter((c): c is GraphQlCommentNode => c != null)
      .map(toComment),
    reviewThreads: threads,
    latestReviews: (node.latestReviews?.nodes ?? [])
      .filter((r): r is NonNullable<typeof r> => r != null)
      .map((r) => ({ author: r.author?.login ?? null, state: r.state })),
    checks: toChecks(node),
  };
}

export function createGithubPrSource(options: { token: string }): PrSource {
  const octokit = new Octokit({ auth: options.token });

  return {
    id: "github",
    displayName: "GitHub",

    async getViewer(): Promise<PrViewer> {
      const { data } = await octokit.users.getAuthenticated();
      return { login: data.login, avatarUrl: data.avatar_url ?? null };
    },

    async search(
      filters: PrSearchFilters,
      page: PrSearchPageInput,
    ): Promise<PrSearchPage> {
      const first = Math.min(
        Math.max(page.pageSize ?? DEFAULT_PAGE_SIZE, 1),
        MAX_PAGE_SIZE,
      );

      const response = await octokit.graphql<GraphQlSearchResponse>(
        SEARCH_QUERY,
        {
          searchQuery: buildSearchQuery(filters),
          first,
          ...(page.cursor ? { after: page.cursor } : {}),
        },
      );

      const items = response.search.nodes
        .filter(
          (node): node is GraphQlPullRequestNode =>
            node != null && node.__typename === "PullRequest",
        )
        .map(toSummary);

      return {
        items,
        endCursor: response.search.pageInfo.hasNextPage
          ? response.search.pageInfo.endCursor
          : null,
        hasNextPage: response.search.pageInfo.hasNextPage,
        totalCount: response.search.issueCount,
      };
    },

    async getDetail(ref: PrRef): Promise<PullRequestDetail> {
      const response = await octokit.graphql<GraphQlDetailResponse>(
        DETAIL_QUERY,
        { owner: ref.owner, repo: ref.repo, number: ref.number },
      );
      const node = response.repository?.pullRequest;
      if (!node) {
        throw new Error(
          `Pull request ${ref.owner}/${ref.repo}#${ref.number} not found`,
        );
      }
      return toDetail(node);
    },

    async getDiff(ref: PrRef): Promise<PrDiff> {
      // With the diff media type GitHub returns the raw unified diff as the
      // response body; octokit's types still say "pull request object".
      const response = await octokit.pulls.get({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.number,
        mediaType: { format: "diff" },
      });
      const diffText = response.data as unknown as string;
      if (typeof diffText !== "string") {
        throw new Error("GitHub returned an unexpected diff response");
      }
      return truncateDiffAtFileBoundary(diffText);
    },

    async merge(ref: PrRef, method: PrMergeMethod): Promise<void> {
      await octokit.pulls.merge({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.number,
        merge_method: method,
      });
    },

    async markReady(nodeId: string): Promise<void> {
      await octokit.graphql(
        `mutation ($id: ID!) {
          markPullRequestReadyForReview(input: { pullRequestId: $id }) {
            pullRequest { id }
          }
        }`,
        { id: nodeId },
      );
    },

    async addComment(ref: PrRef, body: string): Promise<void> {
      await octokit.issues.createComment({
        owner: ref.owner,
        repo: ref.repo,
        issue_number: ref.number,
        body,
      });
    },

    async addReviewComment(
      ref: PrRef,
      input: PrNewReviewComment,
    ): Promise<void> {
      // REST review comments anchor to a commit; use the current head.
      const { data: pull } = await octokit.pulls.get({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.number,
      });
      await octokit.pulls.createReviewComment({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.number,
        commit_id: pull.head.sha,
        path: input.path,
        line: input.line,
        side: input.side === "left" ? "LEFT" : "RIGHT",
        body: input.body,
      });
    },

    async replyToReviewThread(threadId: string, body: string): Promise<void> {
      await octokit.graphql(
        `mutation ($id: ID!, $body: String!) {
          addPullRequestReviewThreadReply(
            input: { pullRequestReviewThreadId: $id, body: $body }
          ) {
            comment { id }
          }
        }`,
        { id: threadId, body },
      );
    },

    async resolveThread(threadId: string, resolved: boolean): Promise<void> {
      const mutation = resolved
        ? `mutation ($id: ID!) {
            resolveReviewThread(input: { threadId: $id }) {
              thread { id }
            }
          }`
        : `mutation ($id: ID!) {
            unresolveReviewThread(input: { threadId: $id }) {
              thread { id }
            }
          }`;
      await octokit.graphql(mutation, { id: threadId });
    },
  };
}
