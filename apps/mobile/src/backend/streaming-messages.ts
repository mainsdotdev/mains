import { useCallback, useSyncExternalStore } from "react";

import { createTranscriptStreams } from "@mains/contracts/transcript-stream";
import type { RunEphemeralEvent } from "@mains/contracts/runs";

/** One cumulative assistant-message snapshot currently alive only on the wire. */
export interface StreamingMessage {
  key: string;
  streamId: string;
  text: string;
  /** When this stream first appeared, so parallel streams keep a stable order. */
  at: number;
}

interface RunStreams {
  model: ReturnType<typeof createTranscriptStreams>;
  snapshot: readonly StreamingMessage[];
  listeners: Set<() => void>;
  frame: number | null;
}

const EMPTY: readonly StreamingMessage[] = Object.freeze([]);
const runs = new Map<string, RunStreams>();

function stateFor(runId: string): RunStreams {
  let state = runs.get(runId);
  if (!state) {
    state = {
      model: createTranscriptStreams(),
      snapshot: EMPTY,
      listeners: new Set(),
      frame: null,
    };
    runs.set(runId, state);
  }
  return state;
}

function publish(runId: string): void {
  const state = runs.get(runId);
  if (!state) return;
  state.frame = null;
  const previews = state.model.values();
  state.snapshot = previews.length ? previews.map((stream) => ({
    key: `stream-${stream.streamId}`, streamId: stream.streamId, text: stream.content, at: stream.timestamp,
  })) : EMPTY;
  for (const listener of state.listeners) listener();
  if (state.model.values().length === 0 && state.listeners.size === 0) runs.delete(runId);
}

/** Coalesce token bursts to one React update per native animation frame. */
function schedulePublish(runId: string): void {
  const state = stateFor(runId);
  if (state.frame !== null) return;
  state.frame = requestAnimationFrame(() => publish(runId));
}

function isAssistantMessage(event: RunEphemeralEvent): boolean {
  return (
    event.event.type === "artifact" &&
    event.event.metadata?.source === "agent_message_streaming" &&
    typeof event.event.streamId === "string" &&
    event.event.streamId.length > 0
  );
}

/** Accept the backend's cumulative message value; never write it to SQLite. */
export function receiveStreamingMessage(payload: RunEphemeralEvent): void {
  if (!isAssistantMessage(payload)) return;
  const streamId = payload.event.streamId!;
  const state = stateFor(payload.runId);
  if (state.model.receive({ kind: payload.event.kind, streamId, content: payload.event.content ?? "",
    metadata: payload.event.metadata, timestamp: payload.ts })) schedulePublish(payload.runId);
}

/**
 * Drop streams whose completed text has arrived in the durable transcript.
 * The render path also hides these immediately, so reconciliation cannot flash
 * a duplicate while the store waits for its throttled publication.
 */
export function reconcileStreamingMessages(
  runId: string,
  persistedStreamIds: ReadonlySet<string>,
): void {
  const state = stateFor(runId);
  if (state.model.acknowledge(persistedStreamIds)) schedulePublish(runId);
}

/** Terminal status settles a preview; its durable identity retires it later. */
export function settleStreamingMessages(runId: string, interrupted = false): void {
  const state = runs.get(runId);
  if (state?.model.settleTurn(interrupted)) publish(runId);
}

export function clearStreamingMessages(runId: string): void {
  const state = runs.get(runId);
  if (!state) return;
  if (state.frame !== null) cancelAnimationFrame(state.frame);
  state.frame = null;
  state.model.clear();
  state.snapshot = EMPTY;
  for (const listener of state.listeners) listener();
  if (state.listeners.size === 0) runs.delete(runId);
}

export function clearAllStreamingMessages(): void {
  for (const runId of [...runs.keys()]) clearStreamingMessages(runId);
}

function subscribe(runId: string, listener: () => void): () => void {
  const state = stateFor(runId);
  state.listeners.add(listener);
  return () => {
    const current = runs.get(runId);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.model.values().length === 0 && current.listeners.size === 0 && current.frame === null) {
      runs.delete(runId);
    }
  };
}

function snapshot(runId: string): readonly StreamingMessage[] {
  return runs.get(runId)?.snapshot ?? EMPTY;
}

/** The active run's transient assistant text, updated at most once per frame. */
export function useStreamingMessages(runId: string): readonly StreamingMessage[] {
  const subscribeToRun = useCallback(
    (listener: () => void) => subscribe(runId, listener),
    [runId],
  );
  const getRunSnapshot = useCallback(() => snapshot(runId), [runId]);
  return useSyncExternalStore(subscribeToRun, getRunSnapshot, getRunSnapshot);
}
