/**
 * Pure parsers for unified `git diff` output.
 * Kept renderer-side because we already have the raw diff text in the
 * `WorkspaceDiff` payload and don't want to round-trip per-file slicing
 * through IPC for what is essentially a regex split.
 */

/**
 * What happened to a file between the base ref and the working tree.
 * "modified" is the default — the rest are the cases a bare insertion/deletion
 * count can't tell apart (a fully rewritten file and a deleted one both read
 * as "-N").
 *
 * "untracked" is a refinement of "added" that the diff text alone can't make —
 * git renders a staged-new file and an untracked one identically — so it needs
 * the snapshot's untracked list passed alongside.
 *
 * Note that "renamed" is only as reliable as git's own detection: it needs the
 * new path to be tracked (staged or committed) and the content ≥50% similar.
 * An unstaged move therefore reads as a "deleted" + "added" pair, which is what
 * git itself reports.
 */
export type FileChangeStatus =
  | "added"
  | "untracked"
  | "deleted"
  | "renamed"
  | "modified";

export interface FileDiffSummary {
  ins: number;
  del: number;
  status: FileChangeStatus;
  /** Path the file had at the base ref — only set when `status` is "renamed". */
  oldPath?: string;
}

/**
 * Insertions / deletions / change status per file from a unified diff blob.
 *
 * `untrackedFiles` is the same snapshot's untracked list (`WorkspaceDiff
 * .untrackedFiles`); passing it splits "added" into "added" (staged-new) and
 * "untracked". Omit it and every new file reads as "added" — which is what
 * rows captured before the column existed do.
 *
 * Renames are indexed under both the old and the new path, so a lookup by
 * whichever name the caller holds (`WorkspaceDiff.files` carries the new one)
 * still resolves.
 */
export function parsePerFileStats(
  fullDiff: string,
  untrackedFiles?: string[] | null,
): Record<string, FileDiffSummary> {
  const untracked = new Set(untrackedFiles ?? []);
  const stats: Record<string, FileDiffSummary> = {};
  // Anchored at line start so a diff *of* a diff (whose content lines read
  // `+diff --git ...`) doesn't split into bogus sections.
  const fileSections = fullDiff.split(/^(?=diff --git )/m);
  for (const section of fileSections) {
    const headerMatch = section.match(/^diff --git a\/(.+?) b\/(.+)/);
    if (!headerMatch) continue;
    const oldPath = headerMatch[1].trim();
    const newPath = headerMatch[2].trim();
    let ins = 0;
    let del = 0;
    const lines = section.split("\n");
    for (const line of lines) {
      if (line.startsWith("+++") || line.startsWith("---")) continue;
      if (line.startsWith("+")) ins++;
      else if (line.startsWith("-")) del++;
    }
    let status = readChangeStatus(section, oldPath, newPath);
    if (status === "added" && untracked.has(newPath)) status = "untracked";
    const summary: FileDiffSummary = { ins, del, status };
    if (summary.status === "renamed") summary.oldPath = oldPath;
    stats[newPath] = summary;
    if (oldPath !== newPath) stats[oldPath] = summary;
  }
  return stats;
}

/**
 * Read the change status off a single file's diff section.
 *
 * git writes an explicit `new file` / `deleted file` / `rename from` marker;
 * the `/dev/null` side of the `---`/`+++` header is the fallback for diffs
 * produced without those markers — including the synthetic hunks
 * `captureDiffSnapshot` writes for untracked files.
 */
function readChangeStatus(
  section: string,
  oldPath: string,
  newPath: string,
): FileChangeStatus {
  if (/^deleted file/m.test(section) || /^\+\+\+ \/dev\/null/m.test(section)) {
    return "deleted";
  }
  if (/^new file/m.test(section) || /^--- \/dev\/null/m.test(section)) {
    return "added";
  }
  if (/^rename from /m.test(section) || oldPath !== newPath) return "renamed";
  return "modified";
}

/** Extract the diff section for a single file from a unified diff blob. */
export function parseFileDiffSegment(filePath: string, fullDiff: string): string {
  const escapedPath = filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?:^|\\n)diff --git a\\/${escapedPath} b\\/${escapedPath}[\\s\\S]*?(?=\\ndiff --git|$)`,
  );
  const match = fullDiff.match(pattern);
  return match ? match[0].trim() : "";
}
