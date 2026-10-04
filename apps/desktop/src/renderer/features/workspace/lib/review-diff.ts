import { parsePatchFiles, type BaseDiffOptions, type FileDiffMetadata } from "@pierre/diffs";
import type { ReviewComment } from "@mains/contracts/review-comments";

export type ReviewDiffStyle = NonNullable<BaseDiffOptions["diffStyle"]>;

export interface ReviewFile {
  path: string;
  patchId: string;
  diff?: FileDiffMetadata;
  error?: string;
}

function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return (hash >>> 0).toString(36);
}

/** One broken/binary patch must not prevent the remaining files from rendering. */
export function reviewFiles(diffText: string, paths: readonly string[]): ReviewFile[] {
  const files: ReviewFile[] = [];
  const parsedPaths = new Set<string>();
  for (const patch of diffText.split(/(?=^diff --git )/m).filter((part) => part.trim())) {
    try {
      const patchId = fingerprint(patch);
      for (const diff of parsePatchFiles(patch, `review:${patchId}:${patch.length}`, true).flatMap((parsed) => parsed.files)) {
        files.push({ path: diff.name, patchId, diff });
        parsedPaths.add(diff.name);
        if (diff.prevName) parsedPaths.add(diff.prevName);
      }
    } catch {
      // The snapshot's file list below still provides a visible fallback.
    }
  }
  let fallbackSnapshotId: string | undefined;
  for (const path of paths) {
    if (!parsedPaths.has(path)) {
      fallbackSnapshotId ??= fingerprint(diffText);
      files.push({ path, patchId: fingerprint(`${path}:${fallbackSnapshotId}`), error: "A text diff is unavailable for this file." });
      parsedPaths.add(path);
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function reviewLineText(diff: FileDiffMetadata, side: ReviewComment["side"], lineNumber: number): string | undefined {
  for (const hunk of diff.hunks) {
    const start = side === "additions" ? hunk.additionStart : hunk.deletionStart;
    const count = side === "additions" ? hunk.additionCount : hunk.deletionCount;
    const index = side === "additions" ? hunk.additionLineIndex : hunk.deletionLineIndex;
    if (lineNumber >= start && lineNumber < start + count) {
      return diff[side === "additions" ? "additionLines" : "deletionLines"][index + lineNumber - start]?.replace(/\r?\n$/, "");
    }
  }
  return undefined;
}

export function reviewCommentMatches(comment: ReviewComment, workspaceId: string, file: ReviewFile): boolean {
  return comment.workspaceId === workspaceId && comment.filePath === file.path &&
    comment.patchId === file.patchId && !!file.diff &&
    reviewLineText(file.diff, comment.side, comment.lineNumber) === comment.lineText;
}
