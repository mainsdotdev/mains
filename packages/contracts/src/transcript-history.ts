import type { ReadRunHistoryPayload, RunHistoryCursor, RunHistoryPage } from "./runs";
import { historyEndAfter } from "./run-history";

export type HistoryDirection = ReadRunHistoryPayload["direction"];

export interface HistoryWindowState {
  start: RunHistoryCursor | null;
  end: RunHistoryCursor | null;
  last: RunHistoryCursor | null;
  hasOlder: boolean;
  hasNewer: boolean;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  following: boolean;
  historical: boolean;
  latestRevision: number;
  retryDirection: HistoryDirection | null;
}
export const EMPTY_HISTORY: HistoryWindowState = {
  start: null, end: null, last: null, hasOlder: false, hasNewer: false,
  loaded: false, loading: false, error: null, following: true, historical: false,
  latestRevision: 0, retryDirection: null,
};

/** Build at dispatch time, after earlier navigation has committed its bounds. */
export function historyWindowRequest(runId: string, state: HistoryWindowState, direction: HistoryDirection): ReadRunHistoryPayload {
  const request: ReadRunHistoryPayload = { runId, direction: state.loaded ? direction : "latest", deferToolOutput: true };
  if (request.direction === "older") request.cursor = state.start ?? undefined;
  if (request.direction === "newer") request.cursor = state.end ?? undefined;
  if (request.direction === "refresh") { request.cursor = state.start ?? undefined; request.end = state.end; }
  return request;
}
export function beginHistoryWindow(state: HistoryWindowState, direction: HistoryDirection): HistoryWindowState {
  return { ...state, loading: true, error: null,
    following: direction === "latest" ? true : direction === "refresh" ? state.following : false };
}
export function completeHistoryWindow(state: HistoryWindowState, page: RunHistoryPage, direction: HistoryDirection, latestRevision = state.latestRevision + 1): HistoryWindowState {
  const frozenEnd = !state.following && page.last
    ? (direction === "refresh" ? state.end : null) ?? historyEndAfter(page.last) : null;
  return { ...state, start: page.start, end: page.end ?? frozenEnd, last: page.last,
    hasOlder: page.hasOlder, hasNewer: page.hasNewer, loaded: true, loading: false, error: null,
    historical: direction === "refresh" ? state.historical : direction !== "latest" && page.end != null,
    latestRevision: direction === "latest" ? latestRevision : state.latestRevision, retryDirection: null };
}
export function failHistoryWindow(state: HistoryWindowState, direction: HistoryDirection, error: unknown): HistoryWindowState {
  return { ...state, loading: false, error: error instanceof Error ? error.message : "Could not load conversation history", retryDirection: direction };
}
export function followHistoryWindow(state: HistoryWindowState, following: boolean): HistoryWindowState {
  if (following && state.end && !state.hasNewer) return { ...state, following, historical: false, end: null };
  if (!following && state.last && !state.end) return { ...state, following, end: historyEndAfter(state.last) };
  return state.following === following ? state : { ...state, following };
}

interface HistoryJob {
  direction: HistoryDirection;
  work(signal: AbortSignal): Promise<void>;
  promise: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
}
interface HistoryRequests {
  owner: object;
  controller: AbortController;
  pending: HistoryJob[];
  active?: HistoryJob;
}

/** One ordered writer per transcript. Only adjacent waiting refreshes join;
 * navigation is a barrier. Retirement releases waiters immediately while the
 * native continuation retains an aborted signal and cannot publish. */
export function createHistoryRequests() {
  const entries = new Map<string, HistoryRequests>();
  function retire(key: string) {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    entry.controller.abort();
    entry.active?.resolve();
    for (const job of entry.pending.splice(0)) job.resolve();
  }
  async function drain(key: string, entry: HistoryRequests) {
    const signal = entry.controller.signal;
    while (!signal.aborted && entry.pending.length) {
      const job = entry.pending.shift()!;
      entry.active = job;
      try { await job.work(signal); job.resolve(); }
      catch (error) { job.reject(error); }
      entry.active = undefined;
    }
    if (entries.get(key) === entry) entries.delete(key);
  }
  return {
    run(key: string, owner: object, direction: HistoryDirection, work: HistoryJob["work"]): Promise<void> {
      let entry = entries.get(key);
      if (entry && entry.owner !== owner) { retire(key); entry = undefined; }
      const last = entry?.pending.at(-1);
      if (direction === "refresh" && last?.direction === "refresh") return last.promise;
      const fresh = !entry;
      if (!entry) {
        entry = { owner, controller: new AbortController(), pending: [] };
        entries.set(key, entry);
      }
      let resolve!: () => void, reject!: (error: unknown) => void;
      const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      entry.pending.push({ direction, work, promise, resolve, reject });
      // Claim before native work or subscriber callbacks can reenter.
      if (fresh) void Promise.resolve().then(() => drain(key, entry!));
      return promise;
    },
    retire,
    retireOwner(owner: object) {
      const retired: string[] = [];
      for (const [key, entry] of entries) if (entry.owner === owner) { retire(key); retired.push(key); }
      return retired;
    },
    retireWhere(matches: (key: string) => boolean) { for (const key of entries.keys()) if (matches(key)) retire(key); },
    clear() { for (const key of entries.keys()) retire(key); },
  };
}
