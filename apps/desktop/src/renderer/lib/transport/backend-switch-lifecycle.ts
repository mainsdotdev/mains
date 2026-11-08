type Release = () => void | Promise<unknown>;

/** The latest intent owns preparation; the committed backend remains alive
 * until a verified candidate replaces it. Retired tails release only themselves. */
export function createBackendSwitchLifecycle() {
  type Entry = { target?: string; phase: "preparing" | "verifying" | "active" | "retired"; controller: AbortController; resources: Set<Release> };
  let pending: Entry | undefined, active: Entry | undefined;
  const cleanup = new Set<Promise<void>>();
  function release(dispose: Release) {
    try {
      const result = Promise.resolve(dispose()).then(() => {}, (error) => { console.warn("[backend-switch] Resource cleanup failed:", error); });
      cleanup.add(result); void result.finally(() => cleanup.delete(result));
    } catch (error) { console.warn("[backend-switch] Resource cleanup failed:", error); }
  }
  function retire(entry: Entry | undefined) {
    if (!entry || entry.phase === "retired") return;
    entry.phase = "retired";
    entry.controller.abort();
    for (const dispose of entry.resources) release(dispose);
    entry.resources.clear();
    if (pending === entry) pending = undefined;
    if (active === entry) active = undefined;
  }
  return {
    begin(target?: string) {
      const previous = pending;
      const entry: Entry = { target, phase: "preparing", controller: new AbortController(), resources: new Set() };
      pending = entry;
      retire(previous);
      const current = () => pending === entry && entry.phase !== "retired";
      const assertCurrent = () => { if (!current()) throw new Error("This backend connection was canceled or replaced."); };
      return {
        signal: entry.controller.signal,
        assertCurrent,
        isActive: () => active === entry && entry.phase === "active",
        retain(dispose: Release) { if (entry.phase === "retired") release(dispose); else entry.resources.add(dispose); },
        verifying() { assertCurrent(); entry.phase = "verifying"; },
        promote(publish: () => void) {
          assertCurrent();
          const previous = active;
          active = entry; pending = undefined; entry.phase = "active";
          try { publish(); } finally { retire(previous); }
        },
        cancel() { if (entry.phase !== "active") retire(entry); },
      };
    },
    cancelTarget(target: string): boolean {
      const wasActive = active?.target === target;
      if (pending?.target === target) retire(pending);
      if (active?.target === target) retire(active);
      return wasActive;
    },
    disconnect(): Promise<void> {
      retire(pending); retire(active);
      return Promise.allSettled([...cleanup]).then(() => {});
    },
  };
}
export type BackendSwitchAttempt = ReturnType<ReturnType<typeof createBackendSwitchLifecycle>["begin"]>;
