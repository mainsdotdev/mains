import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { appEvents } from "@/lib/transport";
import { isAssistantReportStream } from "../../../../shared/report-stream";

export interface StreamingEvent {
  id: string;
  type: "artifact";
  kind: string;
  content: string;
  metadata?: Record<string, unknown>;
  streamId: string;
  timestamp: number;
}

interface StreamState {
  kind: string;
  content: string;
  metadata?: Record<string, unknown>;
  streamId: string;
  lastTs: number;
}

/**
 * Hook that subscribes to ephemeral streaming events from the main process.
 * Returns a list of synthetic events that can be merged with DB-backed events
 * for real-time text rendering.
 */
export function useStreamingEvents(activeRunId: string | null, persistedStreamIds: ReadonlySet<string>) {
  const streamsRef = useRef(new Map<string, StreamState>());
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
    for (const [, state] of streamsRef.current) {
      if (state.content) {
        events.push({
          id: `stream-${state.streamId}`,
          type: "artifact",
          kind: state.kind,
          content: state.content,
          metadata: state.metadata,
          streamId: state.streamId,
          timestamp: state.lastTs,
        });
      }
    }
    snapshotRef.current = events;
    for (const listener of listenersRef.current) listener();
  }, []);

  useLayoutEffect(() => {
    persistedRef.current = persistedStreamIds;
    let changed = false;
    for (const streamId of persistedStreamIds) {
      if (streamsRef.current.delete(streamId)) changed = true;
    }
    if (changed) notify();
  }, [persistedStreamIds, notify]);

  useEffect(() => {
    const streams = streamsRef.current;
    const listeners = listenersRef.current;

    if (!activeRunId) {
      streams.clear();
      snapshotRef.current = [];
      for (const listener of listeners) listener();
      return;
    }

    const cleanup = appEvents.runs.onStreamingEvent((data) => {
      if (data.runId !== activeRunId) return;

      const { event, ts } = data;
      const streamId = event.streamId;
      if (!streamId || persistedRef.current.has(streamId)) return;
      const previous = streamsRef.current.get(streamId);
      if (previous?.metadata?.streaming === false) return;

      streamsRef.current.set(streamId, {
        kind: event.kind,
        content: event.content ?? "",
        metadata: event.metadata,
        streamId,
        lastTs: event.metadata?.voice === true ? previous?.lastTs ?? ts : ts,
      });

      // Throttle to ~60fps
      if (!throttleRef.current) {
        throttleRef.current = requestAnimationFrame(() => {
          throttleRef.current = null;
          notify();
        });
      }
    });
    const offRealtime = appEvents.runs.onRealtimeEvent((event) => {
      if (event.runId !== activeRunId || event.type !== "closed") return;
      let changed = false;
      for (const [id, stream] of streams) {
        if (stream.metadata?.voice === true && stream.metadata.realtimeSessionId === event.connectionId &&
            stream.metadata.streaming !== false) {
          streams.delete(id);
          changed = true;
        }
      }
      if (changed) notify();
    });

    return () => {
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
  }, [activeRunId, notify]);

  const streamingEvents = useSyncExternalStore(subscribe, getSnapshot);

  const clearTurnStreams = useCallback((interrupted = false) => {
    // A work turn finishing does not end its conversation's voice call.
    // Keep assistant prose until its persisted identity is acknowledged;
    // stopping work must never remove an answer while history is loading.
    let changed = false;
    for (const [id, stream] of streamsRef.current) {
      if (stream.metadata?.voice === true) continue;
      if (isAssistantReportStream(stream)) {
        if (stream.metadata?.streaming === false) continue;
        streamsRef.current.set(id, { ...stream, metadata: { ...stream.metadata, streaming: false, interrupted } });
      } else {
        streamsRef.current.delete(id);
      }
      changed = true;
    }
    if (changed) notify();
  }, [notify]);

  return { streamingEvents, clearTurnStreams };
}
