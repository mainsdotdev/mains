import { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { CHANNELS } from "@mains/contracts/channels";
import type { ServiceResponse } from "@mains/contracts/service-response";
import { appApi, getTransport, onTransportChange, type Transport } from "@/lib/transport";

export interface ToolApprovalRequest {
  requestId: string;
  runId: string;
  toolName: string;
  toolInput?: Record<string, unknown>;
  kind: "tool_approval" | "ask_user" | "elicitation";
  header?: string;
  question?: string;
  options?: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
  isOther?: boolean;
  isSecret?: boolean;
  autoResolutionMs?: number;
  /** MCP server that asked for input (kind: "elicitation"). */
  serverName?: string;
  /** "form" collects schema-driven fields; "url" sends the user to a browser. */
  elicitationMode?: "form" | "url";
  /** Destination to open (elicitationMode: "url"). */
  url?: string;
  /** JSON Schema describing the requested fields (elicitationMode: "form"). */
  requestedSchema?: Record<string, unknown>;
  /** Longer subtitle from the requester's permission-display metadata. */
  description?: string;
  /** Start on decline and disable implicit keyboard approval. */
  defaultToNo?: boolean;
  /** Only this call can be approved; offer no persistent permission grant. */
  suppressAlwaysAllowRule?: boolean;
  timestamp: number;
}

/** Run statuses we consider "finished" — remaining approvals are obsolete. */
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "canceled"]);

interface RunStatusLike {
  id: string;
  status: string;
}

/**
 * Restores the broker's pending requests on mount/reconnect, then keeps them
 * current with pushes. `runs` controls visibility only: leaving a workspace
 * must not discard a request that is still waiting in the backend.
 */
export function useToolApproval(runs?: readonly RunStatusLike[]) {
  const transport = useSyncExternalStore(onTransportChange, getTransport);
  const [state, setState] = useState<{ transport: Transport; approvals: ToolApprovalRequest[] }>(
    () => ({ transport, approvals: [] }),
  );
  // Mutations after a snapshot starts take precedence over that snapshot,
  // including local answers that have not received their resolved push yet.
  const changesDuringRead = useRef<Map<string, ToolApprovalRequest | null> | null>(null);

  useEffect(() => {
    let current = true;
    let readRevision = 0;
    const isCurrent = () => current && getTransport() === transport;
    const update = (edit: (requests: ToolApprovalRequest[]) => ToolApprovalRequest[]) => {
      if (!isCurrent()) return;
      setState((previous) => ({ transport, approvals: edit(previous.transport === transport ? previous.approvals : []) }));
    };
    // Subscribe on the captured backend before reading so navigation cannot
    // miss a request, or route a late old-backend push into the new backend.
    const cleanupRequest = transport.subscribe(CHANNELS.runs.toolApprovalRequest, (payload) => {
      if (!isCurrent()) return;
      const request = payload as ToolApprovalRequest;
      changesDuringRead.current?.set(request.requestId, request);
      update((previous) => [...previous.filter((item) => item.requestId !== request.requestId), request]
        .sort((a, b) => a.timestamp - b.timestamp));
    });
    const cleanupResolved = transport.subscribe(CHANNELS.runs.toolApprovalResolved, (payload) => {
      if (!isCurrent()) return;
      const { requestId } = payload as { requestId: string };
      changesDuringRead.current?.set(requestId, null);
      update((previous) => previous.filter((request) => request.requestId !== requestId));
    });

    const refresh = async () => {
      if (!isCurrent() || transport.status() !== "connected") return;
      const revision = ++readRevision;
      const changes = new Map<string, ToolApprovalRequest | null>();
      changesDuringRead.current = changes;
      try {
        const response: ServiceResponse<ToolApprovalRequest[]> = await appApi.runs.listPendingApprovals();
        if (!isCurrent() || revision !== readRevision) return;
        if (!response.success) throw new Error(response.error);
        const restored = new Map(response.data.map((request) => [request.requestId, request]));
        for (const [requestId, request] of changes) {
          if (request) restored.set(requestId, request);
          else restored.delete(requestId);
        }
        update(() => [...restored.values()].sort((a, b) => a.timestamp - b.timestamp));
      } catch (error) {
        if (isCurrent() && revision === readRevision) console.warn("[tool-approval] Failed to restore pending requests:", error);
      } finally {
        if (changesDuringRead.current === changes) changesDuringRead.current = null;
      }
    };
    const cleanupStatus = transport.onStatusChange((status) => {
      if (!isCurrent()) return;
      if (status === "connected") void refresh();
      else {
        readRevision += 1;
        changesDuringRead.current = null;
      }
    });
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    void refresh();

    return () => {
      current = false;
      changesDuringRead.current = null;
      cleanupRequest();
      cleanupResolved();
      cleanupStatus();
      window.removeEventListener("focus", onFocus);
    };
  }, [transport]);

  const remove = useCallback((requestIds: readonly string[]) => {
    if (getTransport() !== transport) return;
    for (const requestId of requestIds) changesDuringRead.current?.set(requestId, null);
    setState((previous) => previous.transport === transport
      ? { transport, approvals: previous.approvals.filter((request) => !requestIds.includes(request.requestId)) }
      : previous);
  }, [transport]);

  // Hide an old backend's state immediately, before effect cleanup/rebinding.
  const pendingApprovals = useMemo(() => {
    if (state.transport !== transport) return [];
    if (!runs) return state.approvals;
    const liveRunIds = new Set(runs.filter((run) => !TERMINAL_STATUSES.has(run.status)).map((run) => run.id));
    return state.approvals.filter((request) => liveRunIds.has(request.runId));
  }, [state, transport, runs]);

  const respond = useCallback(
    (requestId: string, approved: boolean, answer?: string) => {
      if (getTransport() !== transport) return;
      void appApi.runs.respondToolApproval({ requestId, approved, answer }).then((response) => {
        if (!response.success) throw new Error(response.error);
        remove([requestId]);
      }).catch((error) => {
        console.warn("[tool-approval] Failed to answer request:", error);
      });
    },
    [transport, remove],
  );

  const dismissForRun = useCallback((runId: string) => {
    remove(state.transport === transport ? state.approvals.filter((request) => request.runId === runId).map((request) => request.requestId) : []);
  }, [state, transport, remove]);

  return { pendingApprovals, respond, dismissForRun };
}
