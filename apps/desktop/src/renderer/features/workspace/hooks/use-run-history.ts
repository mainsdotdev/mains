import { useCallback, useRef, useState } from "react";
import type { RunHistoryCursor, ReadRunHistoryPayload } from "@mains/contracts/runs";
import { historyEndAfter } from "@mains/contracts/run-history";
import type { RunTurn } from "@/lib/redux/api";
import { appApi } from "@/lib/transport";
import type { RunEvent } from "../types";
import { mergeRunEvents, mergeMappedRunEvents } from "../lib/run-event-mappers";
import { createRunCache, pruneRunMap } from "../lib/run-cache";

interface HistoryState {
  start: RunHistoryCursor | null;
  end: RunHistoryCursor | null;
  last: RunHistoryCursor | null;
  hasOlder: boolean;
  hasNewer: boolean;
  loading: boolean;
  error: string | null;
  latestRevision: number;
}

export interface TranscriptHistory {
  hasOlder: boolean;
  hasNewer: boolean;
  loading: boolean;
  error: string | null;
  historical: boolean;
  latestRevision?: number;
  loadOlder(): Promise<void>;
  loadNewer(): Promise<void>;
  loadLatest(): Promise<void>;
  retry(): Promise<void>;
  setFollowing(following: boolean): void;
}

/** A bounded transcript window, independent of the provider's complete history. */
export function useRunHistory(cache: ReturnType<typeof createRunCache>, activeRunId: string | null) {
  const [runEvents, setRunEvents] = useState<Record<string, RunEvent[]>>({});
  const [runTurns, setRunTurns] = useState<Record<string, RunTurn[]>>({});
  const [states, setStates] = useState<Record<string, HistoryState>>({});
  const stateRef = useRef<Record<string, HistoryState>>({});
  const jobs = useRef(new Map<string, Promise<void>>());
  const revision = useRef(0);
  const latestSequence = useRef(0);
  const following = useRef(new Map<string, boolean>());
  const versions = useRef(new Map<string, number>());

  const update = useCallback((runId: string, state: HistoryState) => {
    stateRef.current = { ...stateRef.current, [runId]: state };
    setStates(stateRef.current);
  }, []);

  const load = useCallback((runId: string, direction: ReadRunHistoryPayload["direction"] = "refresh") => {
    const generation = revision.current;
    const version = versions.current.get(runId) ?? 0;
    if (direction === "latest") following.current.set(runId, true);
    const isCurrent = () => generation === revision.current && version === (versions.current.get(runId) ?? 0);
    // Paging and refreshes share a queue. A late live refresh cannot overwrite
    // the older window the reader just requested.
    const previous = jobs.current.get(runId) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      if (!isCurrent()) return;
      const current = stateRef.current[runId];
      const initial: HistoryState = current ?? {
        start: null, end: null, last: null, hasOlder: false, hasNewer: false, loading: false, error: null, latestRevision: 0,
      };
      update(runId, { ...initial, loading: true, error: null });
      const request: ReadRunHistoryPayload = { runId, direction: current?.start ? direction : "latest", deferToolOutput: true };
      if (direction === "older" && current?.start) request.cursor = current.start;
      if (direction === "newer" && current?.end) request.cursor = current.end;
      if (direction === "refresh" && current) {
        request.cursor = current.start ?? undefined;
        request.end = current.end;
      }
      try {
        const response = await appApi.runs.getHistory(request);
        if (!isCurrent()) return;
        if (!response.success) throw new Error(response.error);
        const page = response.data;
        // Preserve a pause that happened while the request was in flight.
        const pausedEnd = following.current.get(runId) === false && page.last
          ? historyEndAfter(page.last) : null;
        const allowed = cache.touch(runId);
        cache.markLoaded(runId);
        const incoming = mergeRunEvents([], page.artifacts, page.toolCalls);
        const ids = new Set(incoming.map((event) => event.id));
        setRunEvents((previousEvents) => {
          const existing = previousEvents[runId] ?? [];
          const retained = existing.every((event) => ids.has(event.id)) ? existing : existing.filter((event) => ids.has(event.id));
          const events = mergeMappedRunEvents(retained, incoming);
          return pruneRunMap(events === previousEvents[runId] ? previousEvents : { ...previousEvents, [runId]: events }, allowed);
        });
        const turns: RunTurn[] = page.turns.map((turn) => ({
          ...turn,
          startedAt: turn.startedAt == null ? null : new Date(turn.startedAt).getTime(),
          endedAt: turn.endedAt == null ? null : new Date(turn.endedAt).getTime(),
          createdAt: new Date(turn.createdAt).getTime(),
          changes: turn.changes ? { ...turn.changes,
            undoneAt: turn.changes.undoneAt == null ? null : new Date(turn.changes.undoneAt).getTime() } : null,
        }));
        setRunTurns((previousTurns) => pruneRunMap({ ...previousTurns, [runId]: turns }, allowed));
        stateRef.current = pruneRunMap(stateRef.current, allowed);
        update(runId, { start: page.start, end: page.end ?? pausedEnd ?? null, last: page.last,
          hasOlder: page.hasOlder, hasNewer: page.hasNewer, loading: false, error: null,
          latestRevision: request.direction === "latest" ? ++latestSequence.current : initial.latestRevision });
      } catch (error) {
        if (!isCurrent()) return;
        update(runId, { ...(stateRef.current[runId] ?? initial), loading: false,
          error: error instanceof Error ? error.message : "Could not load conversation history" });
      }
    });
    jobs.current.set(runId, task);
    void task.finally(() => { if (jobs.current.get(runId) === task) jobs.current.delete(runId); });
    return task;
  }, [cache, update]);

  const clear = useCallback(() => {
    revision.current += 1;
    stateRef.current = {};
    jobs.current.clear();
    following.current.clear();
    setStates({});
    setRunEvents({});
    setRunTurns({});
  }, []);
  const forget = useCallback((runId: string) => {
    versions.current.set(runId, (versions.current.get(runId) ?? 0) + 1);
    following.current.delete(runId);
    const next = { ...stateRef.current };
    delete next[runId];
    stateRef.current = next;
    setStates(next);
    setRunEvents((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => id !== runId)));
    setRunTurns((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => id !== runId)));
  }, []);

  const current = activeRunId ? states[activeRunId] : undefined;
  const history: TranscriptHistory = {
    hasOlder: current?.hasOlder ?? false,
    hasNewer: current?.hasNewer ?? false,
    historical: current?.end != null,
    latestRevision: current?.latestRevision ?? 0,
    loading: current?.loading ?? false,
    error: current?.error ?? null,
    loadOlder: () => activeRunId ? load(activeRunId, "older") : Promise.resolve(),
    loadNewer: () => activeRunId ? load(activeRunId, "newer") : Promise.resolve(),
    loadLatest: () => activeRunId ? load(activeRunId, "latest") : Promise.resolve(),
    retry: () => activeRunId ? load(activeRunId) : Promise.resolve(),
    setFollowing: (value) => {
      if (activeRunId) following.current.set(activeRunId, value);
      if (!activeRunId) return;
      const state = stateRef.current[activeRunId];
      if (value && state?.end && !state.hasNewer) {
        update(activeRunId, { ...state, end: null });
      } else if (!value && state?.last && !state.end) {
        // Freeze after the last known row, even within a second-grained
        // timestamp. Newly inserted ties stay outside this reading window.
        update(activeRunId, { ...state, end: historyEndAfter(state.last) });
      }
    },
  };
  return { runEvents, runTurns, load, clear, forget, history };
}
