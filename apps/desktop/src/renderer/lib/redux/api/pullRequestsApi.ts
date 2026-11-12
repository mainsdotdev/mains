import type { PrActivityInput, PrActivityPage, PrCommitPage } from "@mains/contracts/pull-requests";
export type { PrRefInput } from "@mains/contracts/pull-requests";
import type { PrRefInput } from "@mains/contracts/pull-requests";
import { baseApi } from "./baseApi";
import { CHANNELS } from "../../../../shared/ipc-kit/channels";

// Mirrors packages/backend/src/modules/pullRequests/sources/source.types.ts — live view
// models, never persisted (see CONTEXT.md: PRs are not entities).

export type PrRelationship = "all" | "authored" | "review_requested" | "reviewed";
export type PrLifecycle = "all" | "open" | "merged" | "closed";
export type PrState = "open" | "merged" | "closed";
export type PrCiStatus = "passing" | "failing" | "pending" | "none";

export interface PullRequestSummary {
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
  bodyText: string | null;
}

export interface PrSearchPage {
  items: PullRequestSummary[];
  endCursor: string | null;
  hasNextPage: boolean;
  totalCount: number;
}

export interface PrAvailability {
  provider: string;
  connected: boolean;
  viewer: { login: string; avatarUrl: string | null } | null;
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

export interface PrComment {
  id: string;
  author: { login: string; avatarUrl: string | null } | null;
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

export interface PrCheck {
  id: string;
  url: string | null;
  startedAt: string | null;
  completedAt: string | null;
  name: string;
  status: PrCiStatus;
}

export interface PullRequestDetail extends PullRequestSummary {
  commitCount: number;
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

export type PrMergeMethod = "merge" | "squash" | "rebase";

export interface PrDiff {
  diffText: string;
  truncated: boolean;
}

export const pullRequestDetailTag = (ref: PrRefInput) =>
  ({ type: "PullRequestDetail", id: `${ref.provider ?? "github"}:${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}#${ref.number}` }) as const;

export const pullRequestsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    // Both PR reads are derived from the provider connection: availability is
    // the token check itself, and search is scoped to the repos selected on
    // that connection. Tagging them `Connection` makes connecting, revoking,
    // or re-scoping repos refresh the inbox instead of serving the cached
    // "not connected" answer until a reload.
    getPrAvailability: builder.query<PrAvailability, string | undefined>({
      query: (provider) => ({
        handler: CHANNELS.pullRequests.getAvailability,
        args: [provider],
      }),
      providesTags: ["Connection"],
    }),

    searchPullRequests: builder.query<PrSearchPage, PrSearchInput>({
      query: (input) => ({
        handler: CHANNELS.pullRequests.search,
        args: [input],
      }),
      providesTags: ["PullRequests", "Connection"],
    }),

    getPrDetail: builder.query<PullRequestDetail, PrRefInput>({
      query: (input) => ({
        handler: CHANNELS.pullRequests.getDetail,
        args: [input],
      }),
      providesTags: (_result, _error, input) => [pullRequestDetailTag(input), "Connection"],
    }),

    getPrCommits: builder.infiniteQuery<PrCommitPage, PrRefInput, string | null>({
      infiniteQueryOptions: {
        initialPageParam: null,
        getNextPageParam: (last) => last.hasPreviousPage && last.startCursor ? last.startCursor : undefined,
      },
      query: ({ queryArg, pageParam }) => ({
        handler: CHANNELS.pullRequests.getCommits,
        args: [{ ...queryArg, cursor: pageParam }],
      }),
      providesTags: (_result, _error, input) => [pullRequestDetailTag(input), "Connection"],
    }),

    getPrActivity: builder.infiniteQuery<PrActivityPage, PrActivityInput, string | null>({
      infiniteQueryOptions: {
        initialPageParam: null,
        getNextPageParam: (last) => last.hasPreviousPage && last.startCursor ? last.startCursor : undefined,
      },
      query: ({ queryArg, pageParam }) => ({
        handler: CHANNELS.pullRequests.getActivity,
        args: [{ ...queryArg, cursor: pageParam }],
      }),
      providesTags: (_result, _error, input) => [pullRequestDetailTag(input), "Connection"],
    }),

    getPrDiff: builder.query<PrDiff, PrRefInput>({
      query: (input) => ({
        handler: CHANNELS.pullRequests.getDiff,
        args: [input],
      }),
      providesTags: (_result, _error, input) => [pullRequestDetailTag(input), "Connection"],
    }),

    mergePr: builder.mutation<void, PrRefInput & { method?: PrMergeMethod }>({
      query: (input) => ({
        handler: CHANNELS.pullRequests.merge,
        args: [input],
      }),
      invalidatesTags: (_result, _error, input) => [
        "PullRequests",
        pullRequestDetailTag(input),
      ],
    }),

    markPrReady: builder.mutation<
      void,
      PrRefInput & { nodeId: string }
    >({
      query: ({ provider, nodeId }) => ({
        handler: CHANNELS.pullRequests.markReady,
        args: [{ provider, nodeId }],
      }),
      invalidatesTags: (_result, _error, input) => [
        "PullRequests",
        pullRequestDetailTag(input),
      ],
    }),

    addPrComment: builder.mutation<void, PrRefInput & { body: string }>({
      query: (input) => ({
        handler: CHANNELS.pullRequests.addComment,
        args: [input],
      }),
      invalidatesTags: (_result, _error, input) => [pullRequestDetailTag(input)],
    }),

    addPrReviewComment: builder.mutation<
      void,
      PrRefInput & {
        path: string;
        line: number;
        side: "left" | "right";
        body: string;
      }
    >({
      query: (input) => ({
        handler: CHANNELS.pullRequests.addReviewComment,
        args: [input],
      }),
      invalidatesTags: (_result, _error, input) => [pullRequestDetailTag(input)],
    }),

    replyToPrThread: builder.mutation<
      void,
      PrRefInput & { threadId: string; body: string }
    >({
      query: ({ provider, threadId, body }) => ({
        handler: CHANNELS.pullRequests.replyToThread,
        args: [{ provider, threadId, body }],
      }),
      invalidatesTags: (_result, _error, input) => [pullRequestDetailTag(input)],
    }),

    resolvePrThread: builder.mutation<
      void,
      PrRefInput & { threadId: string; resolved: boolean }
    >({
      query: ({ provider, threadId, resolved }) => ({
        handler: CHANNELS.pullRequests.resolveThread,
        args: [{ provider, threadId, resolved }],
      }),
      invalidatesTags: (_result, _error, input) => [pullRequestDetailTag(input)],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetPrAvailabilityQuery,
  useSearchPullRequestsQuery,
  useLazySearchPullRequestsQuery,
  useGetPrDetailQuery,
  useGetPrCommitsInfiniteQuery,
  useGetPrActivityInfiniteQuery,
  useGetPrDiffQuery,
  useMergePrMutation,
  useMarkPrReadyMutation,
  useAddPrCommentMutation,
  useAddPrReviewCommentMutation,
  useReplyToPrThreadMutation,
  useResolvePrThreadMutation,
} = pullRequestsApi;
