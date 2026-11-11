/** Stored files explicitly record the current ownership check. An omitted flag
 * predates that check and cannot prove that a peer shell's changes are absent. */
export function turnUndoOwnershipError(files: readonly { shared?: boolean }[]): string | null {
  if (files.some((file) => file.shared === true)) {
    return "A parallel run changed some of these files too, so this turn can't be undone automatically.";
  }
  if (!files.length || files.some((file) => file.shared !== false)) {
    return "These changes cannot be safely attributed to a single run, so this turn can't be undone automatically.";
  }
  return null;
}
