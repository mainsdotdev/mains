// ─────────────────────────────────────────────────────────────
// Run cache — the transcript hook's bookkeeping state machine
//
// Plain (React-free) index extracted from use-workspace-runs.ts so the LRU,
// loaded flags and in-flight dedup are testable through their
// interface rather than woven through async callbacks. The hook holds one
// stable instance and owns all data-fetching + setState; this module owns
// only the bookkeeping and its invariants.
//
// Key invariant (folded into `touch`): when a run falls out of the LRU its
// "loaded" flag is dropped too, so a re-opened run
// fetches the latest history page again.
// ─────────────────────────────────────────────────────────────

/** Most-recent runs whose event/turn caches we retain; older ones are evicted. */
export const MAX_RETAINED_RUNS = 4;

export interface RunCache {
  /** Mark `runId` most-recently-used; evict + prune the overflow; return the whitelist (size ≤ MAX). */
  touch(runId: string): Set<string>;
  /** Drop a closed run from the LRU and its bookkeeping. */
  forget(runId: string): void;
  isLoaded(runId: string): boolean;
  markLoaded(runId: string): void;
  markFinalized(runId: string): boolean;
  isFinalized(runId: string): boolean;
  /** A continued or voice-delegated run gets a new terminal transition. */
  markRunning(runId: string): void;
  /** Admit one load per run. Returns false (and queues a trailing reload) when one is already running. */
  tryAcquireLoad(runId: string): boolean;
  clearPending(runId: string): void;
  hasPending(runId: string): boolean;
  releaseLoad(runId: string): void;
  /** Reset cache contents (LRU, loaded, finalized) — mirrors the hook's clearState. */
  clear(): void;
}

export function createRunCache(): RunCache {
  /** LRU of recently-viewed run IDs (most recent last). */
  const recentRunIds: string[] = [];
  /** Runs whose first history page has loaded — absent means new or evicted. */
  const loadedRunIds = new Set<string>();
  /** Runs whose terminal transition we've already handled (prevents double-toast). */
  const finalizedRunIds = new Set<string>();
  /** Admits one load per run; a request mid-load queues a single trailing reload. */
  const inFlightLoads = new Set<string>();
  const pendingReload = new Set<string>();

  function pruneLoaded(allowed: Set<string>): void {
    for (const id of loadedRunIds) if (!allowed.has(id)) loadedRunIds.delete(id);
  }

  return {
    touch(runId) {
      const existing = recentRunIds.indexOf(runId);
      if (existing !== -1) recentRunIds.splice(existing, 1);
      recentRunIds.push(runId);
      while (recentRunIds.length > MAX_RETAINED_RUNS) recentRunIds.shift();
      const allowed = new Set(recentRunIds);
      pruneLoaded(allowed);
      return allowed;
    },

    forget(runId) {
      const idx = recentRunIds.indexOf(runId);
      if (idx !== -1) recentRunIds.splice(idx, 1);
      loadedRunIds.delete(runId);
    },

    isLoaded(runId) {
      return loadedRunIds.has(runId);
    },

    markLoaded(runId) {
      loadedRunIds.add(runId);
    },

    markFinalized(runId) {
      if (finalizedRunIds.has(runId)) return false;
      finalizedRunIds.add(runId);
      return true;
    },

    isFinalized(runId) {
      return finalizedRunIds.has(runId);
    },

    markRunning(runId) {
      finalizedRunIds.delete(runId);
    },

    tryAcquireLoad(runId) {
      if (inFlightLoads.has(runId)) {
        pendingReload.add(runId); // coalesce; refresh once the in-flight load finishes
        return false;
      }
      inFlightLoads.add(runId);
      return true;
    },

    clearPending(runId) {
      pendingReload.delete(runId);
    },

    hasPending(runId) {
      return pendingReload.has(runId);
    },

    releaseLoad(runId) {
      inFlightLoads.delete(runId);
      pendingReload.delete(runId);
    },

    clear() {
      // Matches the original clearState: in-flight/pending are left alone — an
      // in-flight load self-heals via its own releaseLoad in `finally`.
      recentRunIds.length = 0;
      loadedRunIds.clear();
      finalizedRunIds.clear();
    },
  };
}

/**
 * Evict entries in `map` so that only `allowedIds` remain. Returns the same
 * reference when nothing changed so React can skip re-renders.
 */
export function pruneRunMap<T>(
  map: Record<string, T>,
  allowedIds: Set<string>,
): Record<string, T> {
  let changed = false;
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(map)) {
    if (allowedIds.has(key)) {
      next[key] = value;
    } else {
      changed = true;
    }
  }
  return changed ? next : map;
}
