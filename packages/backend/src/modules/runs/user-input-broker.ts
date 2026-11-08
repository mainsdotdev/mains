import type { PendingApproval, ToolApprovalRequest, ToolApprovalResponse } from "./runs.dto";
import { appSettingsService } from "../appSettings";
import { emit } from "../../ipc-kit";
import { CHANNELS } from "@mains/contracts/channels";
import { showApprovalNotification } from "./run-notification-sink";
import { createApprovalLifecycle } from "./user-input-lifecycle";

const lifecycle = createApprovalLifecycle({
  pending(lease) {
    const { request } = lease;
    emit(CHANNELS.runs.toolApprovalRequest, request, { runId: request.runId });
    void appSettingsService.getSettings().then(async (settings) => {
      if (!settings?.notifyOnToolApproval || !lease.current()) return;
      const notification = await showApprovalNotification(request, {
        isPending: lease.current,
        respond(response) {
          if (!lease.current()) return;
          try { lifecycle.respond({ ...response, approvalToken: request.approvalToken }); }
          catch (error) { console.warn("[approvals] Notification decision was refused", error); }
        },
      });
      if (notification) lease.attach(notification);
    }).catch((error) => { console.warn("[runs] Could not show approval notification:", error); });
  },
  settled(request, broadcast) {
    if (broadcast) emit(CHANNELS.runs.toolApprovalResolved, { requestId: request.requestId, approvalToken: request.approvalToken }, { runId: request.runId });
  },
});

export function requestToolApproval(request: ToolApprovalRequest): Promise<ToolApprovalResponse> { return lifecycle.request(request); }
export function listPendingApprovals(runId?: string): PendingApproval[] { return lifecycle.list(runId); }
export function handleToolApprovalResponse(response: ToolApprovalResponse): boolean { return lifecycle.respond(response); }
export function cancelPendingRequest(requestId: string): void { lifecycle.cancel(requestId); }
export function cancelPendingRequests(runId: string): void { lifecycle.cancelRun(runId); }
export function clearAllPendingRequests(): void { lifecycle.clear(); }
export function closeApprovalRequests(): void { lifecycle.close(); }
export function openApprovalRequests(): void { lifecycle.open(); }
