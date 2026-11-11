import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ReadRunHistoryPayload } from "@mains/contracts/runs";
import { EMPTY_HISTORY, beginHistoryWindow, completeHistoryWindow, failHistoryWindow, followHistoryWindow,
  historyWindowRequest, createHistoryRequests, type HistoryWindowState as HistoryState } from "@mains/contracts/transcript-history";
import type { RunTurn } from "@/lib/redux/api";
import { appApi } from "@/lib/transport";
import { onTransportChange } from "@/lib/transport/registry";
import type { RunEvent } from "../types";
import { mergeRunEvents, mergeMappedRunEvents } from "../lib/run-event-mappers";
import { createRunCache, pruneRunMap } from "../lib/run-cache";

export interface TranscriptHistory {
  hasOlder: boolean;
  hasNewer: boolean;
  loading: boolean;
  error: string | null;
  following: boolean;
  /** An explicitly paged window that ends before the live conversation. */
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
  const [requests] = useState(createHistoryRequests);
  const attached = useRef(true);
  const latestSequence = useRef(0);
  useLayoutEffect(() => {
    attached.current = true;
    return () => { attached.current = false; requests.clear(); };
  }, [requests]);

  const update = useCallback((runId: string, state: HistoryState) => {
    stateRef.current = { ...stateRef.current, [runId]: state };
    setStates(stateRef.current);
  }, []);

  const load = useCallback((runId: string, direction: ReadRunHistoryPayload["direction"] = "refresh") => {
    if (!attached.current) return Promise.resolve();
    return requests.run(runId, cache, direction, async (signal) => {
      const initial = stateRef.current[runId] ?? EMPTY_HISTORY;
      const request = historyWindowRequest(runId, initial, direction);
      update(runId, beginHistoryWindow(initial, request.direction));
      try {
        const response = await appApi.runs.getHistory(request);
        if (signal.aborted) return;
        if (!response.success) throw new Error(response.error);
        const page = response.data;
        const allowed = cache.touch(runId);
        // Only an already retained window can be evicted. Other conversations
        // may still be preparing their independent first page.
        for (const [id, state] of Object.entries(stateRef.current)) {
          if (state.loaded && !allowed.has(id)) requests.retire(id);
        }
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
        const metadata = new Set(allowed);
        for (const [id, state] of Object.entries(stateRef.current)) {
          if (!state.loaded && state.loading) metadata.add(id);
        }
        stateRef.current = pruneRunMap(stateRef.current, metadata);
        update(runId, completeHistoryWindow(stateRef.current[runId] ?? initial, page, request.direction,
          request.direction === "latest" ? ++latestSequence.current : initial.latestRevision));
      } catch (error) {
        if (signal.aborted) return;
        update(runId, failHistoryWindow(stateRef.current[runId] ?? initial, request.direction, error));
      }
    });
  }, [cache, requests, update]);

  const clear = useCallback(() => {
    requests.clear();
    cache.clear();
    stateRef.current = {};
    setStates({});
    setRunEvents({});
    setRunTurns({});
  }, [cache, requests]);
  useLayoutEffect(() => onTransportChange(clear), [clear]);
  const forget = useCallback((runId: string) => {
    requests.retire(runId);
    const next = { ...stateRef.current };
    delete next[runId];
    stateRef.current = next;
    setStates(next);
    setRunEvents((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => id !== runId)));
    setRunTurns((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => id !== runId)));
  }, [requests]);

  const current = activeRunId ? states[activeRunId] : undefined;
  const history: TranscriptHistory = {
    hasOlder: current?.hasOlder ?? false,
    hasNewer: current?.hasNewer ?? false,
    following: current?.following ?? true,
    historical: current?.historical ?? false,
    latestRevision: current?.latestRevision ?? 0,
    loading: current?.loading ?? false,
    error: current?.error ?? null,
    loadOlder: () => activeRunId ? load(activeRunId, "older") : Promise.resolve(),
    loadNewer: () => activeRunId ? load(activeRunId, "newer") : Promise.resolve(),
    loadLatest: () => activeRunId ? load(activeRunId, "latest") : Promise.resolve(),
    retry: () => activeRunId ? load(activeRunId, stateRef.current[activeRunId]?.retryDirection ?? "refresh") : Promise.resolve(),
    setFollowing: (value) => {
      if (!activeRunId) return;
      const state = stateRef.current[activeRunId] ?? EMPTY_HISTORY;
      const next = followHistoryWindow(state, value);
      if (state !== next) update(activeRunId, next);
    },
  };
  return { runEvents, runTurns, load, clear, forget, history };
}
