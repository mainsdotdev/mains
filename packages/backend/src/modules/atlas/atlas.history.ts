/** History lists where each editing session ended, not every autosave in between. */
export const HISTORY_CHECKPOINTS = 10;
/** A pause this long, a different author, or a session this long starts a new checkpoint. */
export const SESSION_IDLE_MS = 10 * 60_000;
export const SESSION_MAX_MS = 30 * 60_000;

interface HistoryRow { id: string; actor: string; createdAt: Date }
interface Author { actor: string; sourceRunId: string | null }

/**
 * Whether a save by `author` at `now` continues the session that `head` closes.
 * `lastWriteAt` is the Page's last write, since `head.createdAt` is the session start.
 */
export function continuesSession(head: Author & { createdAt: Date }, author: Author, lastWriteAt: Date, now: Date): boolean {
  return head.actor === author.actor && head.sourceRunId === author.sourceRunId
    && now.getTime() - lastWriteAt.getTime() < SESSION_IDLE_MS
    && now.getTime() - head.createdAt.getTime() < SESSION_MAX_MS;
}

function sameHistorySession(anchor: HistoryRow, newer: HistoryRow, row: HistoryRow, pinned: ReadonlySet<string>): boolean {
  return !pinned.has(row.id) && row.actor === anchor.actor
    && newer.createdAt.getTime() - row.createdAt.getTime() < SESSION_IDLE_MS
    && anchor.createdAt.getTime() - row.createdAt.getTime() < SESSION_MAX_MS;
}

/** Newest first. Each entry is one editing session, newest revision first inside it. */
function historySessions<T extends HistoryRow>(newestFirst: readonly T[], pinned: ReadonlySet<string>): T[][] {
  const sessions: T[][] = [];
  let anchor: T | null = null;
  let newer: T | null = null;
  for (const row of newestFirst) {
    const same = !!anchor && !!newer && sameHistorySession(anchor, newer, row, pinned);
    if (!same) sessions.push([row]);
    else sessions[sessions.length - 1].push(row);
    anchor = same ? anchor : row;
    newer = row;
  }
  return sessions;
}

/**
 * Collapse revisions (newest first) to the last one of each editing session.
 * `pinned` revisions (the current one and unresolved conflict branches) are
 * never hidden, even past the limit.
 */
export function historyCheckpoints<T extends HistoryRow>(newestFirst: readonly T[], pinned: ReadonlySet<string>): T[] {
  return historySessions(newestFirst, pinned)
    .map((session) => session[0])
    .filter((row, index) => index < HISTORY_CHECKPOINTS || pinned.has(row.id));
}

/**
 * Revisions older than the newest sessions, for a chain whose rows cannot be
 * rewritten. Autosaves inside a retained session stay. Pinned revisions stay.
 * What remains is a prefix: deleting it only unlinks the oldest survivor.
 */
export function historyPrefix<T extends HistoryRow>(newestFirst: readonly T[], pinned: ReadonlySet<string>): T[] {
  return historySessions(newestFirst, pinned).slice(HISTORY_CHECKPOINTS).flat().filter((row) => !pinned.has(row.id));
}
