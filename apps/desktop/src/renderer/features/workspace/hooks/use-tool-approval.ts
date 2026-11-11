import { useState, useEffect, useLayoutEffect, useReducer, useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { CHANNELS } from "@mains/contracts/channels";
import type { ServiceResponse } from "@mains/contracts/service-response";
import { appApi, getTransport, onTransportChange, type Transport } from "@/lib/transport";

import type { ToolApprovalRequest } from "@mains/contracts/runs";
export type { ToolApprovalRequest } from "@mains/contracts/runs";

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
  const [generation, advance] = useReducer((value: number) => value + 1, 0);
  useLayoutEffect(() => onTransportChange(advance), []);
  const [state, setState] = useState<{ transport: Transport; generation: number; approvals: ToolApprovalRequest[] }>(
    () => ({ transport, generation, approvals: [] }),
  );
  // Mutations after a snapshot starts take precedence over that snapshot,
  // including local answers that have not received their resolved push yet.
  const binding = useRef({ transport, generation, active: false });
  const changesDuringRead = useRef<Map<string, ToolApprovalRequest | { resolvedToken: string } | null> | null>(null);

  useEffect(() => {
    let current = true;
    const owner = { transport, generation, active: true }; binding.current = owner;
    let readRevision = 0;
    const offChange = onTransportChange(() => { current = false; owner.active = false; });
    const isCurrent = () => current && getTransport() === transport;
    const update = (edit: (requests: ToolApprovalRequest[]) => ToolApprovalRequest[]) => {
      if (!isCurrent()) return;
      setState((previous) => ({ transport, generation, approvals: edit(previous.transport === transport && previous.generation === generation ? previous.approvals : []) }));
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
      const { requestId, approvalToken } = payload as { requestId: string; approvalToken?: string };
      const changed = changesDuringRead.current?.get(requestId);
      if (!changed || "resolvedToken" in changed || !approvalToken || changed.approvalToken === approvalToken) changesDuringRead.current?.set(requestId, approvalToken ? { resolvedToken: approvalToken } : null);
      update((previous) => previous.filter((request) => request.requestId !== requestId || !!approvalToken && request.approvalToken !== approvalToken));
    });

    const refresh = async () => {
      if (!isCurrent() || transport.status() !== "connected") return;
      const revision = ++readRevision;
      const changes = new Map<string, ToolApprovalRequest | { resolvedToken: string } | null>();
      changesDuringRead.current = changes;
      try {
        const response: ServiceResponse<ToolApprovalRequest[]> = await appApi.runs.listPendingApprovals();
        if (!isCurrent() || revision !== readRevision) return;
        if (!response.success) throw new Error(response.error);
        const restored = new Map(response.data.map((request) => [request.requestId, request]));
        for (const [requestId, request] of changes) {
          if (request && "resolvedToken" in request) {
            if (restored.get(requestId)?.approvalToken === request.resolvedToken) restored.delete(requestId);
          } else if (request) restored.set(requestId, request);
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
      current = false; owner.active = false;
      offChange();
      changesDuringRead.current = null;
      cleanupRequest();
      cleanupResolved();
      cleanupStatus();
      window.removeEventListener("focus", onFocus);
    };
  }, [transport, generation]);

  const remove = useCallback((requestIds: readonly string[]) => {
    if (getTransport() !== transport) return;
    for (const requestId of requestIds) changesDuringRead.current?.set(requestId, null);
    setState((previous) => previous.transport === transport
      ? { transport, generation, approvals: previous.approvals.filter((request) => !requestIds.includes(request.requestId)) }
      : previous);
  }, [transport, generation]);

  // Hide an old backend's state immediately, before effect cleanup/rebinding.
  const pendingApprovals = useMemo(() => {
    if (state.transport !== transport || state.generation !== generation) return [];
    if (!runs) return state.approvals;
    const liveRunIds = new Set(runs.filter((run) => !TERMINAL_STATUSES.has(run.status)).map((run) => run.id));
    return state.approvals.filter((request) => liveRunIds.has(request.runId));
  }, [state, transport, generation, runs]);

  const sending = useRef(new Map<string, Promise<void>>());
  const respond = useCallback(
    (requestId: string, approved: boolean, answer?: string): Promise<void> => {
      const request = state.transport === transport && state.generation === generation ? state.approvals.find((item) => item.requestId === requestId) : undefined;
      const owner = binding.current;
      if (!request || getTransport() !== transport || !owner.active || owner.generation !== generation) {
        const error = Promise.reject<void>(new Error("This approval is no longer pending."));
        void error.catch(() => {}); return error;
      }
      const key = JSON.stringify([generation, requestId, request.approvalToken]);
      const previous = sending.current.get(key);
      if (previous) return previous;
      const result = transport.invoke(CHANNELS.runs.toolApprovalResponse, [{ requestId, approved, answer, ...(request.approvalToken ? { approvalToken: request.approvalToken } : {}) }]).then((response) => {
        if (!response.success) throw new Error(response.error);
        if (binding.current !== owner || !owner.active || getTransport() !== transport) return;
        const changed = changesDuringRead.current?.get(requestId);
        if (!changed || "resolvedToken" in changed || changed.approvalToken === request.approvalToken) changesDuringRead.current?.set(requestId, request.approvalToken ? { resolvedToken: request.approvalToken } : null);
        setState((current) => current.generation !== generation ? current : ({ ...current, approvals: current.approvals.filter((item) => item.requestId !== requestId || item.approvalToken !== request.approvalToken) }));
      }).finally(() => { if (sending.current.get(key) === result) sending.current.delete(key); });
      sending.current.set(key, result);
      // Existing fire-and-forget UI callers still receive a handled promise;
      // dialogs can await it to preserve their entered values on refusal.
      void result.catch((error) => { console.warn("[tool-approval] Failed to answer request:", error); });
      return result;
    },
    [transport, generation, state],
  );

  const dismissForRun = useCallback((runId: string) => {
    remove(state.transport === transport ? state.approvals.filter((request) => request.runId === runId).map((request) => request.requestId) : []);
  }, [state, transport, remove]);

  return { pendingApprovals, respond, dismissForRun };
}
