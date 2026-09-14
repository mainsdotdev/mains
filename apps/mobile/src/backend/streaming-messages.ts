import { useCallback, useSyncExternalStore } from "react";

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
  messages: Map<string, StreamingMessage>;
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
      messages: new Map(),
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
  state.snapshot = state.messages.size > 0 ? [...state.messages.values()] : EMPTY;
  for (const listener of state.listeners) listener();
  if (state.messages.size === 0 && state.listeners.size === 0) runs.delete(runId);
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
  const text = typeof payload.event.content === "string" ? payload.event.content : "";
  if (!text) {
    const state = runs.get(payload.runId);
    if (state?.messages.delete(streamId)) schedulePublish(payload.runId);
    return;
  }
  const state = stateFor(payload.runId);
  const previous = state.messages.get(streamId);
  state.messages.set(streamId, {
    key: `stream-${streamId}`,
    streamId,
    text,
    at: previous?.at ?? payload.ts,
  });
  schedulePublish(payload.runId);
}

/**
 * Drop streams whose completed text has arrived in the durable transcript.
 * The render path also hides these immediately, so reconciliation cannot flash
 * a duplicate while the store waits for its throttled publication.
 */
export function reconcileStreamingMessages(
  runId: string,
  persistedResponseContents: ReadonlySet<string>,
): void {
  const state = runs.get(runId);
  if (!state) return;
  let changed = false;
  for (const [streamId, message] of state.messages) {
    if (!persistedResponseContents.has(message.text.trim())) continue;
    state.messages.delete(streamId);
    changed = true;
  }
  if (changed) schedulePublish(runId);
}

export function clearStreamingMessages(runId: string): void {
  const state = runs.get(runId);
  if (!state) return;
  if (state.frame !== null) cancelAnimationFrame(state.frame);
  state.frame = null;
  state.messages.clear();
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
    if (current.messages.size === 0 && current.listeners.size === 0 && current.frame === null) {
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
