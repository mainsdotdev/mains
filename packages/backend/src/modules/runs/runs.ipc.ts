import { ipcMain } from "../../ipc-kit/ipc-main";
import { handle } from "../../ipc-kit/handle";
import { ok } from "@mains/contracts/service-response";
import type { IpcInvokeContext } from "../../ipc-kit/handler-registry";
import { runsService } from "./runs.service";
import { runForPairedDevice } from "./runs.device-projection";
import type {
  CreateRunPayload,
  UpdateRunPayload,
  CreateRunContextPayload,
  CreateRunArtifactPayload,
  RunStatus,
  StartRunPayload,
  ContinueRunPayload,
  ForkRunPayload,
  ReviewRunPayload,
  ToolApprovalResponse,
  RunExperienceOptions,
  WorkspaceRunListOptions,
  MoveRunToCollectionPayload,
  SetRunPinnedPayload,
} from "./runs.dto";
import {
  handleToolApprovalResponse,
  listPendingApprovals,
} from "./user-input-broker";
import { CHANNELS } from "@mains/contracts/channels";
import type { ConversationSettings } from "@mains/contracts/run-settings";
import type { ListRunOutputsPayload, ReadRunOutputPayload, ReadRunAttachmentPayload } from "@mains/contracts/run-outputs";
import type { AnswerAsyncQuestionsPayload, DismissAsyncQuestionsPayload } from "@mains/contracts/async-questions";
import type { CreateRealtimeConversationPayload, RunRealtimeStartPayload, RunRealtimeStopPayload } from "@mains/contracts/realtime";
import type {
  ReadArtifactImagePayload,
  ReadRunHistoryPayload,
  ReadRunHistoryContentPayload,
  ReadAttachmentImagePayload,
  ResolveAttachmentPathPayload,
  ResolveArtifactPathPayload,
  ReadRunTextFilePayload,
  RunSteerPayload,
  RunInputStatusPayload,
} from "@mains/contracts/runs";

// ─────────────────────────────────────────────────────────────
// IPC Channel Names
// ─────────────────────────────────────────────────────────────
// IPC Handlers
// ─────────────────────────────────────────────────────────────
export function registerRunsIpc(): void {
  const getHistory = handle((payload: ReadRunHistoryPayload) => runsService.getHistoryPage(payload));
  ipcMain.handle(CHANNELS.runs.getHistory, (ctx: IpcInvokeContext, payload: ReadRunHistoryPayload) =>
    getHistory(ctx, ctx?.deviceId ? { ...payload, profile: "mobile" } : payload));
  ipcMain.handle(CHANNELS.runs.readHistoryContent, handle((payload: ReadRunHistoryContentPayload) => runsService.readHistoryContent(payload)));
  ipcMain.handle(CHANNELS.runs.listOutputs, handle((payload: ListRunOutputsPayload) => runsService.listOutputs(payload)));
  ipcMain.handle(CHANNELS.runs.readOutputFile, handle((payload: ReadRunOutputPayload) => runsService.readOutputFile(payload)));
  ipcMain.handle(CHANNELS.runs.createRealtimeConversation, handle((payload: CreateRealtimeConversationPayload) => runsService.createRealtimeConversation(payload)));
  ipcMain.handle(CHANNELS.runs.startRealtime, handle((payload: RunRealtimeStartPayload) => runsService.startRealtime(payload)));
  ipcMain.handle(CHANNELS.runs.stopRealtime, handle((payload: RunRealtimeStopPayload) => runsService.stopRealtime(payload)));
  // Runs
  const getAll = handle((limit?: number) => runsService.getAllRuns(limit));
  ipcMain.handle(CHANNELS.runs.getAll, async (ctx: IpcInvokeContext, limit?: number) => {
    const result = await getAll(ctx, ctx?.deviceId ? Math.min(Math.max(limit ?? 100, 1), 100) : limit);
    return ctx?.deviceId && result.success ? ok(result.data.map(runForPairedDevice)) : result;
  });

  ipcMain.handle(
    CHANNELS.runs.listArchived,
    handle(() => runsService.listArchivedRuns()),
  );

  ipcMain.handle(
    CHANNELS.runs.listActive,
    handle(() => runsService.listActiveRuns()),
  );

  ipcMain.handle(
    CHANNELS.runs.getExecutionRoot,
    handle((runId: string) => runsService.getRunExecutionRoot(runId)),
  );

  ipcMain.handle(
    CHANNELS.runs.listOutputFiles,
    handle((runId: string) => runsService.listRunOutputFiles(runId)),
  );

  ipcMain.handle(
    CHANNELS.runs.readTextFile,
    handle((payload: ReadRunTextFilePayload) => runsService.readTextFile(payload)),
  );

  ipcMain.handle(
    CHANNELS.runs.listRecent,
    handle((options: RunExperienceOptions) =>
      runsService.listRecentRuns(options),
    ),
  );

  const getById = handle((id: string) => runsService.getRunById(id));
  ipcMain.handle(CHANNELS.runs.getById, async (ctx: IpcInvokeContext, id: string) => {
    const result = await getById(ctx, id);
    return ctx?.deviceId && result.success && result.data ? ok(runForPairedDevice(result.data)) : result;
  });

  ipcMain.handle(
    CHANNELS.runs.getByAccount,
    handle((accountId: string, limit?: number) => runsService.getRunsByAccount(accountId, limit)),
  );

  ipcMain.handle(
    CHANNELS.runs.getByWorkspace,
    handle((workspaceId: string, options?: WorkspaceRunListOptions) =>
      runsService.getRunsByWorkspace(workspaceId, options),
    ),
  );

  ipcMain.handle(
    CHANNELS.runs.getByStatus,
    handle((accountId: string, status: RunStatus) => runsService.getRunsByStatus(accountId, status)),
  );

  ipcMain.handle(
    CHANNELS.runs.create,
    handle((payload: CreateRunPayload) => runsService.createRun(payload)),
  );

  ipcMain.handle(
    CHANNELS.runs.update,
    handle((id: string, payload: UpdateRunPayload) => runsService.updateRun(id, payload)),
  );

  ipcMain.handle(
    CHANNELS.runs.updateConversationSettings,
    handle((id: string, settings: ConversationSettings) =>
      runsService.updateConversationSettings(id, settings),
    ),
  );

  ipcMain.handle(
    CHANNELS.runs.moveToCollection,
    handle((payload: MoveRunToCollectionPayload) =>
      runsService.moveRunToCollection(payload),
    ),
  );

  ipcMain.handle(
    CHANNELS.runs.setPinned,
    handle((payload: SetRunPinnedPayload) => runsService.setRunPinned(payload)),
  );

  ipcMain.handle(
    CHANNELS.runs.start,
    handle((id: string) => runsService.startRun(id)),
  );

  ipcMain.handle(
    CHANNELS.runs.complete,
    handle((id: string) => runsService.completeRun(id)),
  );

  ipcMain.handle(
    CHANNELS.runs.fail,
    handle((id: string, error: string) => runsService.failRun(id, error)),
  );

  ipcMain.handle(
    CHANNELS.runs.cancel,
    handle((id: string) => runsService.cancelRun(id)),
  );

  ipcMain.handle(
    CHANNELS.runs.delete,
    handle((id: string) => runsService.deleteRun(id)),
  );

  ipcMain.handle(
    CHANNELS.runs.archive,
    handle((id: string) => runsService.archiveRun(id)),
  );

  ipcMain.handle(
    CHANNELS.runs.unarchive,
    handle((id: string) => runsService.unarchiveRun(id)),
  );

  ipcMain.handle(
    CHANNELS.runs.getDetails,
    handle((runId: string) => runsService.getRunDetails(runId)),
  );

  ipcMain.handle(
    CHANNELS.runs.execute,
    handle((payload: StartRunPayload) => runsService.executeRun(payload)),
  );

  ipcMain.handle(
    CHANNELS.runs.abort,
    handle((runId: string) => runsService.abortRun(runId)),
  );

  ipcMain.handle(
    CHANNELS.runs.continue,
    handle((payload: ContinueRunPayload) => runsService.continueRun(payload)),
  );

  ipcMain.handle(
    CHANNELS.runs.fork,
    handle((payload: ForkRunPayload) => runsService.forkRun(payload)),
  );

  ipcMain.handle(CHANNELS.runs.steer, handle((payload: RunSteerPayload) => runsService.steerRun(payload)));
  ipcMain.handle(CHANNELS.runs.inputStatus, handle((payload: RunInputStatusPayload) => runsService.getInputStatus(payload)));
  ipcMain.handle(CHANNELS.runs.answerAsyncQuestions, handle((payload: AnswerAsyncQuestionsPayload) => runsService.answerAsyncQuestions(payload)));
  ipcMain.handle(CHANNELS.runs.dismissAsyncQuestions, handle((payload: DismissAsyncQuestionsPayload) => runsService.dismissAsyncQuestions(payload)));

  ipcMain.handle(
    CHANNELS.runs.executeReview,
    handle((payload: ReviewRunPayload) => runsService.executeReview(payload)),
  );

  ipcMain.handle(
    CHANNELS.runs.canResume,
    handle((runId: string) => runsService.canResumeRun(runId)),
  );

  ipcMain.handle(
    CHANNELS.runs.deleteSession,
    handle((runId: string) => runsService.deleteRunSession(runId)),
  );

  // Run Context
  ipcMain.handle(
    CHANNELS.runContext.getByRun,
    handle((runId: string) => runsService.getContextByRun(runId)),
  );

  ipcMain.handle(
    CHANNELS.runContext.add,
    handle((payload: CreateRunContextPayload) => runsService.addContext(payload)),
  );

  ipcMain.handle(
    CHANNELS.runContext.remove,
    handle((id: number) => runsService.removeContext(id)),
  );

  // Run Artifacts
  ipcMain.handle(
    CHANNELS.runArtifacts.getByRun,
    handle((runId: string, sinceId?: number) => runsService.getArtifactsByRun(runId, sinceId)),
  );

  ipcMain.handle(
    CHANNELS.runArtifacts.readImage,
    handle((payload: ReadArtifactImagePayload) => runsService.readArtifactImage(payload)),
  );
  ipcMain.handle(CHANNELS.runArtifacts.readAttachmentImage,
    handle((payload: ReadAttachmentImagePayload) => runsService.readAttachmentImage(payload)));
  ipcMain.handle(CHANNELS.runArtifacts.resolveFilePath,
    handle((payload: ResolveArtifactPathPayload) => runsService.resolveReplicaFile(payload)));
  ipcMain.handle(CHANNELS.runArtifacts.resolveAttachmentPath,
    handle((payload: ResolveAttachmentPathPayload) => runsService.resolveAttachmentPath(payload)));
  ipcMain.handle(CHANNELS.runArtifacts.readAttachmentFile,
    handle((payload: ResolveAttachmentPathPayload) => runsService.readAttachmentFile(payload)));
  ipcMain.handle(CHANNELS.runArtifacts.describeAttachmentFile,
    handle((payload: ResolveAttachmentPathPayload) => runsService.describeAttachmentFile(payload)));
  ipcMain.handle(CHANNELS.runArtifacts.readAttachmentChunk,
    handle((payload: ReadRunAttachmentPayload) => runsService.readAttachmentChunk(payload)));

  ipcMain.handle(
    CHANNELS.runArtifacts.add,
    handle((payload: CreateRunArtifactPayload) => runsService.addArtifact(payload)),
  );

  ipcMain.handle(
    CHANNELS.runArtifacts.remove,
    handle((id: number) => runsService.removeArtifact(id)),
  );


  // Tool Calls
  ipcMain.handle(CHANNELS.runToolCalls.getOutput,
    handle((runId: string, toolId: number) => runsService.getToolOutput(runId, toolId)));
  ipcMain.handle(
    CHANNELS.runToolCalls.getByRun,
    handle((runId: string, sinceUpdatedAt?: Date) => runsService.getToolCallsByRun(runId, sinceUpdatedAt)),
  );

  // Run Turns
  ipcMain.handle(
    CHANNELS.runTurns.getByRun,
    handle((runId: string) => runsService.getTurnsByRun(runId)),
  );
  ipcMain.handle(
    CHANNELS.runTurns.getChangesDiff,
    handle((runId: string, turnId: number) =>
      runsService.getTurnChangesDiff(runId, turnId),
    ),
  );
  ipcMain.handle(
    CHANNELS.runTurns.undoChanges,
    handle((runId: string, turnId: number) =>
      runsService.undoTurnChanges(runId, turnId),
    ),
  );

  // Tool Approval (interactive)
  ipcMain.handle(
    CHANNELS.runs.toolApprovalResponse,
    async (_, response: ToolApprovalResponse) => {
      handleToolApprovalResponse(response);
      return ok(undefined);
    },
  );

  // Requests still waiting on the user — for a client (phone) that connected
  // after the push went out, or is reopening on a notification.
  ipcMain.handle(
    CHANNELS.runs.listPendingApprovals,
    handle((runId?: string) => listPendingApprovals(runId)),
  );
}

export function unregisterRunsIpc(): void {
  ipcMain.removeHandler(CHANNELS.runs.steer);
  ipcMain.removeHandler(CHANNELS.runs.inputStatus);
  ipcMain.removeHandler(CHANNELS.runs.answerAsyncQuestions);
  ipcMain.removeHandler(CHANNELS.runs.dismissAsyncQuestions);
  [
    CHANNELS.runs.getAll,
    CHANNELS.runs.listArchived,
    CHANNELS.runs.listActive,
    CHANNELS.runs.getExecutionRoot,
    CHANNELS.runs.listOutputFiles,
    CHANNELS.runs.listOutputs,
    CHANNELS.runs.readOutputFile,
    CHANNELS.runs.readTextFile,
    CHANNELS.runs.listRecent,
    CHANNELS.runs.getById,
    CHANNELS.runs.getByAccount,
    CHANNELS.runs.getByWorkspace,
    CHANNELS.runs.getByStatus,
    CHANNELS.runs.create,
    CHANNELS.runs.update,
    CHANNELS.runs.updateConversationSettings,
    CHANNELS.runs.moveToCollection,
    CHANNELS.runs.setPinned,
    CHANNELS.runs.start,
    CHANNELS.runs.complete,
    CHANNELS.runs.fail,
    CHANNELS.runs.cancel,
    CHANNELS.runs.delete,
    CHANNELS.runs.archive,
    CHANNELS.runs.unarchive,
    CHANNELS.runs.getDetails,
    CHANNELS.runs.getHistory,
    CHANNELS.runs.readHistoryContent,
    CHANNELS.runs.execute,
    CHANNELS.runs.abort,
    CHANNELS.runs.continue,
    CHANNELS.runs.startRealtime,
    CHANNELS.runs.createRealtimeConversation,
    CHANNELS.runs.stopRealtime,
    CHANNELS.runs.fork,
    CHANNELS.runs.executeReview,
    CHANNELS.runs.canResume,
    CHANNELS.runs.deleteSession,
    CHANNELS.runContext.getByRun,
    CHANNELS.runContext.add,
    CHANNELS.runContext.remove,
    CHANNELS.runArtifacts.getByRun,
    CHANNELS.runArtifacts.readImage,
    CHANNELS.runArtifacts.readAttachmentImage,
    CHANNELS.runArtifacts.resolveAttachmentPath,
    CHANNELS.runArtifacts.resolveFilePath,
    CHANNELS.runArtifacts.readAttachmentFile,
    CHANNELS.runArtifacts.describeAttachmentFile,
    CHANNELS.runArtifacts.readAttachmentChunk,
    CHANNELS.runArtifacts.add,
    CHANNELS.runArtifacts.remove,
    CHANNELS.runToolCalls.getByRun,
    CHANNELS.runToolCalls.getOutput,
    CHANNELS.runTurns.getByRun,
    CHANNELS.runTurns.getChangesDiff,
    CHANNELS.runTurns.undoChanges,
    CHANNELS.runs.toolApprovalResponse,
    CHANNELS.runs.listPendingApprovals,
  ].forEach((channel) => ipcMain.removeHandler(channel));
}
