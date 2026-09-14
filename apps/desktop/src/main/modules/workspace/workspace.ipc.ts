import { ok } from "../../../shared/ipc-kit/service-response";
import { dialog, BrowserWindow } from "electron";
import { ipcMain } from "../../ipc-kit/ipc-main";
import { handle } from "../../ipc-kit/handle";
import { workspaceService } from "./workspace.service";
import { CHANNELS } from "../../../shared/ipc-kit/channels";
import type {
  CreateWorkspacePayload,
  DeleteWorkspaceOptions,
  WorkspaceIntakePayload,
  UpdateWorkspacePayload,
  CreateActivityPayload,
  CreateReviewPayload,
  UpdateReviewPayload,
  CreateReviewFindingPayload,
  UpdateReviewFindingPayload,
} from "./workspace.dto";

// ─────────────────────────────────────────────────────────────
// Workspace aggregate IPC handlers — throw-style service, envelope
// applied by handle().
// ─────────────────────────────────────────────────────────────
export function registerWorkspaceIpc(): void {
  // ── lifecycle ──
  ipcMain.handle(
    CHANNELS.workspace.list,
    handle(() => workspaceService.list()),
  );

  ipcMain.handle(
    CHANNELS.workspace.listArchived,
    handle(() => workspaceService.listArchived()),
  );

  ipcMain.handle(
    CHANNELS.workspace.get,
    handle((id: string) => workspaceService.get(id)),
  );

  ipcMain.handle(
    CHANNELS.workspace.listByAccount,
    handle((accountId: string) => workspaceService.listByAccount(accountId)),
  );

  ipcMain.handle(
    CHANNELS.workspace.listGitStates,
    handle(() => workspaceService.listGitStates()),
  );

  ipcMain.handle(
    CHANNELS.workspace.getByRootPath,
    handle((accountId: string, rootPath: string) =>
      workspaceService.getByRootPath(accountId, rootPath),
    ),
  );

  ipcMain.handle(
    CHANNELS.workspace.create,
    handle((payload: CreateWorkspacePayload) =>
      workspaceService.create(payload),
    ),
  );

  ipcMain.handle(
    CHANNELS.workspace.createFromSource,
    handle((payload: WorkspaceIntakePayload) =>
      workspaceService.createFromSource(payload),
    ),
  );

  ipcMain.handle(
    CHANNELS.workspace.update,
    handle((id: string, payload: UpdateWorkspacePayload) =>
      workspaceService.update(id, payload),
    ),
  );

  ipcMain.handle(
    CHANNELS.workspace.delete,
    handle((id: string, options?: DeleteWorkspaceOptions) =>
      workspaceService.delete(id, options),
    ),
  );

  ipcMain.handle(
    CHANNELS.workspace.archive,
    handle((id: string) => workspaceService.archive(id)),
  );

  ipcMain.handle(
    CHANNELS.workspace.unarchive,
    handle((id: string) => workspaceService.unarchive(id)),
  );

  // ── git operations (see CONTEXT.md "Workspace git operations") ──
  ipcMain.handle(
    CHANNELS.workspace.createBranch,
    handle((id: string, branch: string) =>
      workspaceService.createBranch(id, branch),
    ),
  );

  ipcMain.handle(
    CHANNELS.workspace.renameBranch,
    handle((id: string, newBranchName: string) =>
      workspaceService.renameBranch(id, newBranchName),
    ),
  );

  ipcMain.handle(
    CHANNELS.workspace.switchBranch,
    handle((id: string, branch: string) =>
      workspaceService.switchBranch(id, branch),
    ),
  );

  ipcMain.handle(
    CHANNELS.workspace.discardPaths,
    handle((id: string, paths: string[]) =>
      workspaceService.discardPaths(id, paths),
    ),
  );

  // Native dialog — needs the focused window, so it stays hand-written.
  ipcMain.handle(CHANNELS.workspace.selectDirectory, async () => {
    const window = BrowserWindow.getFocusedWindow();

    const result = window
      ? await dialog.showOpenDialog(window, {
          properties: ["openDirectory"],
          title: "Select Project Folder",
          buttonLabel: "Select",
        })
      : await dialog.showOpenDialog({
          properties: ["openDirectory"],
          title: "Select Project Folder",
          buttonLabel: "Select",
        });

    if (result.canceled || result.filePaths.length === 0) {
      return ok(null);
    }

    return ok(result.filePaths[0]);
  });

  // ── activity ──
  ipcMain.handle(
    CHANNELS.workspace.listActivity,
    handle((workspaceId: string, limit?: number) =>
      workspaceService.listActivity(workspaceId, limit),
    ),
  );

  ipcMain.handle(
    CHANNELS.workspace.createActivity,
    handle((payload: CreateActivityPayload) =>
      workspaceService.createActivity(payload),
    ),
  );

  ipcMain.handle(
    CHANNELS.workspace.createManyActivity,
    handle((payloads: CreateActivityPayload[]) =>
      workspaceService.createManyActivity(payloads),
    ),
  );

  ipcMain.handle(
    CHANNELS.workspace.deleteActivity,
    handle((id: string) => workspaceService.deleteActivity(id)),
  );

  // ── diffs ──
  ipcMain.handle(
    CHANNELS.workspace.listDiffs,
    handle((workspaceId: string, limit?: number) =>
      workspaceService.listDiffs(workspaceId, limit),
    ),
  );

  ipcMain.handle(
    CHANNELS.workspace.getLatestDiff,
    handle((workspaceId: string) =>
      workspaceService.getLatestDiff(workspaceId),
    ),
  );

  ipcMain.handle(
    CHANNELS.workspace.getLatestDiffSummary,
    handle((workspaceId: string) =>
      workspaceService.getLatestDiffSummary(workspaceId),
    ),
  );

  ipcMain.handle(
    CHANNELS.workspace.getDiffByRun,
    handle((runId: string) => workspaceService.getDiffByRun(runId)),
  );

  ipcMain.handle(
    CHANNELS.workspace.deleteLatestDiff,
    handle((workspaceId: string) =>
      workspaceService.deleteLatestDiff(workspaceId),
    ),
  );

  ipcMain.handle(
    CHANNELS.workspace.resyncDiff,
    handle((workspaceId: string) => workspaceService.resyncDiff(workspaceId)),
  );

  // ── reviews ──
  ipcMain.handle(
    CHANNELS.workspace.listReviews,
    handle((workspaceId: string, limit?: number) =>
      workspaceService.listReviews(workspaceId, limit),
    ),
  );

  ipcMain.handle(
    CHANNELS.workspace.getReview,
    handle((id: string) => workspaceService.getReview(id)),
  );

  ipcMain.handle(
    CHANNELS.workspace.createReview,
    handle((payload: CreateReviewPayload) =>
      workspaceService.createReview(payload),
    ),
  );

  ipcMain.handle(
    CHANNELS.workspace.updateReview,
    handle((id: string, payload: UpdateReviewPayload) =>
      workspaceService.updateReview(id, payload),
    ),
  );

  ipcMain.handle(
    CHANNELS.workspace.deleteReview,
    handle((id: string) => workspaceService.deleteReview(id)),
  );

  // ── findings ──
  ipcMain.handle(
    CHANNELS.workspace.listFindings,
    handle((reviewId: string, limit?: number) =>
      workspaceService.listFindings(reviewId, limit),
    ),
  );

  ipcMain.handle(
    CHANNELS.workspace.listFindingsByWorkspace,
    handle((workspaceId: string) =>
      workspaceService.listFindingsByWorkspace(workspaceId),
    ),
  );

  ipcMain.handle(
    CHANNELS.workspace.getFinding,
    handle((id: string) => workspaceService.getFinding(id)),
  );

  ipcMain.handle(
    CHANNELS.workspace.createFinding,
    handle((payload: CreateReviewFindingPayload) =>
      workspaceService.createFinding(payload),
    ),
  );

  ipcMain.handle(
    CHANNELS.workspace.createManyFindings,
    handle((payloads: CreateReviewFindingPayload[]) =>
      workspaceService.createManyFindings(payloads),
    ),
  );

  ipcMain.handle(
    CHANNELS.workspace.updateFinding,
    handle((id: string, payload: UpdateReviewFindingPayload) =>
      workspaceService.updateFinding(id, payload),
    ),
  );

  ipcMain.handle(
    CHANNELS.workspace.deleteFinding,
    handle((id: string) => workspaceService.deleteFinding(id)),
  );
}

export function unregisterWorkspaceIpc(): void {
  [
    // lifecycle
    CHANNELS.workspace.list,
    CHANNELS.workspace.listArchived,
    CHANNELS.workspace.get,
    CHANNELS.workspace.listByAccount,
    CHANNELS.workspace.listGitStates,
    CHANNELS.workspace.getByRootPath,
    CHANNELS.workspace.create,
    CHANNELS.workspace.createFromSource,
    CHANNELS.workspace.update,
    CHANNELS.workspace.delete,
    CHANNELS.workspace.archive,
    CHANNELS.workspace.unarchive,
    CHANNELS.workspace.createBranch,
    CHANNELS.workspace.renameBranch,
    CHANNELS.workspace.switchBranch,
    CHANNELS.workspace.discardPaths,
    CHANNELS.workspace.selectDirectory,
    // activity
    CHANNELS.workspace.listActivity,
    CHANNELS.workspace.createActivity,
    CHANNELS.workspace.createManyActivity,
    CHANNELS.workspace.deleteActivity,
    // diffs
    CHANNELS.workspace.listDiffs,
    CHANNELS.workspace.getLatestDiff,
    CHANNELS.workspace.getLatestDiffSummary,
    CHANNELS.workspace.getDiffByRun,
    CHANNELS.workspace.deleteLatestDiff,
    CHANNELS.workspace.resyncDiff,
    // reviews
    CHANNELS.workspace.listReviews,
    CHANNELS.workspace.getReview,
    CHANNELS.workspace.createReview,
    CHANNELS.workspace.updateReview,
    CHANNELS.workspace.deleteReview,
    // findings
    CHANNELS.workspace.listFindings,
    CHANNELS.workspace.listFindingsByWorkspace,
    CHANNELS.workspace.getFinding,
    CHANNELS.workspace.createFinding,
    CHANNELS.workspace.createManyFindings,
    CHANNELS.workspace.updateFinding,
    CHANNELS.workspace.deleteFinding,
  ].forEach((channel) => ipcMain.removeHandler(channel));
  workspaceService.stopGitStateWatchers();
}
