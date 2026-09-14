// ─────────────────────────────────────────────────────────────
// Run cache — the transcript hook's bookkeeping state machine
//
// Plain (React-free) index extracted from use-workspace-runs.ts so the LRU,
// incremental-sync cursors, and in-flight dedup are testable through their
// interface rather than woven through async callbacks. The hook holds one
// instance in a ref and owns all data-fetching + setState; this module owns
// only the bookkeeping and its invariants.
//
// Key invariant (folded into `touch`): when a run falls out of the LRU its
// incremental cursors + "loaded" flag are dropped too, so a re-opened run
// re-fetches its full history rather than a truncated delta.
// ─────────────────────────────────────────────────────────────

/** Most-recent runs whose event/turn caches we retain; older ones are evicted. */
export const MAX_RETAINED_RUNS = 4;

export interface DeltaCursors {
  /** True once a run has been fully loaded — drives delta vs full fetch. */
  isIncremental: boolean;
  /** Max artifact id seen (insert-only); undefined ⇒ full fetch. */
  artifactSince: number | undefined;
  /** Max tool-call updatedAt in ms; undefined ⇒ full fetch. */
  toolSinceMs: number | undefined;
}

export interface RunCache {
  /** Mark `runId` most-recently-used; evict + prune the overflow; return the whitelist (size ≤ MAX). */
  touch(runId: string): Set<string>;
  /** Drop a closed run from the LRU and its incremental bookkeeping. */
  forget(runId: string): void;
  isLoaded(runId: string): boolean;
  markLoaded(runId: string): void;
  getDeltaCursors(runId: string): DeltaCursors;
  /** Advance cursors monotonically from a freshly-fetched delta. */
  advanceCursors(runId: string, deltas: { artifactMaxId?: number; toolMaxMs?: number }): void;
  markFinalized(runId: string): boolean;
  isFinalized(runId: string): boolean;
  /** Admit one load per run. Returns false (and queues a trailing reload) when one is already running. */
  tryAcquireLoad(runId: string): boolean;
  clearPending(runId: string): void;
  hasPending(runId: string): boolean;
  releaseLoad(runId: string): void;
  /** Reset cache contents (LRU, cursors, loaded, finalized) — mirrors the hook's clearState. */
  clear(): void;
}

export function createRunCache(): RunCache {
  /** LRU of recently-viewed run IDs (most recent last). */
  const recentRunIds: string[] = [];
  /** Runs fully loaded at least once — absent ⇒ never loaded or evicted ⇒ full fetch. */
  const loadedRunIds = new Set<string>();
  const artifactCursor: Record<string, number> = {}; // max artifact id seen
  const toolCursor: Record<string, number> = {}; // max toolcall updatedAt (ms) seen
  /** Runs whose terminal transition we've already handled (prevents double-toast). */
  const finalizedRunIds = new Set<string>();
  /** Admits one load per run; a request mid-load queues a single trailing reload. */
  const inFlightLoads = new Set<string>();
  const pendingReload = new Set<string>();

  /**
   * Drop incremental bookkeeping for runs no longer in `allowed`. Iterate
   * `loadedRunIds` (the superset) rather than the cursor maps: a run with tool
   * calls but no artifacts has no artifact cursor, so keying off that map would
   * leave its tool cursor + loaded flag behind and reload it as a truncated delta.
   */
  function pruneCursors(allowed: Set<string>): void {
    for (const id of Array.from(loadedRunIds)) {
      if (!allowed.has(id)) {
        delete artifactCursor[id];
        delete toolCursor[id];
        loadedRunIds.delete(id);
      }
    }
  }

  return {
    touch(runId) {
      const existing = recentRunIds.indexOf(runId);
      if (existing !== -1) recentRunIds.splice(existing, 1);
      recentRunIds.push(runId);
      while (recentRunIds.length > MAX_RETAINED_RUNS) recentRunIds.shift();
      const allowed = new Set(recentRunIds);
      pruneCursors(allowed);
      return allowed;
    },

    forget(runId) {
      const idx = recentRunIds.indexOf(runId);
      if (idx !== -1) recentRunIds.splice(idx, 1);
      delete artifactCursor[runId];
      delete toolCursor[runId];
      loadedRunIds.delete(runId);
    },

    isLoaded(runId) {
      return loadedRunIds.has(runId);
    },

    markLoaded(runId) {
      loadedRunIds.add(runId);
    },

    getDeltaCursors(runId) {
      const isIncremental = loadedRunIds.has(runId);
      return {
        isIncremental,
        artifactSince: isIncremental ? artifactCursor[runId] : undefined,
        toolSinceMs: isIncremental ? toolCursor[runId] : undefined,
      };
    },

    advanceCursors(runId, { artifactMaxId, toolMaxMs }) {
      if (artifactMaxId != null) {
        artifactCursor[runId] = Math.max(artifactCursor[runId] ?? 0, artifactMaxId);
      }
      if (toolMaxMs != null) {
        toolCursor[runId] = Math.max(toolCursor[runId] ?? 0, toolMaxMs);
      }
    },

    markFinalized(runId) {
      if (finalizedRunIds.has(runId)) return false;
      finalizedRunIds.add(runId);
      return true;
    },

    isFinalized(runId) {
      return finalizedRunIds.has(runId);
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
      for (const k of Object.keys(artifactCursor)) delete artifactCursor[k];
      for (const k of Object.keys(toolCursor)) delete toolCursor[k];
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
