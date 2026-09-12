import { router, type Href } from "expo-router";
import { useSyncExternalStore } from "react";

import type { PendingPrompt } from "./types";

/**
 * The run the home screen is showing, if any.
 *
 * Home is a chat app's "new conversation": a send does not leave the screen,
 * the conversation starts in place — the prompt goes up as a bubble at once,
 * the Mac's run id follows, and the transcript fills in under it. This is that
 * state, kept outside the screen so that every "new run" gesture in the app —
 * the run screen's toolbar, a space in the sidebar, "New run here" on a
 * workspace — can put home back to its empty composer before showing it.
 */
export interface HomeRun {
  /** Set once the Mac has answered with the run's id. */
  runId: string | null;
  /** What was sent, drawn until the Mac's own copy of the prompt arrives. */
  pending: PendingPrompt | null;
}

const EMPTY: HomeRun = { runId: null, pending: null };
let current: HomeRun = EMPTY;
const listeners = new Set<() => void>();

function update(next: HomeRun): void {
  current = next;
  for (const listener of listeners) listener();
}

export const homeRun = {
  /** The send went out: show it now, ahead of any answer from the Mac. */
  start(pending: PendingPrompt): void {
    update({ runId: null, pending });
  },
  /** The Mac answered: the transcript for this id fills in under the bubble. */
  started(runId: string): void {
    // A "new run" in the meantime already put home back; the answer is stale.
    if (!current.pending) return;
    update({ ...current, runId });
  },
  /** Back to the empty composer — the run itself carries on, on the Mac. */
  clear(): void {
    if (current !== EMPTY) update(EMPTY);
  },
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useHomeRun(): HomeRun {
  return useSyncExternalStore(subscribe, () => current);
}

/** Go home for a fresh composer, whatever home was showing. */
export function goHome(): void {
  homeRun.clear();
  router.dismissTo("/" as Href);
}
