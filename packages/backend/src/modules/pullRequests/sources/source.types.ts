// ─────────────────────────────────────────────────────────────
// PR Source Types
// Live pull-request data fetched per provider (GitHub today;
// GitLab/Bitbucket slot in behind the same interface). PRs are
// view models, never persisted to `entities` — CI/mergeable/review
// state goes stale too fast for the sync path.
// ─────────────────────────────────────────────────────────────

/** How the active user relates to the PRs being searched. */
export type PrRelationship = "all" | "authored" | "review_requested" | "reviewed";

export type PrLifecycle = "all" | "open" | "merged" | "closed";

export type PrState = "open" | "merged" | "closed";

export type PrCiStatus = "passing" | "failing" | "pending" | "none";

export interface PrSearchFilters {
  relationship: PrRelationship;
  lifecycle: PrLifecycle;
  /** Free-text search, quoted into the provider query. */
  text?: string;
  /** Restrict to these repositories ("owner/name" slugs, OR-combined). */
  repos?: string[];
}

export interface PrSearchPageInput {
  cursor?: string | null;
  pageSize?: number;
}

export interface PullRequestSummary {
  /** Provider-global id — stable dedup/select key. */
  nodeId: string;
  provider: string;
  number: number;
  title: string;
  url: string;
  repo: { owner: string; repo: string };
  author: { login: string; avatarUrl: string | null } | null;
  state: PrState;
  isDraft: boolean;
  additions: number;
  deletions: number;
  headRefName: string;
  baseRefName: string;
  createdAt: string;
  updatedAt: string;
  ciStatus: PrCiStatus;
  reviewDecision: string | null;
  /** Plain-text body preview for the detail pane. */
  bodyText: string | null;
}

export interface PrSearchPage {
  items: PullRequestSummary[];
  endCursor: string | null;
  hasNextPage: boolean;
  totalCount: number;
}

export interface PrViewer {
  login: string;
  avatarUrl: string | null;
}

export interface PrComment {
  id: string;
  author: { login: string; avatarUrl: string | null } | null;
  /** Markdown body. */
  body: string;
  createdAt: string;
  url: string | null;
}

export interface PrReviewThread {
  id: string;
  isResolved: boolean;
  path: string | null;
  line: number | null;
  /** Which side of the diff the thread anchors to (null on outdated threads). */
  side: "left" | "right" | null;
  viewerCanResolve: boolean;
  viewerCanUnresolve: boolean;
  comments: PrComment[];
}

export interface PrNewReviewComment {
  path: string;
  line: number;
  side: "left" | "right";
  body: string;
}

export interface PrCheck {
  name: string;
  status: PrCiStatus;
}

export interface PullRequestDetail extends PullRequestSummary {
  /** Full markdown body (bodyText on the summary is a plain-text preview). */
  body: string;
  mergedAt: string | null;
  mergeable: string;
  mergeStateStatus: string | null;
  autoMergeEnabled: boolean;
  viewerCanUpdate: boolean;
  comments: PrComment[];
  reviewThreads: PrReviewThread[];
  latestReviews: { author: string | null; state: string }[];
  checks: PrCheck[];
}

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

export type PrMergeMethod = "merge" | "squash" | "rebase";

export interface PrDiff {
  /** Unified diff text (possibly truncated at a file boundary). */
  diffText: string;
  truncated: boolean;
}

/** Interface every PR provider source implements. */
export interface PrSource {
  readonly id: string;
  readonly displayName: string;

  /** The authenticated user the searches run as. */
  getViewer(): Promise<PrViewer>;

  search(filters: PrSearchFilters, page: PrSearchPageInput): Promise<PrSearchPage>;

  getDetail(ref: PrRef): Promise<PullRequestDetail>;

  getDiff(ref: PrRef): Promise<PrDiff>;

  merge(ref: PrRef, method: PrMergeMethod): Promise<void>;

  /** Flip a draft PR to ready-for-review. Takes the provider-global node id. */
  markReady(nodeId: string): Promise<void>;

  addComment(ref: PrRef, body: string): Promise<void>;

  /** Start a new review thread on a diff line. */
  addReviewComment(ref: PrRef, input: PrNewReviewComment): Promise<void>;

  /** Reply to an existing review thread. */
  replyToReviewThread(threadId: string, body: string): Promise<void>;

  resolveThread(threadId: string, resolved: boolean): Promise<void>;
}
