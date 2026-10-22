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

/**
 * Collapse revisions (newest first) to the last one of each editing session.
 * `pinned` revisions (the current one and unresolved conflict branches) are
 * never hidden, even past the limit.
 */
export function historyCheckpoints<T extends HistoryRow>(newestFirst: readonly T[], pinned: ReadonlySet<string>): T[] {
  const kept: T[] = [];
  let anchor: T | null = null;
  let newer: T | null = null;
  for (const row of newestFirst) {
    const sameSession = !!anchor && !!newer && !pinned.has(row.id) && row.actor === anchor.actor
      && newer.createdAt.getTime() - row.createdAt.getTime() < SESSION_IDLE_MS
      && anchor.createdAt.getTime() - row.createdAt.getTime() < SESSION_MAX_MS;
    if (!sameSession) { kept.push(row); anchor = row; }
    newer = row;
  }
  return kept.filter((row, index) => index < HISTORY_CHECKPOINTS || pinned.has(row.id));
}
