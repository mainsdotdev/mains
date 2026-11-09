import { useCallback, useSyncExternalStore } from "react";
import type { ReadRunHistoryPayload, RunHistoryPage } from "@mains/contracts/runs";
import { EMPTY_HISTORY, beginHistoryWindow, completeHistoryWindow, failHistoryWindow, followHistoryWindow,
  historyWindowRequest, createHistoryRequests, type HistoryWindowState } from "@mains/contracts/transcript-history";

export type HistoryState = HistoryWindowState;
const states = new Map<string, HistoryState>();
const listeners = new Set<() => void>();
export const historyKey = (backendId: string, runId: string) => JSON.stringify([backendId, runId]);
export const historyRequests = createHistoryRequests();
let latestSequence = 0;
const publish = () => { for (const listener of listeners) listener(); };

export function historyState(backendId: string, runId: string): HistoryState {
  return states.get(historyKey(backendId, runId)) ?? EMPTY_HISTORY;
}
export function historyRequest(backendId: string, runId: string, direction: ReadRunHistoryPayload["direction"]): ReadRunHistoryPayload {
  return { ...historyWindowRequest(runId, historyState(backendId, runId), direction), profile: "mobile" };
}
export function historyLoading(backendId: string, runId: string, loading: boolean, error: string | null = null, direction: ReadRunHistoryPayload["direction"] = "refresh") {
  const previous = historyState(backendId, runId);
  states.set(historyKey(backendId, runId), loading ? beginHistoryWindow(previous, direction)
    : error !== null ? failHistoryWindow(previous, direction, new Error(error)) : { ...previous, loading, error });
  publish();
}
export function historyLoaded(backendId: string, runId: string, page: RunHistoryPage, direction: ReadRunHistoryPayload["direction"] = "refresh") {
  const key = historyKey(backendId, runId);
  const state = historyState(backendId, runId);
  states.delete(key);
  states.set(key, completeHistoryWindow(state, page, direction, direction === "latest" ? ++latestSequence : state.latestRevision));
  const retained = [...states].filter(([, value]) => value.loaded).map(([key]) => key);
  while (retained.length > 4) {
    const oldest = retained.shift()!;
    states.delete(oldest);
    historyRequests.retire(oldest);
  }
  publish();
}
export function setHistoryFollowing(backendId: string, runId: string, value: boolean) {
  const key = historyKey(backendId, runId);
  const state = historyState(backendId, runId);
  const next = followHistoryWindow(state, value);
  if (next === state) return;
  states.set(key, next);
  publish();
}
export function forgetHistory(backendId: string, runId: string) {
  const key = historyKey(backendId, runId);
  historyRequests.retire(key);
  states.delete(key);
  publish();
}
export function forgetBackendHistory(backendId: string) {
  historyRequests.retireWhere((key) => JSON.parse(key)[0] === backendId);
  for (const key of states.keys()) if (JSON.parse(key)[0] === backendId) {
    states.delete(key);
  }
  publish();
}
export function retireHistoryTransport(transport: object) {
  for (const key of historyRequests.retireOwner(transport)) {
    const state = states.get(key);
    if (state?.loading) states.set(key, { ...state, loading: false });
  }
  publish();
}
export function useRunHistory(backendId: string, runId: string) {
  const subscribe = useCallback((listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, []);
  const snapshot = useCallback(() => historyState(backendId, runId), [backendId, runId]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
