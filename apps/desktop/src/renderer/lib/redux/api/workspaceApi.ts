// Workspace aggregate API — see ADR-0001.
// Consolidates: workspacesApi + workspaceActivityApi + workspaceDiffsApi
// + reviewsApi + reviewFindingsApi.
//
// Tag types stay split (Workspaces, WorkspaceActivity, WorkspaceDiffs,
// Reviews, ReviewFindings) so UI sections refresh independently.

import { appApi } from "@/lib/transport";
import { baseApi } from "./baseApi";
import { CHANNELS } from "../../../../shared/ipc-kit/channels";

// ─────────────────────────────────────────────────────────────
// ── Workspace ──
// ─────────────────────────────────────────────────────────────

export interface WorkspaceMetadata {
  language?: string;
  framework?: string;
  packageManager?: string;
  [key: string]: unknown;
}

export type WorkspaceStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "canceled"
  | "duplicate";

export interface Workspace {
  id: string;
  accountId: string;
  projectId: string | null;
  name: string;
  rootPath: string;
  repoUrl: string | null;
  baseBranch: string | null;
  metadata: WorkspaceMetadata | null;
  status: WorkspaceStatus;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Mirrors WorktreeMetadata in workspace.dto.ts. */
export interface WorkspaceWorktree {
  enabled: true;
  name: string;
  path: string;
  sourcePath: string;
}

/** An archived workspace enriched for Settings › Archive. */
export interface ArchivedWorkspace extends Workspace {
  projectName: string | null;
  pathExists: boolean;
  /** Non-null only for worktree workspaces — the one case Delete can clean up. */
  worktree: WorkspaceWorktree | null;
}

export interface CreateWorkspacePayload {
  id: string;
  accountId: string;
  name: string;
  rootPath: string;
  repoUrl?: string;
  baseBranch?: string;
  metadata?: WorkspaceMetadata;
  projectId?: string;
}

export interface UpdateWorkspacePayload {
  name?: string;
  rootPath?: string;
  repoUrl?: string;
  baseBranch?: string;
  metadata?: WorkspaceMetadata;
  status?: WorkspaceStatus;
}

export interface WorkspaceGitState {
  workspaceId: string;
  branch: string | null;
  /**
   * Whether the workspace's folder is still on disk. Distinct from a null
   * branch, which just means the folder isn't a git repo.
   */
  pathExists: boolean;
}

// Workspace intake — one operation creates a project + workspace from a repo.
// The worktree-vs-direct branching and project find-or-create live in the
// main process (workspaceService.createFromSource). See CONTEXT.md.
export type WorkspaceIntakeSource =
  | { kind: "folder"; path: string }
  | { kind: "clone"; url: string; targetPath: string }
  | { kind: "init"; name: string; parentPath?: string }
  | { kind: "worktree"; projectId: string };

export interface WorkspaceIntakePayload {
  accountId: string;
  source: WorkspaceIntakeSource;
}

// ─────────────────────────────────────────────────────────────
// ── Activity ──
// ─────────────────────────────────────────────────────────────

export type ActivityType =
  | "diff"
  | "review"
  | "finding"
  | "commit"
  | "pr"
  | "push"
  | "pull";

export interface WorkspaceActivity {
  id: string;
  workspaceId: string;
  type: ActivityType;
  title: string;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  refId: string | null;
  createdAt: number;
}

export interface CreateWorkspaceActivityPayload {
  workspaceId: string;
  type: ActivityType;
  title: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  refId?: string;
}

// ─────────────────────────────────────────────────────────────
// ── Diffs ──
// ─────────────────────────────────────────────────────────────

export interface WorkspaceDiff {
  id: string;
  workspaceId: string;
  runId: string | null;
  baseRef: string | null;
  diffText: string;
  files: string[] | null;
  stats: { shortstat: string; files: number; newFiles?: number } | null;
  /**
   * The subset of `files` git wasn't tracking at capture time — rendered as "U"
   * instead of "A". Null on rows captured before the column existed, which the
   * file list reads as "unknown", falling back to "A".
   */
  untrackedFiles: string[] | null;
  createdAt: number;
}

export type WorkspaceDiffSummary = Omit<WorkspaceDiff, "diffText">;

// ─────────────────────────────────────────────────────────────
// ── Reviews ──
// ─────────────────────────────────────────────────────────────

export type ReviewStatus = "open" | "in_review" | "approved" | "rejected";

export interface Review {
  id: string;
  workspaceId: string | null;
  title: string;
  summary: string | null;
  status: ReviewStatus;
  runId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateReviewPayload {
  id?: string;
  workspaceId?: string;
  title: string;
  summary?: string;
  status?: ReviewStatus;
  runId?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateReviewPayload {
  title?: string;
  summary?: string;
  status?: ReviewStatus;
  runId?: string;
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────
// ── Findings ──
// ─────────────────────────────────────────────────────────────

export type FindingSeverity = "critical" | "warning" | "info";

export interface ReviewFinding {
  id: string;
  reviewId: string;
  severity: FindingSeverity;
  file: string;
  lineStart: number | null;
  lineEnd: number | null;
  message: string;
  reason: string;
  suggestion: string | null;
  validated: boolean;
  isApproved: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

export interface CreateReviewFindingPayload {
  id?: string;
  reviewId: string;
  severity: FindingSeverity;
  file: string;
  lineStart?: number;
  lineEnd?: number;
  message: string;
  reason: string;
  suggestion?: string;
  validated?: boolean;
  isApproved?: boolean;
  metadata?: Record<string, unknown>;
}

export interface UpdateReviewFindingPayload {
  severity?: FindingSeverity;
  file?: string;
  lineStart?: number | null;
  lineEnd?: number | null;
  message?: string;
  reason?: string;
  suggestion?: string | null;
  validated?: boolean;
  isApproved?: boolean;
  metadata?: Record<string, unknown> | null;
}

// ─────────────────────────────────────────────────────────────
// Endpoints
// ─────────────────────────────────────────────────────────────

export const workspaceApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    // ── Workspace lifecycle ──
    listWorkspaces: builder.query<Workspace[], void>({
      query: () => ({ handler: CHANNELS.workspace.list }),
      providesTags: ["Workspaces"],
    }),

    listArchivedWorkspaces: builder.query<ArchivedWorkspace[], void>({
      query: () => ({ handler: CHANNELS.workspace.listArchived }),
      providesTags: ["Workspaces"],
    }),

    // Absence rule: a missing workspace arrives as null data, not an error.
    getWorkspace: builder.query<Workspace | null, string>({
      query: (id) => ({
        handler: CHANNELS.workspace.get,
        args: [id],
      }),
      providesTags: (_result, _error, id) => [{ type: "Workspaces", id }],
    }),

    listWorkspacesByAccount: builder.query<Workspace[], string>({
      query: (accountId) => ({
        handler: CHANNELS.workspace.listByAccount,
        args: [accountId],
      }),
      providesTags: ["Workspaces"],
    }),

    listWorkspaceGitStates: builder.query<WorkspaceGitState[], void>({
      query: () => ({ handler: CHANNELS.workspace.listGitStates }),
      providesTags: ["WorkspaceGitStates"],
    }),

    getWorkspaceByRootPath: builder.query<
      Workspace | null,
      { accountId: string; rootPath: string }
    >({
      query: ({ accountId, rootPath }) => ({
        handler: CHANNELS.workspace.getByRootPath,
        args: [accountId, rootPath],
      }),
      providesTags: ["Workspaces"],
    }),

    createWorkspace: builder.mutation<string, CreateWorkspacePayload>({
      query: (payload) => ({
        handler: CHANNELS.workspace.create,
        args: [payload],
      }),
      invalidatesTags: ["Workspaces", "WorkspaceGitStates"],
    }),

    // Create a project + workspace from a repo (picked folder / clone / init).
    // Returns the created workspace so callers can navigate to it.
    createWorkspaceFromSource: builder.mutation<Workspace, WorkspaceIntakePayload>({
      query: (payload) => ({
        handler: CHANNELS.workspace.createFromSource,
        args: [payload],
      }),
      invalidatesTags: ["Workspaces", "WorkspaceGitStates", "Projects"],
    }),

    updateWorkspace: builder.mutation<
      Workspace,
      { id: string; payload: UpdateWorkspacePayload }
    >({
      query: ({ id, payload }) => ({
        handler: CHANNELS.workspace.update,
        args: [id, payload],
      }),
      invalidatesTags: (_result, _error, { id }) => [
        "Workspaces",
        "WorkspaceGitStates",
        { type: "Workspaces", id },
      ],
    }),

    // `removeWorktree` is honoured only for worktree workspaces — see
    // workspaceService.delete.
    deleteWorkspace: builder.mutation<
      void,
      { id: string; removeWorktree?: boolean }
    >({
      query: ({ id, removeWorktree }) => ({
        handler: CHANNELS.workspace.delete,
        args: [id, { removeWorktree }],
      }),
      invalidatesTags: ["Workspaces", "WorkspaceGitStates"],
    }),

    archiveWorkspace: builder.mutation<Workspace, string>({
      query: (id) => ({
        handler: CHANNELS.workspace.archive,
        args: [id],
      }),
      invalidatesTags: (_result, _error, id) => [
        "Workspaces",
        "WorkspaceGitStates",
        { type: "Workspaces", id },
      ],
    }),

    unarchiveWorkspace: builder.mutation<Workspace, string>({
      query: (id) => ({
        handler: CHANNELS.workspace.unarchive,
        args: [id],
      }),
      invalidatesTags: (_result, _error, id) => [
        "Workspaces",
        "WorkspaceGitStates",
        { type: "Workspaces", id },
      ],
    }),

    selectWorkspaceDirectory: builder.mutation<string | null, void>({
      query: () => ({ handler: CHANNELS.workspace.selectDirectory }),
    }),

    // ── Git operations (see CONTEXT.md "Workspace git operations") ──
    // Renames the branch currently checked out in the workspace.
    renameWorkspaceBranch: builder.mutation<
      Workspace,
      { id: string; newBranchName: string }
    >({
      query: ({ id, newBranchName }) => ({
        handler: CHANNELS.workspace.renameBranch,
        args: [id, newBranchName],
      }),
      invalidatesTags: ["WorkspaceGitStates"],
    }),

    // Branches off the workspace's HEAD and checks the new branch out. Touches
    // three caches: the workspace row (the branch forked from becomes its PR
    // base), the live git states, and Projects — the branch list this was
    // launched from is a project read, and it has a new name to show.
    createWorkspaceBranch: builder.mutation<
      void,
      { workspaceId: string; branch: string }
    >({
      query: ({ workspaceId, branch }) => ({
        handler: CHANNELS.workspace.createBranch,
        args: [workspaceId, branch],
      }),
      invalidatesTags: (_result, _error, { workspaceId }) => [
        "Workspaces",
        "WorkspaceGitStates",
        "Projects",
        { type: "Workspaces", id: workspaceId },
      ],
    }),

    // Checks out an existing branch in the workspace and re-records its diff.
    switchWorkspaceBranch: builder.mutation<
      void,
      { workspaceId: string; branch: string }
    >({
      query: ({ workspaceId, branch }) => ({
        handler: CHANNELS.workspace.switchBranch,
        args: [workspaceId, branch],
      }),
      invalidatesTags: (_result, _error, { workspaceId }) => [
        "WorkspaceGitStates",
        { type: "WorkspaceDiffs", id: workspaceId },
      ],
    }),

    // Restores specific files to their HEAD state (deleting the ones HEAD
    // doesn't have) and re-records the workspace diff.
    discardWorkspacePaths: builder.mutation<
      void,
      { workspaceId: string; paths: string[] }
    >({
      query: ({ workspaceId, paths }) => ({
        handler: CHANNELS.workspace.discardPaths,
        args: [workspaceId, paths],
      }),
      invalidatesTags: (_result, _error, { workspaceId }) => [
        { type: "WorkspaceDiffs", id: workspaceId },
      ],
    }),

    // ── Activity ──
    listWorkspaceActivity: builder.query<
      WorkspaceActivity[],
      { workspaceId: string; limit?: number }
    >({
      query: ({ workspaceId, limit }) => ({
        handler: CHANNELS.workspace.listActivity,
        args: [workspaceId, limit],
      }),
      keepUnusedDataFor: 30,
      providesTags: (_result, _error, { workspaceId }) => [
        { type: "WorkspaceActivity", id: workspaceId },
      ],
    }),

    createWorkspaceActivity: builder.mutation<
      string,
      CreateWorkspaceActivityPayload
    >({
      query: (payload) => ({
        handler: CHANNELS.workspace.createActivity,
        args: [payload],
      }),
      invalidatesTags: (_result, _error, { workspaceId }) => [
        { type: "WorkspaceActivity", id: workspaceId },
      ],
    }),

    deleteWorkspaceActivity: builder.mutation<
      void,
      { id: string; workspaceId: string }
    >({
      query: ({ id }) => ({
        handler: CHANNELS.workspace.deleteActivity,
        args: [id],
      }),
      invalidatesTags: (_result, _error, { workspaceId }) => [
        { type: "WorkspaceActivity", id: workspaceId },
      ],
    }),

    // ── Diffs ──
    // Note: getLatest* use queryFn rather than `query` so we can return
    // null on error (diffs are often legitimately absent — no error UI needed).
    getLatestWorkspaceDiff: builder.query<WorkspaceDiff | null, string>({
      queryFn: async (workspaceId) => {
        const result = await appApi.workspace.getLatestDiff(workspaceId);
        return { data: result.success ? (result.data ?? null) : null };
      },
      // Diff text can be huge; drop it quickly when no subscribers remain.
      keepUnusedDataFor: 15,
      providesTags: (_result, _error, workspaceId) => [
        { type: "WorkspaceDiffs", id: workspaceId },
      ],
    }),

    getLatestWorkspaceDiffSummary: builder.query<
      WorkspaceDiffSummary | null,
      string
    >({
      queryFn: async (workspaceId) => {
        const result =
          await appApi.workspace.getLatestDiffSummary(workspaceId);
        return { data: result.success ? (result.data ?? null) : null };
      },
      keepUnusedDataFor: 60,
      providesTags: (_result, _error, workspaceId) => [
        { type: "WorkspaceDiffs", id: workspaceId },
      ],
    }),

    listWorkspaceDiffs: builder.query<
      WorkspaceDiff[],
      { workspaceId: string; limit?: number }
    >({
      query: ({ workspaceId, limit }) => ({
        handler: CHANNELS.workspace.listDiffs,
        args: [workspaceId, limit],
      }),
      keepUnusedDataFor: 15,
      providesTags: (_result, _error, { workspaceId }) => [
        { type: "WorkspaceDiffs", id: workspaceId },
      ],
    }),

    // Manual diff refresh — recomputes the workspace's diff against its
    // baseRef (or HEAD) and reconciles the latest diff row. Returns the
    // updated summary, or null when the working tree is clean.
    resyncWorkspaceDiff: builder.mutation<WorkspaceDiffSummary | null, string>({
      query: (workspaceId) => ({
        handler: CHANNELS.workspace.resyncDiff,
        args: [workspaceId],
      }),
      invalidatesTags: (_result, _error, workspaceId) => [
        { type: "WorkspaceDiffs", id: workspaceId },
      ],
    }),

    // ── Reviews ──
    listReviewsByWorkspace: builder.query<
      Review[],
      { workspaceId: string; limit?: number }
    >({
      query: ({ workspaceId, limit }) => ({
        handler: CHANNELS.workspace.listReviews,
        args: [workspaceId, limit],
      }),
      providesTags: ["Reviews"],
    }),

    getReview: builder.query<Review | null, string>({
      query: (id) => ({
        handler: CHANNELS.workspace.getReview,
        args: [id],
      }),
      providesTags: (_result, _err, id) => [{ type: "Reviews", id }],
    }),

    createReview: builder.mutation<string, CreateReviewPayload>({
      query: (payload) => ({
        handler: CHANNELS.workspace.createReview,
        args: [payload],
      }),
      invalidatesTags: ["Reviews"],
    }),

    updateReview: builder.mutation<
      Review,
      { id: string; payload: UpdateReviewPayload }
    >({
      query: ({ id, payload }) => ({
        handler: CHANNELS.workspace.updateReview,
        args: [id, payload],
      }),
      invalidatesTags: (_result, _err, { id }) => [
        "Reviews",
        { type: "Reviews", id },
      ],
    }),

    deleteReview: builder.mutation<void, string>({
      query: (id) => ({
        handler: CHANNELS.workspace.deleteReview,
        args: [id],
      }),
      invalidatesTags: ["Reviews"],
    }),

    // ── Findings ──
    listReviewFindingsByWorkspace: builder.query<
      ReviewFinding[],
      { workspaceId: string }
    >({
      query: ({ workspaceId }) => ({
        handler: CHANNELS.workspace.listFindingsByWorkspace,
        args: [workspaceId],
      }),
      providesTags: ["ReviewFindings"],
    }),

    listReviewFindingsByReview: builder.query<
      ReviewFinding[],
      { reviewId: string; limit?: number }
    >({
      query: ({ reviewId, limit }) => ({
        handler: CHANNELS.workspace.listFindings,
        args: [reviewId, limit],
      }),
      providesTags: ["ReviewFindings"],
    }),

    getReviewFinding: builder.query<ReviewFinding | null, string>({
      query: (id) => ({
        handler: CHANNELS.workspace.getFinding,
        args: [id],
      }),
      providesTags: (_result, _err, id) => [{ type: "ReviewFindings", id }],
    }),

    createReviewFinding: builder.mutation<string, CreateReviewFindingPayload>({
      query: (payload) => ({
        handler: CHANNELS.workspace.createFinding,
        args: [payload],
      }),
      invalidatesTags: ["ReviewFindings"],
    }),

    createReviewFindings: builder.mutation<
      string[],
      CreateReviewFindingPayload[]
    >({
      query: (payloads) => ({
        handler: CHANNELS.workspace.createManyFindings,
        args: [payloads],
      }),
      invalidatesTags: ["ReviewFindings"],
    }),

    updateReviewFinding: builder.mutation<
      ReviewFinding,
      { id: string; payload: UpdateReviewFindingPayload }
    >({
      query: ({ id, payload }) => ({
        handler: CHANNELS.workspace.updateFinding,
        args: [id, payload],
      }),
      invalidatesTags: (_result, _err, { id }) => [
        "ReviewFindings",
        { type: "ReviewFindings", id },
      ],
    }),

    deleteReviewFinding: builder.mutation<void, string>({
      query: (id) => ({
        handler: CHANNELS.workspace.deleteFinding,
        args: [id],
      }),
      invalidatesTags: ["ReviewFindings"],
    }),
  }),
});

export const {
  // workspace lifecycle
  useListWorkspacesQuery,
  useLazyListWorkspacesQuery,
  useListArchivedWorkspacesQuery,
  useGetWorkspaceQuery,
  useLazyGetWorkspaceQuery,
  useListWorkspacesByAccountQuery,
  useLazyListWorkspacesByAccountQuery,
  useListWorkspaceGitStatesQuery,
  useGetWorkspaceByRootPathQuery,
  useLazyGetWorkspaceByRootPathQuery,
  useCreateWorkspaceMutation,
  useCreateWorkspaceFromSourceMutation,
  useUpdateWorkspaceMutation,
  useDeleteWorkspaceMutation,
  useArchiveWorkspaceMutation,
  useUnarchiveWorkspaceMutation,
  useSelectWorkspaceDirectoryMutation,
  useCreateWorkspaceBranchMutation,
  useRenameWorkspaceBranchMutation,
  useSwitchWorkspaceBranchMutation,
  useDiscardWorkspacePathsMutation,
  // activity
  useListWorkspaceActivityQuery,
  useCreateWorkspaceActivityMutation,
  useDeleteWorkspaceActivityMutation,
  // diffs
  useGetLatestWorkspaceDiffQuery,
  useLazyGetLatestWorkspaceDiffQuery,
  useGetLatestWorkspaceDiffSummaryQuery,
  useLazyGetLatestWorkspaceDiffSummaryQuery,
  useListWorkspaceDiffsQuery,
  useLazyListWorkspaceDiffsQuery,
  useResyncWorkspaceDiffMutation,
  // reviews
  useListReviewsByWorkspaceQuery,
  useGetReviewQuery,
  useCreateReviewMutation,
  useUpdateReviewMutation,
  useDeleteReviewMutation,
  // findings
  useListReviewFindingsByWorkspaceQuery,
  useListReviewFindingsByReviewQuery,
  useGetReviewFindingQuery,
  useCreateReviewFindingMutation,
  useCreateReviewFindingsMutation,
  useUpdateReviewFindingMutation,
  useDeleteReviewFindingMutation,
} = workspaceApi;
