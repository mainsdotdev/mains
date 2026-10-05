import { useCallback, useSyncExternalStore } from "react";
import { historyEndAfter } from "@mains/contracts/run-history";
import type { ReadRunHistoryPayload, RunHistoryCursor, RunHistoryPage } from "@mains/contracts/runs";

export interface HistoryState {
  start: RunHistoryCursor | null;
  end: RunHistoryCursor | null;
  last: RunHistoryCursor | null;
  hasOlder: boolean;
  hasNewer: boolean;
  loaded: boolean;
  loading: boolean;
  error: string | null;
}
const EMPTY: HistoryState = { start: null, end: null, last: null, hasOlder: false, hasNewer: false, loaded: false, loading: false, error: null };
const states = new Map<string, HistoryState>();
const following = new Map<string, boolean>();
const listeners = new Set<() => void>();
const keyFor = (backendId: string, runId: string) => `${backendId}:${runId}`;
const publish = () => { for (const listener of listeners) listener(); };

export function historyState(backendId: string, runId: string): HistoryState {
  return states.get(keyFor(backendId, runId)) ?? EMPTY;
}
export function historyRequest(backendId: string, runId: string, direction: ReadRunHistoryPayload["direction"]): ReadRunHistoryPayload {
  const state = historyState(backendId, runId);
  if (!state.loaded) return { runId, direction: "latest" };
  if (direction === "older") return { runId, direction, cursor: state.start ?? undefined };
  if (direction === "newer") return { runId, direction, cursor: state.end ?? undefined };
  if (direction === "refresh") return { runId, direction, cursor: state.start ?? undefined, end: state.end };
  return { runId, direction: "latest" };
}
export function historyLoading(backendId: string, runId: string, loading: boolean, error: string | null = null) {
  states.set(keyFor(backendId, runId), { ...historyState(backendId, runId), loading, error });
  publish();
}
export function historyLoaded(backendId: string, runId: string, page: RunHistoryPage) {
  const key = keyFor(backendId, runId);
  states.delete(key);
  const frozenEnd = following.get(key) === false && page.last
    ? historyEndAfter(page.last) : null;
  states.set(key, { start: page.start, end: page.end ?? frozenEnd, last: page.last,
    hasOlder: page.hasOlder, hasNewer: page.hasNewer, loaded: true, loading: false, error: null });
  while (states.size > 4) {
    const oldest = states.keys().next().value!;
    states.delete(oldest);
    following.delete(oldest);
  }
  publish();
}
export function setHistoryFollowing(backendId: string, runId: string, value: boolean) {
  const key = keyFor(backendId, runId);
  following.set(key, value);
  const state = historyState(backendId, runId);
  if (value && state.end && !state.hasNewer) states.set(key, { ...state, end: null });
  else if (!value && state.last && !state.end) states.set(key, { ...state,
    end: historyEndAfter(state.last) });
  else return;
  publish();
}
export function forgetHistory(backendId: string, runId: string) {
  const key = keyFor(backendId, runId);
  states.delete(key);
  following.delete(key);
  publish();
}
export function useRunHistory(backendId: string, runId: string) {
  const subscribe = useCallback((listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, []);
  const snapshot = useCallback(() => historyState(backendId, runId), [backendId, runId]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
