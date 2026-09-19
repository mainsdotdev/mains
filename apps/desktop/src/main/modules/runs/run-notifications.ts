import { Notification } from "electron";
import { CHANNELS } from "../../../shared/ipc-kit/channels";
import type { RunOpenRequest } from "../../../shared/run-open-request";
import { reopenMainWindow } from "../../windows";
import {
  describeApprovalNotification,
  responseFromNotification,
  type NotificationInteraction,
} from "./approval-notification";
import { runsRepo } from "./runs.repo";
import type {
  RunResponse,
  ToolApprovalRequest,
  ToolApprovalResponse,
} from "./runs.dto";

/**
 * The run's OS notifications: a pending request (answerable from the banner
 * where it can be — see `approval-notification.ts`) and a finished run. A click
 * on either opens that run in the window.
 *
 * Electron drops a Notification's listeners once the object is garbage
 * collected, so a notification nobody references stops answering clicks. The
 * approval one is held by its broker entry until the request settles; finished
 * ones are held here, newest few only.
 */

const MAX_RETAINED_FINISHED = 20;
const retainedFinished: Notification[] = [];

/** A click only counts if the window asks for it soon after. */
const OPEN_REQUEST_TTL_MS = 60_000;
let pendingOpen: { request: RunOpenRequest; at: number } | null = null;

export interface ApprovalNotificationHandle {
  close(): void;
}

function runLabel(run: RunResponse | null): string | null {
  const title = run?.title?.trim();
  if (title) return title;
  return run?.goal?.split("\n").find((line) => line.trim())?.trim() ?? null;
}

async function findRun(runId: string): Promise<RunResponse | null> {
  try {
    return await runsRepo.findRunById(runId);
  } catch {
    return null;
  }
}

/**
 * Bring the window forward on the run a notification was about. The target is
 * parked until the renderer collects it (`consumeRunOpenRequest`): a window
 * that was closed is still loading when the click lands, so the push alone
 * would arrive before anyone listens.
 */
export async function openRunFromNotification(runId: string): Promise<void> {
  const window = reopenMainWindow();
  if (!window) return;
  const run = await findRun(runId);
  if (!run) return;
  pendingOpen = {
    request: {
      runId: run.id,
      workspaceId: run.workspaceId,
      collectionId: run.collectionId,
      spaceId: run.spaceId,
      providerId: run.providerId,
      mode: run.mode,
    },
    at: Date.now(),
  };
  if (!window.isDestroyed()) window.webContents.send(CHANNELS.runs.openRequested);
}

/** Hand the parked open request to the window, once. */
export function consumeRunOpenRequest(): RunOpenRequest | null {
  const parked = pendingOpen;
  pendingOpen = null;
  if (!parked || Date.now() - parked.at > OPEN_REQUEST_TTL_MS) return null;
  return parked.request;
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

  const spec = describeApprovalNotification(req, runLabel(run));
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
    else void openRunFromNotification(req.runId);
  };
  notification.on("action", (details, legacyIndex) =>
    answer({ type: "action", index: details?.actionIndex ?? legacyIndex }),
  );
  notification.on("reply", (details, legacyReply) =>
    answer({ type: "reply", text: details?.reply ?? legacyReply ?? "" }),
  );
  notification.on("click", () => void openRunFromNotification(req.runId));
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
    void openRunFromNotification(runId);
  });
  notification.on("close", release);
  retainedFinished.push(notification);
  if (retainedFinished.length > MAX_RETAINED_FINISHED) retainedFinished.shift();
  notification.show();
}
