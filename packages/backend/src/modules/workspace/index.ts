export { registerWorkspaceIpc, unregisterWorkspaceIpc } from "./workspace.ipc";
export {
  workspaceService,
  workspacePathExists,
  assertWorkspacePathExists,
  logWorkspaceActivity,
  emitFindingsChanged,
  recordWorkspaceDiff,
  clearWorkspaceDiff,
} from "./workspace.service";
export type {
  // workspace
  WorkspaceMetadata,
  WorktreeMetadata,
  NoWorktreeMetadata,
  OriginMetadata,
  WorkspaceStatus,
  CreateWorkspacePayload,
  UpdateWorkspacePayload,
  WorkspaceIntakeSource,
  WorkspaceIntakePayload,
  WorkspaceResponse,
  WorkspaceListResponse,
  WorkspaceGitState,
  ScriptCompleteEvent,
  // activity
  ActivityType,
  ActivityResponse,
  CreateActivityPayload,
  // diffs
  WorkspaceDiffResponse,
  WorkspaceDiffSummaryResponse,
  CreateDiffPayload,
  UpdateDiffPayload,
  // reviews
  ReviewStatus,
  ReviewResponse,
  CreateReviewPayload,
  UpdateReviewPayload,
  // findings
  FindingSeverity,
  ReviewFindingResponse,
  CreateReviewFindingPayload,
  UpdateReviewFindingPayload,
} from "./workspace.dto";
