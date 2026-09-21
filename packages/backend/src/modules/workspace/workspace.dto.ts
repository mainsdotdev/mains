// ─────────────────────────────────────────────────────────────
// Workspace aggregate DTOs
//
// Single source of types for the workspace module, which spans 5 tables:
// workspaces, workspace_activity, workspace_diffs, reviews, review_findings.
// See ADR-0001 for the consolidation decision.
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// ── Workspace ──
// ─────────────────────────────────────────────────────────────

export interface WorktreeMetadata {
  enabled: true;
  name: string;
  path: string;
  sourcePath: string;
}

/** Stored on workspaces that live in their repo directly (no worktree). */
export interface NoWorktreeMetadata {
  enabled: false;
}

export interface OriginMetadata {
  url: string | null;
}

export interface WorkspaceMetadata {
  isGitRepo?: boolean;
  tracking?: string | null;
  ahead?: number;
  behind?: number;
  worktree?: WorktreeMetadata | NoWorktreeMetadata;
  origin?: OriginMetadata;
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

export interface CreateWorkspacePayload {
  id?: string;
  accountId: string;
  name: string;
  rootPath: string;
  repoUrl?: string;
  baseBranch?: string;
  metadata?: WorkspaceMetadata;
  projectId: string;
}

export interface UpdateWorkspacePayload {
  name?: string;
  rootPath?: string;
  repoUrl?: string;
  baseBranch?: string;
  metadata?: WorkspaceMetadata;
  status?: WorkspaceStatus;
  projectId?: string;
}

// ─────────────────────────────────────────────────────────────
// ── Workspace intake ──
// The single input to `workspaceService.createFromSource`. Four acquisition
// sources feed the shared intake tail (import → project → workspace).
// See CONTEXT.md "Workspace intake".
// ─────────────────────────────────────────────────────────────

export type WorkspaceIntakeSource =
  | { kind: "folder"; path: string }
  | { kind: "clone"; url: string; targetPath: string }
  | { kind: "init"; name: string; parentPath?: string }
  | { kind: "worktree"; projectId: string };

export interface WorkspaceIntakePayload {
  accountId: string;
  source: WorkspaceIntakeSource;
}

export interface WorkspaceResponse {
  id: string;
  accountId: string;
  projectId: string;
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

export interface WorkspaceGitState {
  workspaceId: string;
  branch: string | null;
  /**
   * Whether the workspace's directory is still on disk. Kept separate from
   * `branch` because a null branch means "not a git repo", which is a normal
   * working state — a missing directory is not.
   */
  pathExists: boolean;
}

export interface WorkspaceListResponse {
  workspaces: WorkspaceResponse[];
  total: number;
}

/**
 * An archived workspace, enriched for the Settings › Archive list.
 *
 * The extra fields all answer questions the list has to answer before the user
 * can decide between Unarchive and Delete, and none of them are on the row:
 * whether the directory survived archiving (a project's archiveScript is free
 * to remove it), which project it belonged to, and whether deleting it can
 * also clean up a worktree. Resolved server-side so the renderer doesn't fan
 * out one call per row.
 */
export interface ArchivedWorkspaceResponse extends WorkspaceResponse {
  /** Display name of the owning Developer Project, or null for a dangling row. */
  projectName: string | null;
  /** Whether `rootPath` is still on disk. See `workspacePathExists`. */
  pathExists: boolean;
  /**
   * Set only when this workspace lives in its own git worktree, which is the
   * one case where deleting it can safely remove a directory from disk. Null
   * for workspaces that occupy the repo itself — there the directory is the
   * user's checkout and is never ours to delete.
   */
  worktree: WorktreeMetadata | null;
}

export interface DeleteWorkspaceOptions {
  /**
   * Also remove the workspace's worktree from disk. Ignored unless the
   * workspace is a worktree — see `ArchivedWorkspaceResponse.worktree`.
   */
  removeWorktree?: boolean;
}

export interface ScriptCompleteEvent {
  workspaceId: string;
  script: "setup" | "archive";
  success: boolean;
  error?: string;
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

export interface ActivityResponse {
  id: string;
  workspaceId: string;
  type: ActivityType;
  title: string;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  refId: string | null;
  createdAt: Date;
}

export interface CreateActivityPayload {
  id?: string;
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

export interface WorkspaceDiffResponse {
  id: string;
  workspaceId: string;
  runId: string | null;
  baseRef: string | null;
  diffText: string;
  files: string[] | null;
  stats: { shortstat: string; files: number; newFiles?: number } | null;
  /**
   * The subset of `files` that git wasn't tracking when the snapshot was taken.
   * Null on rows written before the column existed — treat as "unknown", not
   * "none". Carried separately because the diff text can't express it: a
   * staged-new file and an untracked one both render as `new file mode …`.
   */
  untrackedFiles: string[] | null;
  createdAt: Date;
}

export type WorkspaceDiffSummaryResponse = Omit<WorkspaceDiffResponse, "diffText">;

export interface CreateDiffPayload {
  id: string;
  workspaceId: string;
  runId?: string;
  baseRef?: string;
  diffText: string;
  filesJson?: string;
  statsJson?: string;
  untrackedJson?: string;
}

export interface UpdateDiffPayload {
  diffText: string;
  filesJson?: string | null;
  statsJson?: string | null;
  untrackedJson?: string | null;
  baseRef?: string | null;
}

// ─────────────────────────────────────────────────────────────
// ── Reviews ──
// ─────────────────────────────────────────────────────────────

export type ReviewStatus = "open" | "in_review" | "approved" | "rejected";

export interface ReviewResponse {
  id: string;
  workspaceId: string | null;
  title: string;
  summary: string | null;
  status: ReviewStatus;
  runId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
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

export interface ReviewFindingResponse {
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
  createdAt: Date;
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
