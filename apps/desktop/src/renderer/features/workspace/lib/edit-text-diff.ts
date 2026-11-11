import { diffLines } from "diff";

export interface EditDiffLine {
  type: "add" | "remove" | "context";
  text: string;
}

/** ACP snapshots can contain whole files, including unchanged lines. */
export function editTextDiff(before: string, after: string): { lines: EditDiffLine[]; added: number; removed: number } {
  const lines: EditDiffLine[] = [];
  let added = 0;
  let removed = 0;
  if (before === after) return { lines, added, removed };

  for (const change of diffLines(before, after)) {
    const textLines = change.value.split("\n");
    // A final newline terminates the last line; it isn't another empty line.
    if (change.value.endsWith("\n")) textLines.pop();
    const type = change.added ? "add" : change.removed ? "remove" : "context";
    if (change.added) added += textLines.length;
    if (change.removed) removed += textLines.length;
    for (const text of textLines) lines.push({ type, text });
  }
  return { lines, added, removed };
}
