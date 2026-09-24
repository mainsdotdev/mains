import { describe, it, expect } from "vitest";
import type {
  TextSearchFileMatch,
  TextSearchLineMatch,
} from "@mains/contracts/text-search";
import {
  buildTextSearchRows,
  describeTextSearchResult,
  previewSegments,
  revealTargetForHit,
} from "./text-search";

function lineMatch(
  overrides: Partial<TextSearchLineMatch> = {},
): TextSearchLineMatch {
  return {
    line: 1,
    preview: "const foo = foo();",
    previewStart: 0,
    previewClipped: false,
    ranges: [
      { start: 6, end: 9 },
      { start: 12, end: 15 },
    ],
    ...overrides,
  };
}

function fileMatch(name: string, lines: TextSearchLineMatch[]): TextSearchFileMatch {
  return { fullPath: `/repo/${name}`, relativePath: name, lines };
}

describe("previewSegments", () => {
  it("marks every match in the preview", () => {
    expect(previewSegments(lineMatch())).toEqual([
      { text: "const ", hit: false },
      { text: "foo", hit: true },
      { text: " = ", hit: false },
      { text: "foo", hit: true },
      { text: "();", hit: false },
    ]);
  });

  it("shifts full-line ranges into a cut preview and clips the rest", () => {
    const segments = previewSegments(
      lineMatch({
        preview: "foo bar",
        previewStart: 10,
        ranges: [
          { start: 2, end: 5 },
          { start: 10, end: 13 },
          { start: 15, end: 40 },
        ],
      }),
    );
    expect(segments).toEqual([
      { text: "foo", hit: true },
      { text: " b", hit: false },
      { text: "ar", hit: true },
    ]);
  });

  it("merges overlapping ranges", () => {
    const segments = previewSegments(
      lineMatch({
        preview: "abcdef",
        ranges: [
          { start: 1, end: 4 },
          { start: 2, end: 5 },
        ],
      }),
    );
    expect(segments).toEqual([
      { text: "a", hit: false },
      { text: "bcde", hit: true },
      { text: "f", hit: false },
    ]);
  });
});

describe("buildTextSearchRows", () => {
  const a = fileMatch("a.ts", [lineMatch({ line: 1 }), lineMatch({ line: 4 })]);
  const b = fileMatch("b.ts", [lineMatch({ line: 2 })]);

  it("lists each file followed by its lines", () => {
    const { rows, hits } = buildTextSearchRows([a, b], new Set());
    expect(rows.map((row) => row.kind)).toEqual([
      "file",
      "hit",
      "hit",
      "file",
      "hit",
    ]);
    expect(rows[0]).toMatchObject({ kind: "file", matchCount: 4 });
    expect(hits.map((hit) => [hit.file.relativePath, hit.match.line])).toEqual([
      ["a.ts", 1],
      ["a.ts", 4],
      ["b.ts", 2],
    ]);
  });

  it("hides a collapsed file's lines from rows and keyboard hits", () => {
    const { rows, hits } = buildTextSearchRows([a, b], new Set([a.fullPath]));
    expect(rows.map((row) => row.kind)).toEqual(["file", "file", "hit"]);
    expect(rows[0]).toMatchObject({ collapsed: true });
    expect(hits).toHaveLength(1);
    expect(rows[2]).toMatchObject({ kind: "hit", hitIndex: 0 });
  });
});

describe("revealTargetForHit", () => {
  it("selects the line's first match", () => {
    const file = fileMatch("a.ts", []);
    expect(revealTargetForHit({ file, match: lineMatch({ line: 7 }) })).toEqual({
      fullPath: "/repo/a.ts",
      line: 7,
      start: 6,
      end: 9,
    });
  });
});

describe("describeTextSearchResult", () => {
  it("pluralises results and files", () => {
    expect(describeTextSearchResult(1, 1)).toBe("1 result in 1 file");
    expect(describeTextSearchResult(5, 2)).toBe("5 results in 2 files");
  });
});
