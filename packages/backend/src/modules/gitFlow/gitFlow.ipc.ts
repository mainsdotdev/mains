// ─────────────────────────────────────────────────────────────
// Git Flow IPC Handlers — throw-style service, envelope applied
// by handle().
// ─────────────────────────────────────────────────────────────

import { openGitFlow } from "./gitFlow.lifecycle";
import { ipcMain } from "../../ipc-kit/ipc-main";
import { handle } from "../../ipc-kit/handle";
import { gitFlowService } from "./gitFlow.service";
import { CHANNELS } from "@mains/contracts/channels";
import type { CreatePrPayload, PrAttachmentChunk } from "@mains/contracts/pr-attachments";

export function registerGitFlowIpc(): void {
  openGitFlow();
  ipcMain.handle(
    CHANNELS.gitFlow.getStatus,
    handle((workspaceId: string) => gitFlowService.getStatus(workspaceId)),
  );

  ipcMain.handle(
    CHANNELS.gitFlow.commit,
    handle(
      (payload: {
        operationId?: string;
        workspaceId: string;
        message?: string;
        includeUnstaged?: boolean;
        providerId?: string;
        model?: string;
        push?: boolean;
      }) => gitFlowService.commit(payload),
    ),
  );

  ipcMain.handle(
    CHANNELS.gitFlow.push,
    handle((workspaceId: string) => gitFlowService.push(workspaceId)),
  );

  ipcMain.handle(
    CHANNELS.gitFlow.pull,
    handle((workspaceId: string) => gitFlowService.pull(workspaceId)),
  );

  ipcMain.handle(
    CHANNELS.gitFlow.createPr,
    handle(
      (payload: CreatePrPayload) => gitFlowService.createPr(payload),
    ),
  );

  ipcMain.handle(CHANNELS.gitFlow.stagePrAttachment,
    handle((payload: PrAttachmentChunk) => gitFlowService.stagePrAttachment(payload)));
  ipcMain.handle(CHANNELS.gitFlow.discardPrAttachments,
    handle((workspaceId: string, ids: string[]) => gitFlowService.discardPrAttachments(workspaceId, ids)));

  ipcMain.handle(
    CHANNELS.gitFlow.generateCommitMessage,
    handle(
      (payload: {
        operationId?: string;
        workspaceId: string;
        providerId: string;
        model?: string;
        includeUnstaged?: boolean;
        preview?: boolean;
      }) => gitFlowService.generateCommitMessage(payload),
    ),
  );

  ipcMain.handle(
    CHANNELS.gitFlow.generatePrBody,
    handle(
      (payload: {
        operationId?: string;
        workspaceId: string;
        providerId: string;
        model?: string;
        base?: string;
      }) => gitFlowService.generatePrBody(payload),
    ),
  );

  ipcMain.handle(
    CHANNELS.gitFlow.getPublishPreflight,
    handle((workspaceId: string) =>
      gitFlowService.getPublishPreflight(workspaceId),
    ),
  );

  ipcMain.handle(
    CHANNELS.gitFlow.publish,
    handle(
      (payload: {
        operationId?: string;
        workspaceId: string;
        ownerRepo: string;
        visibility: "private" | "public";
        remoteName?: string;
        protocol: "ssh" | "https";
      }) => gitFlowService.publish(payload),
    ),
  );
}

export function unregisterGitFlowIpc(): void {
  [
    CHANNELS.gitFlow.getStatus,
    CHANNELS.gitFlow.commit,
    CHANNELS.gitFlow.push,
    CHANNELS.gitFlow.pull,
    CHANNELS.gitFlow.createPr,
    CHANNELS.gitFlow.stagePrAttachment,
    CHANNELS.gitFlow.discardPrAttachments,
    CHANNELS.gitFlow.generateCommitMessage,
    CHANNELS.gitFlow.generatePrBody,
    CHANNELS.gitFlow.getPublishPreflight,
    CHANNELS.gitFlow.publish,
  ].forEach((channel) => ipcMain.removeHandler(channel));
}
