import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import simpleGit, { type SimpleGit } from "simple-git";

// ─────────────────────────────────────────────────────────────
// Diff snapshot — the git module's deep diff-capture operation.
//
// `captureDiffSnapshot` is the only entry point; the four diff primitives
// below (diff-since, changed-files-since, shortstat-since, untracked-files)
// are the module's internal seam — used here and by the module's tests,
// never exported from the barrel. See CONTEXT.md "git module".
// ─────────────────────────────────────────────────────────────

/**
 * Every git client in this module, so path output is always raw UTF-8.
 *
 * With git's default `core.quotePath=true`, any path holding a non-ASCII byte
 * comes back wrapped in quotes and octal-escaped — `belgeler/özet.md` reads as
 * `"belgeler/\303\266zet.md"`. Commands whose output we match against paths
 * that arrived from the renderer then silently miss: `discardPaths` read such a
 * file as "not in HEAD" and deleted it instead of restoring it.
 */
export function openGit(rootPath?: string): SimpleGit {
  return simpleGit(rootPath, { config: ["core.quotePath=false"] });
}

const MAX_UNTRACKED_INLINE_BYTES = 256 * 1024;
/** git's own binary sniff window — it reads the first 8KB and no further. */
const BINARY_SNIFF_BYTES = 8 * 1024;

export interface DiffSnapshot {
  baseRef: string;
  diffText: string;
  files: string[];
  untrackedFiles: string[];
  shortstat: string;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").substring(0, 16);
}

/**
 * Split a unified diff into per-file chunks and return filename → content hash.
 * Used to detect which files actually changed between two cumulative diffs
 * that share the same baseRef.
 */
export function buildPerFileDiffHashes(diffText: string): Map<string, string> {
  const result = new Map<string, string>();
  if (!diffText) return result;
  const chunks = diffText.split(/^(?=diff --git )/m);
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    const match = chunk.match(/^diff --git a\/(.+?) b\/(.+)/);
    if (match) {
      const fileName = match[2];
      result.set(fileName, hashContent(chunk));
    }
  }
  return result;
}

export interface FileDiffStat {
  additions: number;
  deletions: number;
  /**
   * The file didn't exist at the base ref — staged-new or untracked. Discarding
   * such a file deletes it rather than restoring it, so callers that ask before
   * destroying anything need to tell the two apart.
   */
  isNew: boolean;
}

/**
 * Per-file added/removed line counts, read off the same unified diff the totals
 * come from — including the synthetic hunks `captureDiffSnapshot` writes for
 * untracked files, which `git diff` alone never reports.
 *
 * Renames are indexed under both the old and new path, so a lookup by whichever
 * name the caller holds still resolves. Files with no line changes (mode-only
 * edits, binaries, oversized untracked stubs) land at 0/0.
 */
export function parsePerFileDiffStats(
  diffText: string,
): Map<string, FileDiffStat> {
  const result = new Map<string, FileDiffStat>();
  if (!diffText) return result;
  for (const chunk of diffText.split(/^(?=diff --git )/m)) {
    const header = chunk.match(/^diff --git a\/(.+?) b\/(.+)/);
    if (!header) continue;
    let additions = 0;
    let deletions = 0;
    // git writes "new file mode <mode>"; the synthetic hunks this module
    // generates for untracked files carry the same marker.
    const isNew = /^new file/m.test(chunk);
    for (const line of chunk.split("\n")) {
      // `+++`/`---` are the file headers, not content lines.
      if (line.startsWith("+++") || line.startsWith("---")) continue;
      if (line.startsWith("+")) additions++;
      else if (line.startsWith("-")) deletions++;
    }
    const stat = { additions, deletions, isNew };
    result.set(header[2].trim(), stat);
    if (header[1] !== header[2]) result.set(header[1].trim(), stat);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// Internal diff primitives
// ─────────────────────────────────────────────────────────────

/** Unified diff since a base commit (staged + unstaged). */
async function diffSince(rootPath: string, baseSha: string): Promise<string> {
  return openGit(rootPath).diff([baseSha]);
}

/** Changed (tracked) files since a base commit. */
async function changedFilesSince(
  rootPath: string,
  baseSha: string,
): Promise<string[]> {
  const raw = await openGit(rootPath).diff(["--name-only", baseSha]);
  return raw
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
}

/** Shortstat summary since a base commit (tracked files only). */
async function shortStatSince(
  rootPath: string,
  baseSha: string,
): Promise<string> {
  const stat = await openGit(rootPath).diff(["--shortstat", baseSha]);
  return stat.trim();
}

/** Untracked files (new files not yet staged). */
async function untrackedFilesOf(rootPath: string): Promise<string[]> {
  const raw = await openGit(rootPath).raw([
    "ls-files",
    "--others",
    "--exclude-standard",
  ]);
  return raw
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────

/**
 * Whether a file's bytes are binary — git's own heuristic, a NUL byte inside
 * the first 8KB.
 *
 * Untracked files are inlined as synthetic hunks, and decoding an image as
 * UTF-8 turns each of its 0x0A bytes into a "line": a 40KB .webp reached the
 * panel as "+334" and carried that into the workspace total. Nothing else in
 * the pipeline counts binary lines — `git diff` answers "Binary files differ"
 * for tracked ones — so these get the same stub the oversized files get.
 */
function looksBinary(buffer: Buffer): boolean {
  const sample = Math.min(buffer.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < sample; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/** A synthetic hunk naming an untracked file without inlining its bytes. */
function untrackedStub(filePath: string, note: string): string {
  return `diff --git a/${filePath} b/${filePath}\nnew file\n${note}`;
}

/**
 * Merge untracked file stats into a git shortstat string.
 * git diff --shortstat only covers tracked files; new files are added here.
 */
function mergeUntrackedIntoShortstat(
  shortstat: string,
  newFileCount: number,
  newInsertions: number,
): string {
  if (newFileCount === 0 && newInsertions === 0) return shortstat;
  const existingFiles = parseInt(shortstat.match(/(\d+) file/)?.[1] ?? "0", 10);
  const existingInsertions = parseInt(shortstat.match(/(\d+) insertion/)?.[1] ?? "0", 10);
  const existingDeletions = parseInt(shortstat.match(/(\d+) deletion/)?.[1] ?? "0", 10);
  const totalFiles = existingFiles + newFileCount;
  const totalInsertions = existingInsertions + newInsertions;
  const parts: string[] = [];
  parts.push(`${totalFiles} file${totalFiles !== 1 ? "s" : ""} changed`);
  if (totalInsertions > 0) {
    parts.push(`${totalInsertions} insertion${totalInsertions !== 1 ? "s" : ""}(+)`);
  }
  if (existingDeletions > 0) {
    parts.push(`${existingDeletions} deletion${existingDeletions !== 1 ? "s" : ""}(-)`);
  }
  return parts.join(", ");
}

// ─────────────────────────────────────────────────────────────
// Snapshot builder
// ─────────────────────────────────────────────────────────────

/**
 * Capture a unified diff between `baseRef` and the working tree at `rootPath`,
 * including synthetic hunks for untracked files (small text files inlined,
 * large/binary files stubbed).
 *
 * All-or-throw: any git failure rejects instead of silently degrading fields
 * to ""/[], so an empty `diffText` always means "clean tree" — callers that
 * need "baseline unknown" semantics map the rejection themselves.
 */
export async function captureDiffSnapshot(
  rootPath: string,
  baseRef: string,
): Promise<DiffSnapshot> {
  const [rawDiff, trackedFiles, trackedShortstat, untrackedFiles] =
    await Promise.all([
      diffSince(rootPath, baseRef),
      changedFilesSince(rootPath, baseRef),
      shortStatSince(rootPath, baseRef),
      untrackedFilesOf(rootPath),
    ]);

  let diffText = rawDiff;
  let shortstat = trackedShortstat;
  const files = [...new Set([...trackedFiles, ...untrackedFiles])];

  // Inline untracked file content as synthetic diff hunks.
  let untrackedInsertions = 0;
  if (untrackedFiles.length > 0) {
    const untrackedDiffs: string[] = [];
    for (const filePath of untrackedFiles) {
      const fullPath = path.join(rootPath, filePath);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > MAX_UNTRACKED_INLINE_BYTES) {
          untrackedDiffs.push(
            untrackedStub(filePath, `Binary or large file (${stat.size} bytes)`),
          );
          continue;
        }
        const buffer = fs.readFileSync(fullPath);
        if (looksBinary(buffer)) {
          untrackedDiffs.push(
            untrackedStub(filePath, `Binary or large file (${stat.size} bytes)`),
          );
          continue;
        }
        const content = buffer.toString("utf-8");
        // "a\nb\n" is two lines, not three: splitting leaves an empty tail for
        // the closing newline, and git counts no insertion for it. Left in, it
        // put a phantom `+` at the end of every synthetic hunk and one extra
        // line on every untracked file's count.
        const lines = content ? content.replace(/\n$/, "").split("\n") : [];
        if (lines.length === 0) {
          untrackedDiffs.push(untrackedStub(filePath, "(empty file)"));
          continue;
        }
        untrackedInsertions += lines.length;
        const diffHeader = [
          `diff --git a/${filePath} b/${filePath}`,
          `new file mode 100644`,
          `--- /dev/null`,
          `+++ b/${filePath}`,
          `@@ -0,0 +1,${lines.length} @@`,
        ].join("\n");
        const diffBody = lines.map((l) => `+${l}`).join("\n");
        untrackedDiffs.push(`${diffHeader}\n${diffBody}`);
      } catch {
        untrackedDiffs.push(untrackedStub(filePath, "(could not read file)"));
      }
    }
    if (untrackedDiffs.length > 0) {
      diffText = diffText
        ? `${diffText}\n${untrackedDiffs.join("\n")}`
        : untrackedDiffs.join("\n");
    }
  }

  if (untrackedInsertions > 0) {
    shortstat = mergeUntrackedIntoShortstat(
      shortstat,
      untrackedFiles.length,
      untrackedInsertions,
    );
  }

  return { baseRef, diffText, files, untrackedFiles, shortstat };
}
