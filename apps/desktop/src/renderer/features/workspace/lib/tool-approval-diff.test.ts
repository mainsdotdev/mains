import { describe, expect, it } from "vitest";
import { buildApprovalDiffPreviews } from "./tool-approval-diff";

describe("buildApprovalDiffPreviews", () => {
  it("normalizes the SDK's absolute-path diff without losing the proposed change", () => {
    const filePath = "/workspace/components/hero-section.tsx";
    const [preview] = buildApprovalDiffPreviews("edit", { file_path: filePath,
      diff: `diff --git a${filePath} b${filePath}\nindex 0000000..0000000 100644\n--- a${filePath}\n+++ b${filePath}\n@@ -69,1 +69,1 @@\n-old copy\n+new copy` });
    expect(preview.filePath).toBe(filePath);
    expect(preview.patch).toContain("@@ -69,1 +69,1 @@");
    expect(preview.patch).toContain("-old copy\n+new copy");
  });

  it("builds a content preview from legacy Copilot newFileContents", () => {
    const [preview] = buildApprovalDiffPreviews("write", { fileName: "new.ts", newFileContents: "export const ready = true;\n" });
    expect(preview.patch).toContain("+export const ready = true;");
  });

  it("builds an edit patch from Claude old/new strings", () => {
    const [preview] = buildApprovalDiffPreviews("edit", {
      file_path: "src/card.tsx",
      old_string: "const tone = 'old';\n",
      new_string: "const tone = 'new';\n",
    });

    expect(preview.filePath).toBe("src/card.tsx");
    expect(preview.patch).toContain("--- a/card.tsx");
    expect(preview.patch).toContain("@@ -1,1 +1,1 @@");
    expect(preview.patch).toContain("-const tone = 'old';");
    expect(preview.patch).toContain("+const tone = 'new';");
  });

  it("builds a new-file patch without a phantom line after a final newline", () => {
    const [preview] = buildApprovalDiffPreviews("write", {
      path: "src/new.ts",
      content: "export const ready = true;\n",
    });

    expect(preview.patch).toContain("new file mode 100644");
    expect(preview.patch).toContain("@@ -0,0 +1,1 @@");
    expect(preview.patch).toContain("+export const ready = true;");
    expect(preview.patch.endsWith("\n+")).toBe(false);
  });

  it("adds file headers to a Codex hunk-only diff", () => {
    const [preview] = buildApprovalDiffPreviews("edit", {
      file_path: "src/index.ts",
      diff: "@@ -4,1 +4,1 @@\n-oldValue\n+newValue",
    });

    expect(preview.patch).toContain("diff --git a/index.ts b/index.ts");
    expect(preview.patch).toContain("@@ -4,1 +4,1 @@");
  });

  it("extracts every file from an apply_patch envelope", () => {
    const previews = buildApprovalDiffPreviews("apply-patch", {
      patch: [
        "*** Begin Patch",
        "*** Update File: src/first.ts",
        "@@",
        "-before",
        "+after",
        "*** Update File: src/second.ts",
        "+ignored",
        "*** End Patch",
      ].join("\n"),
    });

    expect(previews).toHaveLength(2);
    expect(previews[0].filePath).toBe("src/first.ts");
    expect(previews[0].patch).toContain("-before");
    expect(previews[0].patch).toContain("+after");
    expect(previews[1].filePath).toBe("src/second.ts");
    expect(previews[1].patch).toContain("+ignored");
  });
});
