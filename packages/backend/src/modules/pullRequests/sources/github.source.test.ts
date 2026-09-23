import { describe, expect, it } from "vitest";

import {
  buildSearchQuery,
  truncateDiffAtFileBoundary,
} from "./github.source";

describe("buildSearchQuery", () => {
  it("scopes the 'all' relationship to the viewer", () => {
    expect(
      buildSearchQuery({ relationship: "all", lifecycle: "open" }),
    ).toBe("is:pr involves:@me is:open sort:updated-desc");
  });

  it("maps each relationship to its qualifier", () => {
    expect(
      buildSearchQuery({ relationship: "authored", lifecycle: "all" }),
    ).toBe("is:pr author:@me sort:updated-desc");
    expect(
      buildSearchQuery({ relationship: "review_requested", lifecycle: "all" }),
    ).toBe("is:pr review-requested:@me sort:updated-desc");
    expect(
      buildSearchQuery({ relationship: "reviewed", lifecycle: "all" }),
    ).toBe("is:pr reviewed-by:@me sort:updated-desc");
  });

  it("treats closed as closed-and-unmerged", () => {
    expect(
      buildSearchQuery({ relationship: "all", lifecycle: "closed" }),
    ).toBe("is:pr involves:@me is:closed is:unmerged sort:updated-desc");
  });

  it("adds an OR-combined repo qualifier per repository", () => {
    expect(
      buildSearchQuery({
        relationship: "authored",
        lifecycle: "open",
        repos: ["OkanBilal/life", "mainsdotdev/mains"],
      }),
    ).toBe(
      "is:pr author:@me is:open repo:OkanBilal/life repo:mainsdotdev/mains sort:updated-desc",
    );
  });

  it("drops involves:@me when repos bound the 'all' search", () => {
    expect(
      buildSearchQuery({
        relationship: "all",
        lifecycle: "open",
        repos: ["OkanBilal/life"],
      }),
    ).toBe("is:pr is:open repo:OkanBilal/life sort:updated-desc");
  });

  it("trims trailing repos to stay under GitHub's 256-char cap", () => {
    const repos = Array.from(
      { length: 30 },
      (_, i) => `owner-${i}/repository-name-${i}`,
    );
    const query = buildSearchQuery({
      relationship: "authored",
      lifecycle: "open",
      repos,
    });

    expect(query.length).toBeLessThanOrEqual(256);
    expect(query).toContain("repo:owner-0/repository-name-0");
    expect(query).toContain("author:@me");
    expect(query.endsWith("sort:updated-desc")).toBe(true);
  });

  it("keeps at least one repo under 'all' so the search stays bounded", () => {
    const repos = Array.from(
      { length: 30 },
      (_, i) => `a-very-long-owner-name-${i}/an-even-longer-repository-name-${i}`,
    );
    const query = buildSearchQuery({
      relationship: "all",
      lifecycle: "open",
      repos,
    });

    expect(query).toContain("repo:a-very-long-owner-name-0/");
    expect(query).not.toContain("involves:@me");
  });

  it("quotes and escapes free text, collapsing whitespace", () => {
    expect(
      buildSearchQuery({
        relationship: "all",
        lifecycle: "open",
        text: '  fix  "the"  \\ bug ',
      }),
    ).toBe(
      'is:pr involves:@me is:open "fix \\"the\\" \\\\ bug" sort:updated-desc',
    );
  });

  it("omits empty text", () => {
    expect(
      buildSearchQuery({ relationship: "all", lifecycle: "open", text: "   " }),
    ).toBe("is:pr involves:@me is:open sort:updated-desc");
  });
});

describe("truncateDiffAtFileBoundary", () => {
  const fileSection = (path: string, lines: number) =>
    `diff --git a/${path} b/${path}\n` + `+x\n`.repeat(lines);

  it("returns small diffs untouched", () => {
    const diff = fileSection("a.ts", 3) + fileSection("b.ts", 3);
    expect(truncateDiffAtFileBoundary(diff)).toEqual({
      diffText: diff,
      truncated: false,
    });
  });

  it("cuts oversized diffs at the last complete file section", () => {
    // Four ~90k-char files: the first three fit under the cap, the fourth
    // pushes past it and must be dropped whole.
    const diff =
      fileSection("a.ts", 30_000) +
      fileSection("b.ts", 30_000) +
      fileSection("c.ts", 30_000) +
      fileSection("d.ts", 30_000);
    const result = truncateDiffAtFileBoundary(diff);

    expect(result.truncated).toBe(true);
    expect(result.diffText).toContain("diff --git a/c.ts");
    expect(result.diffText).not.toContain("d.ts");
  });

  it("falls back to a hard cut when a single file exceeds the cap", () => {
    const result = truncateDiffAtFileBoundary(fileSection("a.ts", 200_000));

    expect(result.truncated).toBe(true);
    expect(result.diffText.startsWith("diff --git a/a.ts")).toBe(true);
    expect(result.diffText.length).toBeLessThanOrEqual(300_000);
  });
});
