import { Notification } from "electron";
import { requestWindow } from "../../windows";
import {
  describeApprovalNotification,
  responseFromNotification,
  runsService,
  formatRunLabel,
  type NotificationInteraction,
  type RunResponse,
  type ToolApprovalRequest,
  type ToolApprovalResponse,
  ApprovalNotificationHandle,
  RunNotificationSink,
} from "@mains/backend/modules/runs";

/**
 * The run's OS notifications: a pending request (answerable from the banner
 * where it can be — see `approval-notification.ts`) and a finished run. A click
 * on either opens that run in the window (`openRunInWindow`, which the menu bar
 * uses too).
 *
 * Electron drops a Notification's listeners once the object is garbage
 * collected, so a notification nobody references stops answering clicks. The
 * approval one is held by its broker entry until the request settles; finished
 * ones are held here, newest few only.
 */

const MAX_RETAINED_FINISHED = 20;
const retainedFinished: Notification[] = [];

async function findRun(runId: string): Promise<RunResponse | null> {
  try {
    return await runsService.getRunById(runId);
  } catch {
    return null;
  }
}

/**
 * Bring the window forward on a run — from a notification, or the menu bar.
 * An unknown run still brings the window up; there is just nothing to open.
 */
export async function openRunInWindow(runId: string): Promise<void> {
  const run = await findRun(runId);
  if (!run) {
    requestWindow({ kind: "navigate", path: "/code" });
    return;
  }
  requestWindow({
    kind: "openRun",
    run: {
      runId: run.id,
      workspaceId: run.workspaceId,
      collectionId: run.collectionId,
      spaceId: run.spaceId,
      providerId: run.providerId,
      mode: run.mode,
    },
  });
}

/**
 * Show the notification for a pending request. Resolves to null when there is
 * nothing to show — notifications unsupported, or the request was settled
 * while the run was being looked up.
 */
export async function showApprovalNotification(
  req: ToolApprovalRequest,
  handlers: {
    isPending: () => boolean;
    respond: (response: ToolApprovalResponse) => void;
  },
): Promise<ApprovalNotificationHandle | null> {
  if (!Notification.isSupported()) return null;
  const run = await findRun(req.runId);
  if (!handlers.isPending()) return null;

  const spec = describeApprovalNotification(req, run ? formatRunLabel(run) : null);
  const notification = new Notification({
    title: spec.title,
    ...(spec.subtitle ? { subtitle: spec.subtitle } : {}),
    body: spec.body,
    actions: spec.actions.map((text) => ({ type: "button" as const, text })),
    hasReply: spec.hasReply,
    ...(spec.hasReply ? { replyPlaceholder: "Type your answer" } : {}),
  });

  const answer = (interaction: NotificationInteraction) => {
    const response = responseFromNotification(req, interaction);
    if (response) handlers.respond(response);
    else void openRunInWindow(req.runId);
  };
  notification.on("action", (details, legacyIndex) =>
    answer({ type: "action", index: details?.actionIndex ?? legacyIndex }),
  );
  notification.on("reply", (details, legacyReply) =>
    answer({ type: "reply", text: details?.reply ?? legacyReply ?? "" }),
  );
  notification.on("click", () => void openRunInWindow(req.runId));
  notification.on("failed", (_event, error) =>
    console.warn(`[runs] approval notification failed: ${error}`),
  );
  notification.show();
  return { close: () => notification.close() };
}

export function showRunFinishedNotification(runId: string, status: string): void {
  if (!Notification.isSupported()) return;
  const succeeded = status === "succeeded";
  const notification = new Notification({
    title: succeeded ? "Run Completed" : "Run Failed",
    body: succeeded ? "Run finished successfully" : "Run failed",
  });
  const release = () => {
    const index = retainedFinished.indexOf(notification);
    if (index >= 0) retainedFinished.splice(index, 1);
  };
  notification.on("click", () => {
    release();
    void openRunInWindow(runId);
  });
  notification.on("close", release);
  retainedFinished.push(notification);
  if (retainedFinished.length > MAX_RETAINED_FINISHED) retainedFinished.shift();
  notification.show();
}

export function createElectronRunNotificationSink(): RunNotificationSink {
  return {
    showApproval: showApprovalNotification,
    showFinished: showRunFinishedNotification,
  };
}
