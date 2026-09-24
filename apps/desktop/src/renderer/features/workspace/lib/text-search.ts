import type {
  TextSearchFileMatch,
  TextSearchLineMatch,
} from "@mains/contracts/text-search";
import type { EditorRevealTarget } from "@/lib/redux/slices/workspaceSlice";

/** A run of preview text, marked when it is part of a match. */
export interface PreviewSegment {
  text: string;
  hit: boolean;
}

/**
 * Split a line's preview into plain and matched runs. Ranges come in
 * full-line offsets; the parts that fall outside the preview window are
 * dropped.
 */
export function previewSegments(match: TextSearchLineMatch): PreviewSegment[] {
  const { preview, previewStart } = match;
  const spans = match.ranges
    .map((range) => ({
      start: Math.max(0, range.start - previewStart),
      end: Math.min(preview.length, range.end - previewStart),
    }))
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start);

  const segments: PreviewSegment[] = [];
  let cursor = 0;
  for (const span of spans) {
    const start = Math.max(span.start, cursor);
    if (span.end <= start) continue;
    const last = segments[segments.length - 1];
    if (start > cursor) {
      segments.push({ text: preview.slice(cursor, start), hit: false });
      segments.push({ text: preview.slice(start, span.end), hit: true });
    } else if (last?.hit) {
      // Touching or overlapping spans read as one match.
      last.text += preview.slice(start, span.end);
    } else {
      segments.push({ text: preview.slice(start, span.end), hit: true });
    }
    cursor = span.end;
  }
  if (cursor < preview.length) {
    segments.push({ text: preview.slice(cursor), hit: false });
  }
  return segments;
}

export interface TextSearchHit {
  file: TextSearchFileMatch;
  match: TextSearchLineMatch;
}

export type TextSearchRow =
  | {
      kind: "file";
      file: TextSearchFileMatch;
      matchCount: number;
      collapsed: boolean;
    }
  | { kind: "hit"; hit: TextSearchHit; hitIndex: number };

/**
 * Lay results out as rows: each file, then its lines unless it is
 * collapsed. `hits` lists the visible lines in row order — the list the
 * keyboard walks.
 */
export function buildTextSearchRows(
  files: readonly TextSearchFileMatch[],
  collapsed: ReadonlySet<string>,
): { rows: TextSearchRow[]; hits: TextSearchHit[] } {
  const rows: TextSearchRow[] = [];
  const hits: TextSearchHit[] = [];
  for (const file of files) {
    const isCollapsed = collapsed.has(file.fullPath);
    rows.push({
      kind: "file",
      file,
      matchCount: file.lines.reduce((sum, line) => sum + line.ranges.length, 0),
      collapsed: isCollapsed,
    });
    if (isCollapsed) continue;
    for (const match of file.lines) {
      const hit = { file, match };
      rows.push({ kind: "hit", hit, hitIndex: hits.length });
      hits.push(hit);
    }
  }
  return { rows, hits };
}

/** Where the editor should select for a hit: the line's first match. */
export function revealTargetForHit({
  file,
  match,
}: TextSearchHit): EditorRevealTarget {
  const first = match.ranges[0];
  return {
    fullPath: file.fullPath,
    line: match.line,
    start: first?.start ?? 0,
    end: first?.end ?? 0,
  };
}

export function describeTextSearchResult(
  matchCount: number,
  fileCount: number,
): string {
  const results = matchCount === 1 ? "1 result" : `${matchCount} results`;
  const files = fileCount === 1 ? "1 file" : `${fileCount} files`;
  return `${results} in ${files}`;
}
