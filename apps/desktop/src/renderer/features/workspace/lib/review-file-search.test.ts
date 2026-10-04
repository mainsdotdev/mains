import { describe, expect, it } from "vitest";
import { reviewFiles, type ReviewFile } from "./review-diff";
import { searchReviewFiles } from "./review-file-search";

const files: ReviewFile[] = Array.from({ length: 1000 }, (_, index) => ({
  path: `src/features/file-${index.toString().padStart(4, "0")}.tsx`, patchId: String(index),
}));

describe("review file search", () => {
  it("bounds menu rows while searching the entire review, including files beyond the first page", () => {
    const all = searchReviewFiles(files, "  ");
    expect(all.total).toBe(1000);
    expect(all.files).toHaveLength(100);
    expect(searchReviewFiles(files, "FEATURES 0999").files).toEqual([files[999]]);
    expect(searchReviewFiles(files, "missing.ts")).toEqual({ files: [], total: 0 });
  });

  it("finds a renamed file by either its original or current path", () => {
    const renamed = reviewFiles(`diff --git a/old/location.ts b/new/location.ts
similarity index 100%
rename from old/location.ts
rename to new/location.ts
`, ["new/location.ts"]);
    expect(searchReviewFiles(renamed, "old location").files).toEqual(renamed);
    expect(searchReviewFiles(renamed, "new/location").files).toEqual(renamed);
  });
});
