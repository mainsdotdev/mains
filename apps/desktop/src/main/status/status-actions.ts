import { Notification } from "electron";
import { CHANNELS } from "../../shared/ipc-kit/channels";
import { emit } from "../ipc-kit";
import { reopenMainWindow, requestWindow } from "../windows";
import { appSettingsService } from "../modules/appSettings";
import { appshotsService } from "../modules/appshots";
import {
  handleToolApprovalResponse,
  listPendingApprovals,
  openRunInWindow,
  responseFromNotification,
  runsService,
} from "../modules/runs";
import { updatesService } from "../modules/updates";
import type { TrayActions } from "./status-menus";

/** What the menu bar and Dock menu items do — the same for both. */

function warnOnFailure(what: string) {
  return (error: unknown) => console.warn(`[status] ${what} failed:`, error);
}

export const statusActions: TrayActions = {
  answerApproval(requestId, actionIndex) {
    const request = listPendingApprovals().find((r) => r.requestId === requestId);
    if (!request) return;
    const response = responseFromNotification(request, {
      type: "action",
      index: actionIndex,
    });
    if (response) handleToolApprovalResponse(response);
  },
  openRun(runId) {
    void openRunInWindow(runId).catch(warnOnFailure("opening the run"));
  },
  stopRun(runId) {
    void runsService.abortRun(runId).catch(warnOnFailure("stopping the run"));
  },
  openWorkspace(workspaceId) {
    requestWindow({ kind: "openWorkspace", workspaceId });
  },
  newChat() {
    requestWindow({ kind: "newChat" });
  },
  navigate(path) {
    requestWindow({ kind: "navigate", path });
  },
  captureWindow() {
    void appshotsService.captureAndDeliver().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      new Notification({ title: "Couldn't capture the window", body: message }).show();
    });
  },
  setPreventSleep(enabled) {
    void appSettingsService
      .updateSettings({ preventSleepDuringRuns: enabled })
      // The window didn't make this change — tell it, so Settings isn't stale.
      .then(() => emit(CHANNELS.appSettings.changed, {}))
      .catch(warnOnFailure("updating the sleep setting"));
  },
  installUpdate() {
    try {
      updatesService.quitAndInstall();
    } catch (error) {
      warnOnFailure("installing the update")(error);
    }
  },
  checkForUpdates() {
    void updatesService.checkForUpdates().catch(warnOnFailure("checking for updates"));
  },
  showWindow() {
    reopenMainWindow();
  },
};
