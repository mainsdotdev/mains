/**
 * Utilities for expanding unified diffs to include context around
 * finding lines that aren't visible in the original diff hunks.
 */

interface LineRange {
  start: number;
  end: number;
}

/**
 * Build merged context ranges around a set of line numbers.
 * Adjacent/overlapping ranges are merged.
 */
function buildContextRanges(lines: number[], fileLength: number, contextSize: number): LineRange[] {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const ranges: LineRange[] = [];

  for (const line of sorted) {
    const start = Math.max(1, line - contextSize);
    const end = Math.min(fileLength, line + contextSize);

    const last = ranges[ranges.length - 1];
    if (last && start <= last.end + 2) {
      last.end = end;
    } else {
      ranges.push({ start, end });
    }
  }

  return ranges;
}

/**
 * Build context-only hunk text from file lines for a given range.
 */
function buildContextHunk(range: LineRange, fileLines: string[]): string {
  const count = range.end - range.start + 1;
  const header = `@@ -${range.start},${count} +${range.start},${count} @@`;
  const body = fileLines
    .slice(range.start - 1, range.end)
    .map((l) => ` ${l}`)
    .join("\n");
  return `${header}\n${body}`;
}

const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * Expand a per-file unified diff to include context hunks around
 * finding lines that fall outside existing diff hunks.
 */
export function expandDiffForFindings(
  diffText: string,
  findingLines: number[],
  fileLines: string[],
  contextSize: number = 3,
): string {
  if (findingLines.length === 0 || fileLines.length === 0) return diffText;

  // Single split — used for both hunk header parsing and insertion
  const diffLines = diffText.split("\n");

  // Parse visible ranges from hunk headers
  const visibleRanges: LineRange[] = [];
  for (const line of diffLines) {
    const m = HUNK_RE.exec(line);
    if (m) {
      const start = parseInt(m[1]);
      const count = m[2] !== undefined ? parseInt(m[2]) : 1;
      if (count > 0) visibleRanges.push({ start, end: start + count - 1 });
    }
  }

  const missingLines = findingLines.filter(
    (line) => line >= 1 && line <= fileLines.length && !visibleRanges.some((r) => line >= r.start && line <= r.end),
  );

  if (missingLines.length === 0) return diffText;

  const contextRanges = buildContextRanges(missingLines, fileLines.length, contextSize);

  // Trim context ranges to avoid overlap with existing visible ranges
  const newRanges: LineRange[] = [];
  for (const cr of contextRanges) {
    let parts: LineRange[] = [{ start: cr.start, end: cr.end }];

    for (const vr of visibleRanges) {
      const next: LineRange[] = [];
      for (const p of parts) {
        if (p.end < vr.start || p.start > vr.end) {
          next.push(p);
        } else {
          if (p.start < vr.start) next.push({ start: p.start, end: vr.start - 1 });
          if (p.end > vr.end) next.push({ start: vr.end + 1, end: p.end });
        }
      }
      parts = next;
    }

    newRanges.push(...parts.filter((p) => p.start <= p.end));
  }

  if (newRanges.length === 0) return diffText;

  const newHunks = newRanges.map((range) => ({
    start: range.start,
    text: buildContextHunk(range, fileLines),
  }));

  // Insert new hunks among existing hunks in line-number order
  const result: string[] = [];
  let hunkIdx = 0;

  for (const line of diffLines) {
    const m = HUNK_RE.exec(line);
    if (m) {
      const hunkStart = parseInt(m[1]);
      while (hunkIdx < newHunks.length && newHunks[hunkIdx].start < hunkStart) {
        result.push(newHunks[hunkIdx].text);
        hunkIdx++;
      }
    }
    result.push(line);
  }

  while (hunkIdx < newHunks.length) {
    result.push(newHunks[hunkIdx].text);
    hunkIdx++;
  }

  return result.join("\n");
}
