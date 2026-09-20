import type {
  PendingApproval,
  ToolApprovalRequest,
  ToolApprovalResponse,
} from "./runs.dto";
import { appSettingsService } from "../appSettings";
import { emit } from "../../ipc-kit";
import { CHANNELS } from "../../../shared/ipc-kit/channels";
import {
  showApprovalNotification,
  type ApprovalNotificationHandle,
} from "./run-notifications";

/**
 * Singleton broker that manages pending tool-approval requests.
 *
 * Flow:
 *  1. The Claude adapter's PreToolUse hook calls `requestToolApproval(req)`.
 *  2. The broker creates a Promise, stores its resolve fn, and broadcasts
 *     the request to every open BrowserWindow via IPC push.
 *  3. The renderer displays a dialog; the user clicks Allow/Deny (or answers).
 *  4. The renderer calls `window.api.runs.respondToolApproval(response)`.
 *  5. The main-process IPC handler calls `handleToolApprovalResponse(resp)`.
 *  6. The stored resolve fn fires → the awaiting hook gets the result.
 *
 * The OS notification is a second place to answer from (see
 * `run-notifications.ts`): its buttons call `handleToolApprovalResponse` like
 * the dialog does, and every settlement — from any client, a timeout, or a
 * cancel — takes the notification down with it.
 */

const REQUEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface PendingRequest {
  runId: string;
  /** Kept so a client that missed the broadcast can still read the request. */
  request: ToolApprovalRequest;
  expiresAt: number;
  resolve: (response: ToolApprovalResponse) => void;
  timer: NodeJS.Timeout;
  /** The OS notification for this request, once shown. */
  notification?: ApprovalNotificationHandle;
}

const pending = new Map<string, PendingRequest>();

/**
 * Resolve one pending request and take down its notification. `broadcast`
 * tells every client it is settled; only shutdown skips that, since nobody is
 * left to tell.
 */
function settle(
  requestId: string,
  response: ToolApprovalResponse,
  { broadcast = true }: { broadcast?: boolean } = {},
): void {
  const entry = pending.get(requestId);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(requestId);
  entry.notification?.close();
  entry.resolve(response);
  if (broadcast) {
    emit(
      CHANNELS.runs.toolApprovalResolved,
      { requestId },
      { runId: entry.runId },
    );
  }
}

function notifyRequest(req: ToolApprovalRequest): void {
  appSettingsService
    .getSettings()
    .then(async (settings) => {
      if (!settings?.notifyOnToolApproval) return;
      const notification = await showApprovalNotification(req, {
        isPending: () => pending.has(req.requestId),
        respond: handleToolApprovalResponse,
      });
      if (!notification) return;
      const entry = pending.get(req.requestId);
      // Settled while the notification was going up — take it straight down.
      if (entry) entry.notification = notification;
      else notification.close();
    })
    .catch((error) => {
      console.warn("[runs] could not show the approval notification:", error);
    });
}

/**
 * Broadcast a tool-approval request to all renderer windows and
 * return a Promise that resolves when the user responds (or times out).
 */
export function requestToolApproval(
  req: ToolApprovalRequest,
): Promise<ToolApprovalResponse> {
  return new Promise<ToolApprovalResponse>((resolve) => {
    const requestedTimeout = req.autoResolutionMs;
    const timeoutMs =
      typeof requestedTimeout === "number" &&
      Number.isFinite(requestedTimeout) &&
      requestedTimeout > 0
        ? Math.min(requestedTimeout, REQUEST_TIMEOUT_MS)
        : REQUEST_TIMEOUT_MS;
    // Auto-deny after timeout
    const timer = setTimeout(() => {
      settle(req.requestId, { requestId: req.requestId, approved: false });
    }, timeoutMs);

    pending.set(req.requestId, {
      runId: req.runId,
      request: req,
      expiresAt: Date.now() + timeoutMs,
      resolve,
      timer,
    });

    // Push to all clients via the event bus (local renderer and/or remote).
    emit(CHANNELS.runs.toolApprovalRequest, req, { runId: req.runId });

    notifyRequest(req);
  });
}

/**
 * Every request still waiting on an answer, oldest first — what a client that
 * wasn't connected when the request was broadcast (a phone waking up on a
 * push) asks for. Process memory only, deliberately: a Mac restart loses the
 * run that asked, so there is nothing durable to recover yet
 * (docs/design/mobile-app.md §5.5, transitional design).
 */
export function listPendingApprovals(runId?: string): PendingApproval[] {
  const out: PendingApproval[] = [];
  for (const entry of pending.values()) {
    if (runId && entry.runId !== runId) continue;
    out.push({ ...entry.request, expiresAt: entry.expiresAt });
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Resolve a pending approval request with the user's response.
 * Called from the IPC handler when the renderer sends back a decision.
 */
export function handleToolApprovalResponse(resp: ToolApprovalResponse): void {
  // The client that answered already dismissed its dialog; every other client
  // (a phone showing the same request) learns here that it is settled.
  settle(resp.requestId, resp);
}

/** Resolve one provider-owned request as denied when the provider closes it. */
export function cancelPendingRequest(requestId: string): void {
  for (const pendingId of [...pending.keys()]) {
    if (
      pendingId !== requestId &&
      !pendingId.startsWith(`${requestId}-q`)
    ) {
      continue;
    }
    settle(pendingId, { requestId: pendingId, approved: false });
  }
}

/**
 * Cancel all pending requests for a specific run (e.g. on abort).
 * Each pending request resolves as denied.
 */
export function cancelPendingRequests(runId: string): void {
  for (const [requestId, entry] of [...pending]) {
    if (entry.runId === runId) {
      settle(requestId, { requestId, approved: false });
    }
  }
}

/**
 * Cancel every pending request (e.g. on shutdown).
 */
export function clearAllPendingRequests(): void {
  for (const requestId of [...pending.keys()]) {
    settle(requestId, { requestId, approved: false }, { broadcast: false });
  }
}
