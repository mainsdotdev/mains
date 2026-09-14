// ─────────────────────────────────────────────────────────────
// Pull Requests IPC Handlers
// ─────────────────────────────────────────────────────────────

import { ipcMain } from "../../ipc-kit/ipc-main";
import { handle } from "../../ipc-kit/handle";
import { CHANNELS } from "../../../shared/ipc-kit/channels";
import {
  pullRequestsService,
  type PrRefInput,
  type PrSearchInput,
} from "./pullRequests.service";
import type { PrMergeMethod } from "./sources/source.types";

export function registerPullRequestsIpc(): void {
  ipcMain.handle(
    CHANNELS.pullRequests.getAvailability,
    handle((provider?: string) => pullRequestsService.getAvailability(provider)),
  );

  ipcMain.handle(
    CHANNELS.pullRequests.search,
    handle((input: PrSearchInput = {}) => pullRequestsService.search(input)),
  );

  ipcMain.handle(
    CHANNELS.pullRequests.getDetail,
    handle((input: PrRefInput) => pullRequestsService.getDetail(input)),
  );

  ipcMain.handle(
    CHANNELS.pullRequests.getDiff,
    handle((input: PrRefInput) => pullRequestsService.getDiff(input)),
  );

  ipcMain.handle(
    CHANNELS.pullRequests.merge,
    handle((input: PrRefInput & { method?: PrMergeMethod }) =>
      pullRequestsService.merge(input),
    ),
  );

  ipcMain.handle(
    CHANNELS.pullRequests.markReady,
    handle((input: { provider?: string; nodeId: string }) =>
      pullRequestsService.markReady(input),
    ),
  );

  ipcMain.handle(
    CHANNELS.pullRequests.addComment,
    handle((input: PrRefInput & { body?: string }) =>
      pullRequestsService.addComment(input),
    ),
  );

  ipcMain.handle(
    CHANNELS.pullRequests.addReviewComment,
    handle(
      (
        input: PrRefInput & {
          path?: string;
          line?: number;
          side?: string;
          body?: string;
        },
      ) => pullRequestsService.addReviewComment(input),
    ),
  );

  ipcMain.handle(
    CHANNELS.pullRequests.replyToThread,
    handle((input: { provider?: string; threadId: string; body?: string }) =>
      pullRequestsService.replyToThread(input),
    ),
  );

  ipcMain.handle(
    CHANNELS.pullRequests.resolveThread,
    handle((input: { provider?: string; threadId: string; resolved: boolean }) =>
      pullRequestsService.resolveThread(input),
    ),
  );
}

export function unregisterPullRequestsIpc(): void {
  [
    CHANNELS.pullRequests.getAvailability,
    CHANNELS.pullRequests.search,
    CHANNELS.pullRequests.getDetail,
    CHANNELS.pullRequests.getDiff,
    CHANNELS.pullRequests.merge,
    CHANNELS.pullRequests.markReady,
    CHANNELS.pullRequests.addComment,
    CHANNELS.pullRequests.addReviewComment,
    CHANNELS.pullRequests.replyToThread,
    CHANNELS.pullRequests.resolveThread,
  ].forEach((channel) => ipcMain.removeHandler(channel));
}
