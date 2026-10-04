const views = new Map<symbol, string>();
const listeners = new Set<() => void>();
let snapshot: ReadonlySet<string> = new Set();

function notify() {
  snapshot = new Set(views.values());
  for (const listener of listeners) listener();
}

/** Only the actual main transcript registers; editor/composer targets do not. */
export const voiceChatPresence = {
  getSnapshot: () => snapshot,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  show(runId: string) {
    const view = Symbol();
    views.set(view, runId);
    notify();
    return () => { if (views.delete(view)) notify(); };
  },
};
