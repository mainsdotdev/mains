/**
 * Word-level emphasis inside a diff — the phone's counterpart to the inline
 * highlighting `@pierre/diffs` draws on the desktop. A removed line and the
 * added line that replaced it are compared token by token, so the parts that
 * actually changed can wear a stronger wash than the row around them.
 */

import type { DiffLine } from "./tool-output";

export interface DiffSegment {
  text: string;
  changed: boolean;
}

/**
 * Past this many token pairs the comparison table costs more than the emphasis
 * is worth; such a line keeps only its row wash.
 */
const MAX_TABLE_CELLS = 40_000;

/**
 * Segments for each line of a hunk, by index; `null` where a line has no
 * partner or nothing worth marking. A run of removed lines pairs up in order
 * with the run of added lines straight after it.
 */
export function wordEmphasis(lines: DiffLine[]): (DiffSegment[] | null)[] {
  const result: (DiffSegment[] | null)[] = lines.map(() => null);
  let i = 0;
  while (i < lines.length) {
    if (lines[i].type !== "remove") {
      i++;
      continue;
    }
    const removeStart = i;
    while (i < lines.length && lines[i].type === "remove") i++;
    const addStart = i;
    while (i < lines.length && lines[i].type === "add") i++;

    const pairs = Math.min(addStart - removeStart, i - addStart);
    for (let k = 0; k < pairs; k++) {
      const compared = compareLines(lines[removeStart + k].text, lines[addStart + k].text);
      if (!compared) continue;
      result[removeStart + k] = compared.before;
      result[addStart + k] = compared.after;
    }
  }
  return result;
}

function compareLines(
  before: string,
  after: string,
): { before: DiffSegment[]; after: DiffSegment[] } | null {
  if (before === after) return null;
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length === 0 || b.length === 0 || a.length * b.length > MAX_TABLE_CELLS) return null;

  // table[i * width + j] = longest common subsequence of a[i..] and b[j..].
  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  const beforeChanged: boolean[] = [];
  const afterChanged: boolean[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      beforeChanged.push(false);
      afterChanged.push(false);
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      beforeChanged.push(true);
      i++;
    } else {
      afterChanged.push(true);
      j++;
    }
  }
  for (; i < a.length; i++) beforeChanged.push(true);
  for (; j < b.length; j++) afterChanged.push(true);

  // A line rewritten outright has nothing to single out; its row wash says it all.
  const shared = a.some((token, k) => !beforeChanged[k] && token.trim() !== "");
  if (!shared) return null;

  return { before: segments(a, beforeChanged), after: segments(b, afterChanged) };
}

/** Words, runs of whitespace, and single punctuation marks. */
function tokenize(text: string): string[] {
  return text.match(/\s+|[\w-￿]+|[^\s\w]/g) ?? [];
}

function segments(tokens: string[], changed: boolean[]): DiffSegment[] {
  const out: DiffSegment[] = [];
  tokens.forEach((token, k) => {
    // Whitespace between two changes reads as one change, not two.
    const bridged =
      !changed[k] && token.trim() === "" && changed[k - 1] === true && changed[k + 1] === true;
    const flag = changed[k] || bridged;
    const last = out[out.length - 1];
    if (last && last.changed === flag) last.text += token;
    else out.push({ text: token, changed: flag });
  });
  return out;
}
