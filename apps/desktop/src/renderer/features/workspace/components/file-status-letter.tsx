import type { FileChangeStatus } from "../lib/parse-diff";

/**
 * Single-letter git status, shared by the Changes tab and the session panel
 * so a deleted file reads the same in both lists. Every row carries one, so
 * the letter is a column rather than an exception marker.
 */
const STATUS_LETTER: Record<
  FileChangeStatus,
  { label: string; title: string; className: string }
> = {
  added: {
    label: "A",
    title: "Added",
    className: "text-success",
  },
  untracked: {
    label: "U",
    title: "Untracked",
    className: "text-success",
  },
  modified: {
    label: "M",
    title: "Modified",
    className: "text-warning",
  },
  deleted: {
    label: "D",
    title: "Deleted",
    className: "text-danger",
  },
  renamed: {
    label: "R",
    title: "Renamed",
    className: "text-accent",
  },
};

export function FileStatusLetter({
  status,
  title,
  className = "",
}: {
  status: FileChangeStatus;
  title?: string;
  /** Lets the row fade the letter out while its Undo takes the slot. */
  className?: string;
}) {
  const letter = STATUS_LETTER[status];
  return (
    <span
      title={title ?? letter.title}
      // Fixed width so the letters line up into a column regardless of name length.
      className={`shrink-0 w-3 text-center text-xxs font-medium tabular-nums ${letter.className} ${className}`}
    >
      {letter.label}
    </span>
  );
}
