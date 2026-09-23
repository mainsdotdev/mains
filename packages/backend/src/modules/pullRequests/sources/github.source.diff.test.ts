import { beforeEach, describe, expect, it, vi } from "vitest";

const { get, listFiles } = vi.hoisted(() => ({
  get: vi.fn(),
  listFiles: vi.fn(),
}));

vi.mock("@octokit/rest", () => ({
  Octokit: class {
    pulls = { get, listFiles };
  },
}));

import { createGithubPrSource } from "./github.source";

const ref = { owner: "mainsdotdev", repo: "mains", number: 111 };
const patch = "@@ -1 +1 @@\n-old\n+new\n";

describe("GitHub PR diff", () => {
  beforeEach(() => {
    get.mockReset();
    listFiles.mockReset();
  });

  it("uses the raw diff when GitHub can provide it", async () => {
    const diffText = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n" + patch;
    get.mockResolvedValue({ data: diffText });

    await expect(createGithubPrSource({ token: "test" }).getDiff(ref)).resolves.toEqual({
      diffText,
      truncated: false,
    });
    expect(listFiles).not.toHaveBeenCalled();
  });

  it("loads paginated file patches when the raw diff exceeds GitHub's file limit", async () => {
    get.mockRejectedValue({ status: 406 });
    const firstPage = Array.from({ length: 100 }, (_, i) => ({
      filename: `src/file-${i}.ts`,
      status: "modified",
      patch,
    }));
    listFiles
      .mockResolvedValueOnce({ data: firstPage })
      .mockResolvedValueOnce({ data: [{ filename: "src/last.ts", status: "added", patch }] });

    const result = await createGithubPrSource({ token: "test" }).getDiff(ref);

    expect(result.truncated).toBe(false);
    expect(result.diffText.match(/^diff --git /gm)).toHaveLength(101);
    expect(result.diffText).toContain("--- /dev/null\n+++ b/src/last.ts\n" + patch);
    expect(listFiles).toHaveBeenNthCalledWith(1, {
      owner: "mainsdotdev", repo: "mains", pull_number: 111, per_page: 100, page: 1,
    });
    expect(listFiles).toHaveBeenNthCalledWith(2, {
      owner: "mainsdotdev", repo: "mains", pull_number: 111, per_page: 100, page: 2,
    });
  });

  it("marks the result partial when patches are unavailable or the render cap is reached", async () => {
    get.mockRejectedValue({ status: 406 });
    listFiles.mockResolvedValue({ data: [
      { filename: "image.png", status: "modified" },
      { filename: "large.ts", status: "modified", patch: "@@ -0,0 +1 @@\n" + "+x\n".repeat(65_000) },
      { filename: "later.ts", status: "modified", patch: "@@ -0,0 +1 @@\n" + "+x\n".repeat(65_000) },
    ] });

    const result = await createGithubPrSource({ token: "test" }).getDiff(ref);

    expect(result.truncated).toBe(true);
    expect(result.diffText).toContain("diff --git a/large.ts b/large.ts");
    expect(result.diffText).not.toContain("diff --git a/later.ts b/later.ts");
    expect(result.diffText.length).toBeLessThanOrEqual(300_000);
    expect(listFiles).toHaveBeenCalledTimes(1);
  });

  it("skips an oversized first patch and still returns later reviewable files", async () => {
    get.mockRejectedValue({ status: 406 });
    listFiles.mockResolvedValue({ data: [
      { filename: "huge.ts", status: "modified", patch: "+x\n".repeat(110_000) },
      { filename: "small.ts", status: "modified", patch },
    ] });

    const result = await createGithubPrSource({ token: "test" }).getDiff(ref);

    expect(result.truncated).toBe(true);
    expect(result.diffText).not.toContain("huge.ts");
    expect(result.diffText).toContain("diff --git a/small.ts b/small.ts");
  });

  it("returns a partial empty diff when GitHub has no patches to preview", async () => {
    get.mockRejectedValue({ status: 406 });
    listFiles.mockResolvedValue({ data: [{ filename: "image.png", status: "modified" }] });

    await expect(createGithubPrSource({ token: "test" }).getDiff(ref)).resolves.toEqual({
      diffText: "",
      truncated: true,
    });
  });

  it("keeps non-size API errors visible", async () => {
    const error = { status: 403 };
    get.mockRejectedValue(error);

    await expect(createGithubPrSource({ token: "test" }).getDiff(ref)).rejects.toBe(error);
    expect(listFiles).not.toHaveBeenCalled();
  });
});
