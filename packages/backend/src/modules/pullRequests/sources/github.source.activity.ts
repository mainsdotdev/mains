import type { Octokit } from "@octokit/rest";
import type {
  PrActivity, PrActivityFilter, PrActivityKind, PrActivityPage, PrAuthor, PrCommit, PrCommitPage,
} from "@mains/contracts/pull-requests";
import type { PrRef, PrSearchPageInput } from "./source.types";

const COMMITS_QUERY = `
  query PrCommits($owner: String!, $repo: String!, $number: Int!, $last: Int!, $before: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        commits(last: $last, before: $before) {
          totalCount
          pageInfo { startCursor hasPreviousPage }
          nodes {
            commit {
              oid messageHeadline committedDate url
              author { name user { login avatarUrl(size: 48) } }
            }
          }
        }
      }
    }
  }
`;

const ACTIVITY_TYPES = {
  comments: ["ISSUE_COMMENT"],
  reviews: ["PULL_REQUEST_REVIEW"],
  events: ["CLOSED_EVENT", "REOPENED_EVENT", "MERGED_EVENT", "REVIEW_REQUESTED_EVENT",
    "REVIEW_REQUEST_REMOVED_EVENT", "READY_FOR_REVIEW_EVENT", "CONVERT_TO_DRAFT_EVENT", "HEAD_REF_FORCE_PUSHED_EVENT"],
};

const ACTIVITY_QUERY = `
  query PrActivity($owner: String!, $repo: String!, $number: Int!, $last: Int!, $before: String,
    $types: [PullRequestTimelineItemsItemType!]!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        timelineItems(last: $last, before: $before, itemTypes: $types) {
          totalCount
          pageInfo { startCursor hasPreviousPage }
          nodes {
            __typename
            ... on IssueComment { id body createdAt url author { login avatarUrl(size: 48) } }
            ... on PullRequestReview { id body createdAt submittedAt url state author { login avatarUrl(size: 48) } }
            ... on ClosedEvent { id createdAt actor { login avatarUrl(size: 48) } }
            ... on ReopenedEvent { id createdAt actor { login avatarUrl(size: 48) } }
            ... on MergedEvent { id createdAt actor { login avatarUrl(size: 48) } commit { oid url } }
            ... on ReviewRequestedEvent {
              id createdAt actor { login avatarUrl(size: 48) }
              requestedReviewer { ... on User { login } ... on Team { name } ... on Bot { login } }
            }
            ... on ReviewRequestRemovedEvent {
              id createdAt actor { login avatarUrl(size: 48) }
              requestedReviewer { ... on User { login } ... on Team { name } ... on Bot { login } }
            }
            ... on ReadyForReviewEvent { id createdAt actor { login avatarUrl(size: 48) } }
            ... on ConvertToDraftEvent { id createdAt actor { login avatarUrl(size: 48) } }
            ... on HeadRefForcePushedEvent { id createdAt actor { login avatarUrl(size: 48) } afterCommit { oid url } }
          }
        }
      }
    }
  }
`;

interface Connection<T> {
  nodes: (T | null)[];
  totalCount: number;
  pageInfo: { startCursor: string | null; hasPreviousPage: boolean };
}
interface GraphQlCommit {
  commit: {
    oid: string; messageHeadline: string; committedDate: string; url: string;
    author: { name: string | null; user: PrAuthor | null } | null;
  };
}
interface GraphQlActivity {
  __typename: string;
  id: string;
  createdAt: string;
  submittedAt?: string | null;
  author?: PrAuthor | null;
  actor?: PrAuthor | null;
  body?: string;
  url?: string;
  state?: string;
  requestedReviewer?: { login?: string; name?: string } | null;
  commit?: { oid: string; url: string } | null;
  afterCommit?: { oid: string; url: string } | null;
}

const KINDS: Record<string, PrActivityKind> = {
  IssueComment: "comment", PullRequestReview: "review", ClosedEvent: "closed", ReopenedEvent: "reopened",
  MergedEvent: "merged", ReviewRequestedEvent: "review_requested", ReviewRequestRemovedEvent: "review_request_removed",
  ReadyForReviewEvent: "ready", ConvertToDraftEvent: "draft", HeadRefForcePushedEvent: "force_pushed",
};

function variables(ref: PrRef, page: PrSearchPageInput) {
  return { ...ref, last: Math.min(Math.max(page.pageSize ?? 30, 1), 100), before: page.cursor ?? null };
}

function requirePr<T>(pr: T | null | undefined): T {
  if (!pr) throw new Error("Pull request not found");
  return pr;
}

export async function readPrCommits(octokit: Octokit, ref: PrRef, page: PrSearchPageInput): Promise<PrCommitPage> {
  const result = await octokit.graphql<{
    repository: { pullRequest: { commits: Connection<GraphQlCommit> } | null } | null;
  }>(COMMITS_QUERY, variables(ref, page));
  const connection = requirePr(result.repository?.pullRequest).commits;
  const items: PrCommit[] = connection.nodes.filter((node) => node != null).map(({ commit }) => ({
    oid: commit.oid, message: commit.messageHeadline, committedAt: commit.committedDate, url: commit.url,
    author: commit.author?.user ?? null, authorName: commit.author?.name ?? null,
  }));
  return { items, totalCount: connection.totalCount, ...connection.pageInfo };
}

export async function readPrActivity(
  octokit: Octokit, ref: PrRef, page: PrSearchPageInput, filter: PrActivityFilter,
): Promise<PrActivityPage> {
  const types = filter === "all" ? Object.values(ACTIVITY_TYPES).flat() : ACTIVITY_TYPES[filter];
  const result = await octokit.graphql<{
    repository: { pullRequest: { timelineItems: Connection<GraphQlActivity> } | null } | null;
  }>(ACTIVITY_QUERY, { ...variables(ref, page), types });
  const connection = requirePr(result.repository?.pullRequest).timelineItems;
  const items: PrActivity[] = connection.nodes.filter((node): node is GraphQlActivity => node != null && KINDS[node.__typename] != null)
    // Unsubmitted reviews are private drafts, not published activity.
    .filter((node) => node.__typename !== "PullRequestReview" || node.state !== "PENDING")
    .map((node) => ({
      id: node.id, kind: KINDS[node.__typename], author: node.author ?? node.actor ?? null,
      createdAt: node.submittedAt ?? node.createdAt, body: node.body ?? null,
      url: node.url ?? node.commit?.url ?? node.afterCommit?.url ?? null,
      reviewState: node.state ?? null, reviewer: node.requestedReviewer?.login ?? node.requestedReviewer?.name ?? null,
      commitOid: node.commit?.oid ?? node.afterCommit?.oid ?? null,
    }));
  return { items, totalCount: connection.totalCount, ...connection.pageInfo };
}
