/**
 * Startup animation gate. `index.css` forces every animation/transition to 0s
 * while `<html>` lacks the `app-ready` class, so opens/closes render instantly
 * (instead of stuttering) during the launch churn. `main.tsx` decides when the
 * churn is over and calls `markAppReady()`; anything that must run only after
 * animations are live (e.g. the dropdown keyframe prewarm) subscribes via
 * `onAppReady()`.
 */

const READY_CLASS = "app-ready";

let ready = false;
const waiters: Array<() => void> = [];

export function isAppReady(): boolean {
  return ready;
}

export function markAppReady(): void {
  if (ready) return;
  ready = true;
  document.documentElement.classList.add(READY_CLASS);
  for (const waiter of waiters.splice(0)) waiter();
}

/** Run `callback` once the app is ready (immediately if it already is). Returns an unsubscribe. */
export function onAppReady(callback: () => void): () => void {
  if (ready) {
    callback();
    return () => {};
  }
  waiters.push(callback);
  return () => {
    const index = waiters.indexOf(callback);
    if (index !== -1) waiters.splice(index, 1);
  };
}
