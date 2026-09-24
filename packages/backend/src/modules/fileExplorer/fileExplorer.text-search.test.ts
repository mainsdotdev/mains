import { describe, it, expect } from "vitest";
import {
  buildRipgrepArgs,
  describeRipgrepFailure,
  takeOverTextSearch,
  toLineMatch,
} from "./fileExplorer.text-search";

const baseOptions = {
  rootPath: "/repo",
  query: "foo",
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  includeHidden: true,
};

describe("buildRipgrepArgs", () => {
  it("searches literal text case-insensitively by default", () => {
    const args = buildRipgrepArgs(baseOptions);
    expect(args).toContain("--fixed-strings");
    expect(args).toContain("--ignore-case");
    expect(args).toContain("--hidden");
    expect(args).not.toContain("--word-regexp");
    expect(args.slice(-4)).toEqual(["--regexp", "foo", "--", "/repo"]);
  });

  it("maps each option onto its flag", () => {
    const args = buildRipgrepArgs({
      ...baseOptions,
      caseSensitive: true,
      wholeWord: true,
      regex: true,
      includeHidden: false,
    });
    expect(args).toContain("--case-sensitive");
    expect(args).toContain("--word-regexp");
    expect(args).not.toContain("--fixed-strings");
    expect(args).not.toContain("--hidden");
  });

  it("keeps a query that looks like a flag out of flag position", () => {
    const args = buildRipgrepArgs({ ...baseOptions, query: "--files" });
    expect(args[args.indexOf("--files") - 1]).toBe("--regexp");
  });

  it("excludes dependency and VCS directories", () => {
    const args = buildRipgrepArgs(baseOptions);
    expect(args).toContain("!node_modules");
    expect(args).toContain("!.git");
  });
});

describe("toLineMatch", () => {
  it("converts UTF-8 byte offsets to UTF-16 offsets", () => {
    const line = Buffer.from('const s = "çay foo";\n', "utf8");
    // "ç" is two bytes, so "foo" starts at byte 16 but character 15.
    const match = toLineMatch(line, 3, [{ start: 16, end: 19 }]);
    expect(match.line).toBe(3);
    expect(match.ranges).toEqual([{ start: 15, end: 18 }]);
    expect(match.preview).toBe('const s = "çay foo";');
    expect(match.previewStart).toBe(0);
    expect(match.previewClipped).toBe(false);
  });

  it("trims leading indentation without calling the preview clipped", () => {
    const match = toLineMatch(Buffer.from("\t\tlet foo = 1;\r\n"), 1, [
      { start: 6, end: 9 },
    ]);
    expect(match.preview).toBe("let foo = 1;");
    expect(match.previewStart).toBe(2);
    expect(match.previewClipped).toBe(false);
    expect(match.ranges).toEqual([{ start: 6, end: 9 }]);
  });

  it("measures the lead-in from the end of the indentation", () => {
    const text = `${" ".repeat(40)}const [page, setPage] = useState(0);`;
    const match = toLineMatch(Buffer.from(text), 1, [{ start: 64, end: 72 }]);
    expect(match.preview).toBe("const [page, setPage] = useState(0);");
    expect(match.previewClipped).toBe(false);
  });

  it("windows a long line around its first match", () => {
    const text = `${"x".repeat(500)}needle${"y".repeat(500)}`;
    const match = toLineMatch(Buffer.from(text), 1, [{ start: 500, end: 506 }]);
    expect(match.previewStart).toBe(476);
    expect(match.previewClipped).toBe(true);
    expect(match.preview.length).toBe(240);
    const { start, end } = match.ranges[0];
    expect(
      match.preview.slice(start - match.previewStart, end - match.previewStart),
    ).toBe("needle");
  });

  it("never splits a surrogate pair at the window edge", () => {
    // "needle" sits at character 49, so the window would open at 25 — the
    // emoji's second half. The emoji is four UTF-8 bytes: "needle" is at 51.
    const text = `${"a".repeat(24)}😀${"b".repeat(23)}needle`;
    const match = toLineMatch(Buffer.from(text), 1, [{ start: 51, end: 57 }]);
    expect(match.ranges).toEqual([{ start: 49, end: 55 }]);
    expect(match.previewStart).toBe(24);
    expect(match.preview.startsWith("😀")).toBe(true);
  });
});

describe("describeRipgrepFailure", () => {
  it("names the regex problem", () => {
    const error = describeRipgrepFailure(
      "rg: regex parse error:\n    (?:foo()\n    ^\nerror: unclosed group\n",
    );
    expect(error.message).toBe("Invalid regular expression: unclosed group");
  });

  it("passes other failures through without the rg prefix", () => {
    expect(describeRipgrepFailure("rg: something broke\n").message).toBe(
      "Search failed: something broke",
    );
  });
});

describe("takeOverTextSearch", () => {
  it("cancels the search running under the same key", () => {
    const first = takeOverTextSearch("explorer");
    const second = takeOverTextSearch("explorer");
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    first.release();
    // A stale release must not unregister the newer search.
    const third = takeOverTextSearch("explorer");
    expect(second.signal.aborted).toBe(true);
    second.release();
    third.release();
  });

  it("leaves searches without a key alone", () => {
    const first = takeOverTextSearch(undefined);
    takeOverTextSearch(undefined);
    expect(first.signal.aborted).toBe(false);
  });
});
