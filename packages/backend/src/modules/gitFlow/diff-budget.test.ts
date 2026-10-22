import { describe, expect, it } from "vitest";
import { budgetDiff } from "./diff-budget";

/** One `diff --git` section; `extra` carries git's metadata lines (new file, rename…). */
function section(path: string, body: string[], extra: string[] = []): string {
  return `${[
    `diff --git a/${path} b/${path}`,
    ...extra,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1 +1 @@",
    ...body,
  ].join("\n")}\n`;
}

/** `lines` added lines, each `width` characters wide. */
function added(lines: number, width = 40): string[] {
  return Array.from({ length: lines }, (_, i) =>
    `+${String(i).padStart(width - 1, "x")}`,
  );
}

describe("budgetDiff", () => {
  it("returns null for text that is not a sectioned diff", () => {
    expect(budgetDiff("tracked-hunk\nnew-file-hunk", 1_000)).toBeNull();
  });

  it("maps every file with its status and line counts", () => {
    const diff = [
      section("src/a.ts", ["-old", "+new", "+newer"]),
      section("src/b.ts", ["+created"], ["new file mode 100644"]),
      section("src/c.ts", ["-gone"], ["deleted file mode 100644"]),
      `diff --git a/src/d.ts b/src/e.ts\nsimilarity index 90%\nrename from src/d.ts\nrename to src/e.ts\n`,
    ].join("");

    const out = budgetDiff(diff, 100_000)!;

    expect(out).toContain("Changed files (4):");
    expect(out).toContain("M src/a.ts (+2 -1)");
    expect(out).toContain("A src/b.ts (+1 -0)");
    expect(out).toContain("D src/c.ts (+0 -1)");
    expect(out).toContain("R src/d.ts → src/e.ts (+0 -0)");
  });

  it("counts a removed line that starts with dashes as a deletion", () => {
    const out = budgetDiff(section("README.md", ["----", "+++++"]), 100_000)!;

    expect(out).toContain("M README.md (+1 -1)");
  });

  it("lists lockfiles and other noise but leaves their hunks out", () => {
    const diff = [
      section("package-lock.json", ["+lock-hunk-marker"]),
      section("dist/app.min.js", ["+minified-hunk-marker"]),
      section("src/real.ts", ["+real-hunk-marker"]),
    ].join("");

    const out = budgetDiff(diff, 100_000)!;

    expect(out).toContain("package-lock.json (+1 -0) — diff omitted (lockfile)");
    expect(out).toContain("dist/app.min.js (+1 -0) — diff omitted (minified or source map)");
    expect(out).not.toContain("lock-hunk-marker");
    expect(out).not.toContain("minified-hunk-marker");
    expect(out).toContain("real-hunk-marker");
  });

  it("caps a huge file so the files after it still get their hunks", () => {
    const diff = [
      section("a-huge.ts", added(2_000)),
      section("z-small.ts", ["+tail-hunk-marker"]),
    ].join("");

    const out = budgetDiff(diff, 100_000)!;

    expect(out).toContain("a-huge.ts (+2000 -0) — diff truncated");
    expect(out).toContain("[file diff truncated — showing");
    expect(out).toContain("tail-hunk-marker");
    // Nowhere near the 80k characters the file itself runs to.
    expect(out.length).toBeLessThan(10_000);
  });

  it("keeps small files whole and shares what is left among the large ones", () => {
    const diff = [
      section("big-1.ts", added(500)),
      section("big-2.ts", added(500)),
      section("small.ts", ["+small-hunk-marker"]),
    ].join("");

    const out = budgetDiff(diff, 9_000)!;

    expect(out).toContain("small-hunk-marker");
    expect(out).not.toContain("small.ts (+1 -0) — diff");
    expect(out).toContain("big-1.ts (+500 -0) — diff truncated");
    expect(out).toContain("big-2.ts (+500 -0) — diff truncated");
    // Hunks fit the budget; only the map and truncation notes ride on top.
    expect(out.length).toBeLessThan(9_000 + 1_000);
  });

  describe("when the files outnumber the room", () => {
    const files = Array.from({ length: 40 }, (_, i) =>
      section(`f${String(i).padStart(2, "0")}.ts`, added(i + 1)),
    ).join("");

    it("gives excerpts to the biggest changes and only lists the rest", () => {
      const out = budgetDiff(files, 8_000)!;

      const excerpts = out.match(/^diff --git /gm)!.length;
      expect(excerpts).toBeGreaterThan(0);
      expect(excerpts).toBeLessThan(40);
      expect(out.match(/diff not shown \(too many files\)/g)).toHaveLength(
        40 - excerpts,
      );
      expect(out).toContain("f39.ts (+40 -0) — diff truncated");
      expect(out).toContain("f00.ts (+1 -0) — diff not shown (too many files)");
    });

    it("keeps the whole result, map included, inside the budget", () => {
      for (const budget of [4_000, 8_000, 20_000]) {
        expect(budgetDiff(files, budget)!.length).toBeLessThanOrEqual(budget);
      }
    });
  });

  it("keeps a bounded map, and a line for every excerpt, in codemod-sized changesets", () => {
    const files = [
      // The lockfile out-churns everything but has no excerpt to anchor.
      section("package-lock.json", added(5_000)),
      ...Array.from({ length: 300 }, (_, i) => section(`f${i}.ts`, ["+x"])),
    ].join("");

    const out = budgetDiff(files, 100_000)!;

    expect(out).toContain("Changed files (301):");
    expect(out).toContain("… and 201 more files");
    // 100 excerpts, each with its map line; the lockfile lost its slot to them.
    expect(out.match(/^diff --git /gm)).toHaveLength(100);
    expect(out).not.toContain("package-lock.json");
    for (const header of out.match(/^diff --git a\/(\S+)/gm)!) {
      expect(out).toContain(` ${header.split("a/")[1]} (+1 -0)`);
    }
  });

  it("keeps git's file order in the hunks", () => {
    const diff = [
      section("a.ts", ["+first"]),
      section("b.ts", added(30)),
      section("c.ts", ["+last"]),
    ].join("");

    const out = budgetDiff(diff, 100_000)!;

    const order = ["diff --git a/a.ts", "diff --git a/b.ts", "diff --git a/c.ts"].map((h) =>
      out.indexOf(h),
    );
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(order.every((i) => i >= 0)).toBe(true);
  });

  it("names untracked stubs without inventing line counts", () => {
    const stub = "diff --git a/assets/logo.webp b/assets/logo.webp\nnew file\nBinary or large file (40000 bytes)";

    const out = budgetDiff(stub, 100_000)!;

    expect(out).toContain("A assets/logo.webp (+0 -0)");
    expect(out).toContain("Binary or large file (40000 bytes)");
  });
});
