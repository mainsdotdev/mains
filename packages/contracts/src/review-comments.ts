/** Local diff comments carried with a user prompt. Sides use the diff renderer's names. */
export interface ReviewComment {
  id: string;
  workspaceId: string;
  filePath: string;
  absolutePath: string;
  side: "additions" | "deletions";
  lineNumber: number;
  lineText: string;
  patchId: string;
  comment: string;
}

/** Prompt metadata is also read from older and external provider events. */
export function readReviewComments(value: unknown): ReviewComment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (!["id", "workspaceId", "filePath", "absolutePath", "lineText", "patchId", "comment"]
      .every((key) => typeof record[key] === "string") ||
      !record.id || !record.filePath || !record.comment ||
      (record.side !== "additions" && record.side !== "deletions") ||
      typeof record.lineNumber !== "number" || !Number.isSafeInteger(record.lineNumber) || record.lineNumber < 1) return [];
    return [{
      id: record.id as string,
      workspaceId: record.workspaceId as string,
      filePath: record.filePath as string,
      absolutePath: record.absolutePath as string,
      side: record.side,
      lineNumber: record.lineNumber,
      lineText: record.lineText as string,
      patchId: record.patchId as string,
      comment: record.comment as string,
    }];
  });
}
