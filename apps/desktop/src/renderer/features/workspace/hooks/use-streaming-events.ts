import { useCallback, useLayoutEffect, useMemo, useReducer, useRef, useSyncExternalStore } from "react";
import { appEvents, getTransport, onTransportChange } from "@/lib/transport";
import { createTranscriptStreams } from "@mains/contracts/transcript-stream";
import { runActivityKind, runActivityStore } from "../lib/run-activity";
import { useRunActivity } from "./use-run-activity";

export interface StreamingEvent {
  id: string;
  type: "artifact";
  kind: string;
  content: string;
  metadata?: Record<string, unknown>;
  streamId: string;
  timestamp: number;
}

/**
 * Hook that subscribes to ephemeral streaming events from the main process.
 * Returns a list of synthetic events that can be merged with DB-backed events
 * for real-time text rendering.
 */
export function useStreamingEvents(activeRunId: string | null, persistedStreamIds: ReadonlySet<string>) {
  const activity = useRunActivity(activeRunId);
  const streamsRef = useRef(createTranscriptStreams());
  const [revision, advance] = useReducer((value: number) => value + 1, 0);
  useLayoutEffect(() => onTransportChange(advance), []);
  const snapshotRef = useRef<StreamingEvent[]>([]);
  const listenersRef = useRef(new Set<() => void>());
  const throttleRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const persistedRef = useRef(persistedStreamIds);

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => listenersRef.current.delete(listener);
  }, []);

  const getSnapshot = useCallback(() => snapshotRef.current, []);

  const notify = useCallback(() => {
    const events: StreamingEvent[] = [];
    for (const state of streamsRef.current.values()) {
      if (state.content) {
        events.push({
          id: `stream-${state.streamId}`,
          type: "artifact",
          kind: state.kind,
          content: state.content,
          metadata: state.metadata,
          streamId: state.streamId,
          timestamp: state.timestamp,
        });
      }
    }
    snapshotRef.current = events;
    for (const listener of listenersRef.current) listener();
  }, []);

  useLayoutEffect(() => {
    persistedRef.current = persistedStreamIds;
    if (streamsRef.current.acknowledge(persistedStreamIds)) notify();
  }, [persistedStreamIds, notify]);

  useLayoutEffect(() => {
    const streams = streamsRef.current;
    let current = true;
    const transport = getTransport();
    const offChange = onTransportChange(() => {
      current = false; streams.clear();
      if (throttleRef.current !== null) cancelAnimationFrame(throttleRef.current);
      throttleRef.current = null; notify();
    });
    const listeners = listenersRef.current;

    if (!activeRunId) {
      streams.clear();
      snapshotRef.current = [];
      for (const listener of listeners) listener();
      return offChange;
    }

    streams.acknowledge(persistedRef.current);
    const cleanup = appEvents.runs.onStreamingEvent((data) => {
      if (!current || getTransport() !== transport || data.runId !== activeRunId) return;

      const { event, ts } = data;
      if (runActivityKind(event)) return;
      const streamId = event.streamId;
      if (!streamId || persistedRef.current.has(streamId)) return;
      if (!streams.receive({ kind: event.kind, content: event.content ?? "", metadata: event.metadata, streamId, timestamp: ts })) return;

      // Throttle to ~60fps
      if (!throttleRef.current) {
        throttleRef.current = requestAnimationFrame(() => {
          throttleRef.current = null;
          if (current) notify();
        });
      }
    });
    const offRealtime = appEvents.runs.onRealtimeEvent((event) => {
      if (!current || getTransport() !== transport || event.runId !== activeRunId || event.type !== "closed") return;
      if (streams.closeVoice(event.connectionId)) notify();
    });

    return () => {
      current = false; offChange();
      cleanup();
      offRealtime();
      if (throttleRef.current) {
        cancelAnimationFrame(throttleRef.current);
        throttleRef.current = null;
      }
      streams.clear();
      snapshotRef.current = [];
      for (const listener of listeners) listener();
    };
  }, [activeRunId, notify, revision]);

  const messageEvents = useSyncExternalStore(subscribe, getSnapshot);
  const streamingEvents = useMemo(() => [...messageEvents, ...activity], [messageEvents, activity]);

  const clearTurnStreams = useCallback((interrupted = false) => {
    if (activeRunId) runActivityStore.finish(activeRunId);
    if (streamsRef.current.settleTurn(interrupted)) notify();
  }, [notify, activeRunId]);

  return { streamingEvents, clearTurnStreams };
}
