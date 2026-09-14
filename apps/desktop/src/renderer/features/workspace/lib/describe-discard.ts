/**
 * A file an Undo would discard. Structural on purpose — the git-actions panel
 * passes `ChangedFile` rows straight in, the Changes tab derives `isNew` from
 * the diff's per-file status.
 */
export interface DiscardTarget {
  /** Repo-relative path. */
  path: string;
  /** Created since the last commit — discarding it deletes it. */
  isNew: boolean;
}

/**
 * What the discard confirmation says. Restoring a committed file is recoverable
 * from git; deleting one that was never committed is not, so that outcome is
 * named outright rather than folded into a generic "cannot be undone".
 *
 * Shared by every surface that lists changed files, so the same click can't
 * warn about two different things depending on which list it came from.
 */
export function describeDiscard(files: DiscardTarget[]): {
  title: string;
  description: string;
} {
  const created = files.filter((f) => f.isNew);
  if (files.length === 1) {
    const name = files[0].path.split("/").pop() || files[0].path;
    return created.length === 1
      ? {
          title: `Delete ${name}?`,
          description: `${files[0].path} was never committed, so deleting it can't be undone.`,
        }
      : {
          title: `Revert ${name}?`,
          description: `${files[0].path} goes back to its committed state. Changes to it are lost.`,
        };
  }
  const restored = files.length - created.length;
  const parts = [
    restored > 0 &&
      `${restored} file${restored === 1 ? "" : "s"} go back to their committed state`,
    created.length > 0 &&
      `${created.length} never-committed file${created.length === 1 ? " is" : "s are"} deleted`,
  ].filter(Boolean);
  return {
    title: "Revert all changes?",
    description: `${parts.join(", and ")}. This can't be undone.`,
  };
}
