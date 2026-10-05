import { describe, expect, it } from "vitest";
import { readReviewComments, type ReviewComment } from "@mains/contracts/review-comments";
import { reviewFiles, reviewLineText, reviewCommentMatches } from "./review-diff";
import { buildRunContextPayload } from "./run-context-payload";
import { composerAnnotationPrompt } from "./composer-message";
import { groupContextItems } from "./composer-context";
import { isRunTab, isReviewTab } from "./repo-utils";

const patch = `diff --git a/src/a.ts b/src/a.ts
index 1234567..7654321 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,3 +10,3 @@
 context
-oldValue
+newValue
 end
`;
const comment = (overrides: Partial<ReviewComment> = {}): ReviewComment => ({
  id: "comment-1", workspaceId: "ws", filePath: "src/a.ts", absolutePath: "/repo/src/a.ts",
  side: "deletions", lineNumber: 11, lineText: "oldValue", patchId: reviewFiles(patch, ["src/a.ts"])[0].patchId,
  comment: "Keep the previous behavior.", ...overrides,
});

describe("review diffs and comments", () => {
  it("anchors old and new versions independently, including context and missing lines", () => {
    const file = reviewFiles(patch, ["src/a.ts"])[0];
    expect(reviewLineText(file.diff!, "deletions", 11)).toBe("oldValue");
    expect(reviewLineText(file.diff!, "additions", 11)).toBe("newValue");
    expect(reviewLineText(file.diff!, "additions", 10)).toBe("context");
    expect(reviewLineText(file.diff!, "additions", 9)).toBeUndefined();
    expect(reviewCommentMatches(comment(), "ws", file)).toBe(true);
    expect(reviewCommentMatches(comment(), "another-workspace", file)).toBe(false);
  });

  it("keeps comments off a changed snapshot even when the line number remains the same", () => {
    const file = reviewFiles(patch.replace("newValue", "changedAgain"), ["src/a.ts"])[0];
    expect(reviewCommentMatches(comment(), "ws", file)).toBe(false);
  });

  it("reuses worker cache identities for unchanged patches and invalidates changed content", () => {
    const first = reviewFiles(patch, ["src/a.ts"])[0];
    const same = reviewFiles(patch, ["src/a.ts"])[0];
    const changed = reviewFiles(patch.replace("newValue", "changedAgain"), ["src/a.ts"])[0];
    expect(first.diff?.cacheKey).toBeTruthy();
    expect(same.diff?.cacheKey).toBe(first.diff?.cacheKey);
    expect(changed.diff?.cacheKey).not.toBe(first.diff?.cacheKey);
    expect(same.patchId).toBe(first.patchId);
  });

  it("keeps a large snapshot complete, with unique fallbacks and no rename duplicates", () => {
    const paths = Array.from({ length: 1000 }, (_, index) => `src/file-${index.toString().padStart(4, "0")}.ts`);
    const text = paths.map((path) => patch.split("src/a.ts").join(path)).join("");
    const files = reviewFiles(text, [...paths, ...paths, "binary.png", "binary.png"]);
    expect(files).toHaveLength(1001);
    expect(files[0].path).toBe("binary.png");
    expect(files.slice(1).every((file) => file.diff?.cacheKey && !file.error)).toBe(true);
  });

  it("retains both ends of a 10,000-row diff for virtual rendering and comment anchors", () => {
    const lines = 5000;
    const text = `diff --git a/large.ts b/large.ts\n--- a/large.ts\n+++ b/large.ts\n@@ -1,${lines} +1,${lines} @@\n` +
      Array.from({ length: lines }, (_, index) => `-const old${index} = ${index};\n`).join("") +
      Array.from({ length: lines }, (_, index) => `+const new${index} = ${index + 1};\n`).join("");
    const file = reviewFiles(text, ["large.ts"])[0];
    expect(file.diff?.deletionLines).toHaveLength(lines);
    expect(file.diff?.additionLines).toHaveLength(lines);
    expect(reviewLineText(file.diff!, "deletions", 1)).toBe("const old0 = 0;");
    expect(reviewLineText(file.diff!, "additions", lines)).toBe("const new4999 = 5000;");
  });

  it("keeps renamed, added and binary files in the ordered review", () => {
    const rename = `diff --git a/old name.ts b/new name.ts
similarity index 100%
rename from old name.ts
rename to new name.ts
`;
    const files = reviewFiles(patch + rename, ["src/a.ts", "new name.ts", "assets/logo.png"]);
    expect(files.map((file) => file.path)).toEqual(["assets/logo.png", "new name.ts", "src/a.ts"]);
    expect(files[0].error).toBeTruthy();
    expect(files[1].diff?.prevName).toBe("old name.ts");
  });

  it("carries the user's comment, original code, side and absolute path through run context", () => {
    const item = { kind: "review" as const, ...comment() };
    expect(groupContextItems([item]).reviewComments).toEqual([item]);
    expect(composerAnnotationPrompt([item])).toBe("Address the attached review comments.");
    const payload = buildRunContextPayload([item]);
    expect(payload.initialContext[0].ref).toBe("/repo/src/a.ts#L11");
    expect(payload.initialContext[0].content).toContain("old version, line 11");
    expect(payload.initialContext[0].content).toContain("Code: oldValue");
    expect(payload.initialContext[0].content).toContain(item.comment);
    expect(readReviewComments([payload.initialContext[0].metadata])).toEqual([comment()]);
    expect(isReviewTab("review")).toBe(true);
    expect(isRunTab("review")).toBe(false);
  });

  it("rejects malformed saved comment metadata and projects only supported fields", () => {
    expect(readReviewComments([null, {}, { ...comment(), side: "right" }, { ...comment(), lineNumber: 0 }])).toEqual([]);
    expect(readReviewComments([{ ...comment(), source: "review", extra: "unrelated" }])).toEqual([comment()]);
  });
});
