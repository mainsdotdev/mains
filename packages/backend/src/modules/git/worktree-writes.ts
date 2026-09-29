import path from "node:path";
import { locateWorktree, type WorktreeLocation } from "./git-tree-snapshot";

// ─────────────────────────────────────────────────────────────
// Worktree writes — who wrote what in a worktree while runs are live in it.
//
// A turn's changes are the difference between two working-tree snapshots,
// and a snapshot cannot say whose hand made a change. This ledger lets a
// closing turn tell its own files from everyone else's: each live session
// records the files its tool calls named, and the app records what its own
// operations wrote — a pull, a branch switch, a discard, an undo, an editor
// save (`noteAppWrites`). In memory, keyed by the worktree root, and kept only
// while a session is live to ask. See CONTEXT.md "turn changes".
// ─────────────────────────────────────────────────────────────

/** The writer behind the app's own operations, as opposed to a run's tools. */
export const APP_WRITER = "app";

interface SessionSpan {
  runId: string;
  startedAt: number;
  endedAt: number | null;
}

interface WriteRecord {
  /** A run id, or `APP_WRITER`. */
  writer: string;
  /** Worktree-root-relative; null for a write that named no file (a shell). */
  path: string | null;
  at: number;
}

interface Ledger {
  spans: SessionSpan[];
  writes: WriteRecord[];
}

const ledgers = new Map<string, Ledger>();

/** What everyone but one run did in a worktree since its turn began. */
export interface PeerWrites {
  /** Another run was live in the worktree, or someone else wrote to it. */
  concurrent: boolean;
  /** Files they named. */
  paths: Set<string>;
  /** One of them ran something that writes files without naming them. */
  unnamed: boolean;
}

/**
 * Drop what no live session can still ask about: every open turn began after
 * its own session started, so nothing older than the earliest live start can
 * fall inside one.
 */
function prune(worktree: string, ledger: Ledger): void {
  const live = ledger.spans.filter((s) => s.endedAt === null);
  if (live.length === 0) {
    ledgers.delete(worktree);
    return;
  }
  const horizon = Math.min(...live.map((s) => s.startedAt));
  ledger.spans = ledger.spans.filter((s) => s.endedAt === null || s.endedAt >= horizon);
  ledger.writes = ledger.writes.filter((w) => w.at >= horizon);
}

export const worktreeWrites = {
  /** Whether any session is live anywhere — when not, nothing is worth recording. */
  watching(): boolean {
    return ledgers.size > 0;
  },

  /** A session went live in `worktree`. */
  open(worktree: string, runId: string, startedAt: number): void {
    const ledger = ledgers.get(worktree) ?? { spans: [], writes: [] };
    ledger.spans.push({ runId, startedAt, endedAt: null });
    ledgers.set(worktree, ledger);
  },

  /** The session finished. Call after its last turn's changes are stored. */
  close(worktree: string, runId: string, endedAt: number): void {
    const ledger = ledgers.get(worktree);
    if (!ledger) return;
    for (const span of ledger.spans) {
      if (span.runId === runId && span.endedAt === null) span.endedAt = endedAt;
    }
    prune(worktree, ledger);
  },

  /**
   * `writer` wrote `paths` (worktree-root-relative) in `worktree`. Dropped
   * when no session is live there: there is no turn to tell it apart for.
   */
  record(
    worktree: string,
    writer: string,
    writes: { paths: Iterable<string>; unnamed: boolean },
    at: number,
  ): void {
    const ledger = ledgers.get(worktree);
    if (!ledger) return;
    for (const filePath of writes.paths) ledger.writes.push({ writer, path: filePath, at });
    if (writes.unnamed) ledger.writes.push({ writer, path: null, at });
  },

  /** What everyone but `runId` did in `worktree` since `since`. */
  peersSince(worktree: string, runId: string, since: number): PeerWrites {
    const peers: PeerWrites = { concurrent: false, paths: new Set(), unnamed: false };
    const ledger = ledgers.get(worktree);
    if (!ledger) return peers;
    peers.concurrent = ledger.spans.some(
      (s) => s.runId !== runId && (s.endedAt === null || s.endedAt >= since),
    );
    for (const write of ledger.writes) {
      if (write.writer === runId || write.at < since) continue;
      // The app's writes have no span; a write inside the turn is enough.
      peers.concurrent = true;
      if (write.path === null) peers.unnamed = true;
      else peers.paths.add(write.path);
    }
    return peers;
  },
};

function isInside(relative: string): boolean {
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith("../") &&
    !path.isAbsolute(relative)
  );
}

/**
 * A path as a tool or caller gave it — absolute, or relative to `cwd` — as the
 * worktree-root-relative path tree diffs report. Null outside the worktree.
 */
export function toWorktreePath(
  location: WorktreeLocation,
  cwd: string,
  filePath: string,
): string | null {
  const fromCwd = path.isAbsolute(filePath) ? path.relative(cwd, filePath) : filePath;
  const joined = path.posix.normalize(location.prefix + fromCwd);
  if (isInside(joined)) return joined;
  // An absolute path spelled the way git resolves the root (/private/tmp/…)
  // rather than the way the cwd was given (/tmp/…).
  if (path.isAbsolute(filePath)) {
    const fromRoot = path.relative(location.topLevel, filePath);
    if (isInside(fromRoot)) return fromRoot;
  }
  return null;
}

/**
 * Record files one of the app's own operations wrote in the worktree holding
 * `rootPath`. `listPaths` returns them worktree-root-relative and runs only
 * while a session is live. Never throws: it is bookkeeping, and must not fail
 * the write it describes.
 */
export async function noteAppWrites(
  rootPath: string,
  listPaths: (location: WorktreeLocation) => Promise<Array<string | null>> | Array<string | null>,
): Promise<void> {
  if (!worktreeWrites.watching()) return;
  try {
    const location = await locateWorktree(rootPath);
    const paths = (await listPaths(location)).filter((p): p is string => Boolean(p));
    if (paths.length === 0) return;
    worktreeWrites.record(location.topLevel, APP_WRITER, { paths, unnamed: false }, Date.now());
  } catch (err) {
    console.warn(
      "[worktree-writes] Could not record the app's own write:",
      err instanceof Error ? err.message : err,
    );
  }
}
