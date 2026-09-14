import { normalizePath } from "./path-utils";

/**
 * @pierre/diffs PatchDiff runs getSingularPatch → parsePatchFiles → processPatch.
 * - With `diff --git`, files split only on those lines.
 * - Without it, files split on every `--- <path>` header (UNIFIED_DIFF_FILE_BREAK_REGEX).
 * Multi-file input must be reduced to a single file before passing to PatchDiff.
 */
export function normalizePatchForPatchDiff(diffText: string, filePath: string | undefined): string {
  const text = diffText.replace(/\r\n/g, "\n");
  if (!text.trim()) return text;

  const gitCount = (text.match(/^diff --git /gm) ?? []).length;
  const legacyPairs = [...text.matchAll(/^--- \S[^\n]*\n\+\+\+ \S[^\n]*/gm)];

  if (gitCount > 1) {
    if (filePath) {
      const seg = parseGitFileSegment(normalizePath(filePath), text);
      if (seg) return seg;
    }
    return extractFirstGitSection(text);
  }

  if (gitCount === 0 && legacyPairs.length > 1) {
    if (filePath) {
      const seg = parseLegacyFileSegment(normalizePath(filePath), text);
      if (seg) return seg;
    }
    return sliceLegacyPairRange(text, 0);
  }

  if (gitCount >= 1) {
    return extractFirstGitSection(text);
  }

  if (legacyPairs.length === 1 && legacyPairs[0].index !== undefined && legacyPairs[0].index > 0) {
    return sliceLegacyPairRange(text, 0);
  }

  return text;
}

function parseGitFileSegment(targetPath: string, fullDiff: string): string {
  const escapedPath = targetPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?:^|\\n)diff --git a\\/${escapedPath} b\\/${escapedPath}[\\s\\S]*?(?=\\ndiff --git |$)`,
  );
  const match = fullDiff.match(pattern);
  return match ? match[0].trim() : "";
}

function extractFirstGitSection(fullDiff: string): string {
  const matches = [...fullDiff.matchAll(/^diff --git /gm)];
  if (matches.length === 0) return fullDiff.trim();
  const start = matches[0].index ?? 0;
  const end = matches.length > 1 ? (matches[1].index ?? fullDiff.length) : fullDiff.length;
  return fullDiff.slice(start, end).trim();
}

function parseLegacyFileSegment(targetPath: string, fullDiff: string): string {
  const escapedPath = targetPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?:^|\\n)--- (?:a\\/|b\\/)?${escapedPath}[\\s\\S]*?(?=\\n--- \\S[^\\n]*\\n\\+\\+\\+ |$)`,
  );
  const match = fullDiff.match(pattern);
  return match ? match[0].trim() : "";
}

function sliceLegacyPairRange(fullDiff: string, pairIndex: number): string {
  const pairs = [...fullDiff.matchAll(/^--- \S[^\n]*\n\+\+\+ \S[^\n]*/gm)];
  const m = pairs[pairIndex];
  if (!m || m.index === undefined) return fullDiff.trim();
  const start = m.index;
  const next = pairs[pairIndex + 1];
  const end = next?.index ?? fullDiff.length;
  return fullDiff.slice(start, end).trim();
}
