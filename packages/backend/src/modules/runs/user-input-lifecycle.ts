import { createHash, randomUUID } from "node:crypto";
import type { PendingApproval, ToolApprovalRequest, ToolApprovalResponse } from "@mains/contracts/runs";

const signature = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const canceled = (request: ToolApprovalRequest): ToolApprovalResponse => ({
  requestId: request.requestId, approved: false,
  ...(request.kind === "elicitation" ? { answer: "cancel" } : {}),
});
export interface ApprovalLease {
  request: ToolApprovalRequest;
  expiresAt: number;
  current(): boolean;
  attach(notification: { close(): void }): void;
}

/** Approval admission, deadline, correlation and one settlement live here.
 * Provider request ids may be reused; client decisions bind to one incarnation.
 * Completed receipts retain hashes rather than secret question/form answers. */
export function createApprovalLifecycle(callbacks: {
  pending(lease: ApprovalLease): void;
  settled(request: ToolApprovalRequest, broadcast: boolean): void;
}) {
  type Entry = ApprovalLease & {
    resolve(response: ToolApprovalResponse): void;
    promise: Promise<ToolApprovalResponse>;
    signature: string;
    legacy: boolean;
    timer: ReturnType<typeof setTimeout>;
    notification?: { close(): void };
  };
  const pending = new Map<string, Entry>();
  const receipts = new Map<string, { token?: string; signature: string; restricted: boolean }>();
  let open = true;
  const effective = (response: ToolApprovalResponse, restricted: boolean): ToolApprovalResponse => ({
    requestId: response.requestId, approved: response.approved,
    ...(response.answer !== undefined && !(restricted && response.answer === "acceptForSession") ? { answer: response.answer } : {}),
  });
  function settle(entry: Entry, response: ToolApprovalResponse, broadcast = true): boolean {
    if (!entry.current()) return false;
    const restricted = entry.request.kind === "tool_approval" && !!entry.request.suppressAlwaysAllowRule;
    const result = effective(response, restricted);
    pending.delete(entry.request.requestId);
    clearTimeout(entry.timer);
    receipts.set(entry.request.requestId, { token: entry.request.approvalToken, signature: signature(result), restricted });
    entry.resolve(result);
    try { entry.notification?.close(); } catch (error) { console.warn("[approvals] Could not close notification", error); }
    try { callbacks.settled(entry.request, broadcast); } catch (error) { console.warn("[approvals] Could not publish settlement", error); }
    return true;
  }
  return {
    request(input: ToolApprovalRequest): Promise<ToolApprovalResponse> {
      if (!open) return Promise.reject(new Error("Approval requests are shutting down"));
      const key = signature(input), existing = pending.get(input.requestId);
      if (existing) return existing.signature === key ? existing.promise : Promise.reject(new Error("This approval id already belongs to another request."));
      const request = { ...structuredClone(input), approvalToken: randomUUID() };
      const requested = request.autoResolutionMs;
      const duration = typeof requested === "number" && Number.isFinite(requested) && requested > 0 ? Math.min(requested, 300_000) : 300_000;
      let resolve!: Entry["resolve"];
      const promise = new Promise<ToolApprovalResponse>((done) => { resolve = done; });
      const entry: Entry = {
        request, promise, resolve, signature: key, legacy: !receipts.has(request.requestId),
        expiresAt: Date.now() + duration,
        current: () => pending.get(request.requestId) === entry,
        timer: setTimeout(() => settle(entry, canceled(request)), duration),
        attach(notification) {
          if (entry.current()) entry.notification = notification;
          else { try { notification.close(); } catch (error) { console.warn("[approvals] Could not close retired notification", error); } }
        },
      };
      pending.set(request.requestId, entry);
      try { callbacks.pending(entry); } catch (error) { console.warn("[approvals] Could not publish request", error); }
      return promise;
    },
    respond(response: ToolApprovalResponse): boolean {
      if (!response || typeof response.requestId !== "string" || !response.requestId || typeof response.approved !== "boolean" ||
          response.answer !== undefined && typeof response.answer !== "string" ||
          response.approvalToken !== undefined && (typeof response.approvalToken !== "string" || !response.approvalToken)) throw new Error("Invalid approval response");
      const entry = pending.get(response.requestId), receipt = receipts.get(response.requestId);
      if (!entry) {
        if (receipt && (!response.approvalToken || response.approvalToken === receipt.token) && signature(effective(response, receipt.restricted)) === receipt.signature) return true;
        throw new Error("This approval is no longer pending. Refresh the conversation.");
      }
      if (response.approvalToken ? response.approvalToken !== entry.request.approvalToken : !entry.legacy) throw new Error("This approval changed. Refresh the conversation before answering.");
      if (Date.now() >= entry.expiresAt) { settle(entry, canceled(entry.request)); throw new Error("This approval expired."); }
      return settle(entry, response);
    },
    list(runId?: string): PendingApproval[] {
      return [...pending.values()].filter((entry) => !runId || entry.request.runId === runId)
        .map((entry) => ({ ...structuredClone(entry.request), expiresAt: entry.expiresAt })).sort((a, b) => a.timestamp - b.timestamp);
    },
    cancel(requestId: string) {
      for (const [id, entry] of pending) if (id === requestId || id.startsWith(`${requestId}-q`)) settle(entry, canceled(entry.request));
    },
    cancelRun(runId: string) { for (const entry of pending.values()) if (entry.request.runId === runId) settle(entry, canceled(entry.request)); },
    clear() { for (const entry of pending.values()) settle(entry, canceled(entry.request), false); receipts.clear(); },
    close() { open = false; for (const entry of pending.values()) settle(entry, canceled(entry.request), false); },
    open() { if (!open) { receipts.clear(); open = true; } },
  };
}
