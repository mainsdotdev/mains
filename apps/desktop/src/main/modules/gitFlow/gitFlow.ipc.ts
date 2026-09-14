// ─────────────────────────────────────────────────────────────
// Git Flow IPC Handlers — throw-style service, envelope applied
// by handle().
// ─────────────────────────────────────────────────────────────

import { ipcMain } from "../../ipc-kit/ipc-main";
import { handle } from "../../ipc-kit/handle";
import { gitFlowService } from "./gitFlow.service";
import { CHANNELS } from "../../../shared/ipc-kit/channels";

export function registerGitFlowIpc(): void {
  ipcMain.handle(
    CHANNELS.gitFlow.getStatus,
    handle((workspaceId: string) => gitFlowService.getStatus(workspaceId)),
  );

  ipcMain.handle(
    CHANNELS.gitFlow.commit,
    handle(
      (payload: {
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
      (payload: {
        workspaceId: string;
        title?: string;
        body?: string;
        base?: string;
        draft?: boolean;
        providerId?: string;
        model?: string;
      }) => gitFlowService.createPr(payload),
    ),
  );

  ipcMain.handle(
    CHANNELS.gitFlow.generateCommitMessage,
    handle(
      (payload: {
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
    CHANNELS.gitFlow.generateCommitMessage,
    CHANNELS.gitFlow.generatePrBody,
    CHANNELS.gitFlow.getPublishPreflight,
    CHANNELS.gitFlow.publish,
  ].forEach((channel) => ipcMain.removeHandler(channel));
}
