import { describe, expect, it } from "vitest";
import { formatPrMarkdown } from "./pr-markdown";

describe("PR markdown formatting", () => {
  it("wraps selected text without replacing the surrounding draft", () => {
    expect(formatPrMarkdown("one two three", 4, 7, "bold")).toEqual({ value: "one **two** three", start: 6, end: 9 });
  });
  it("adds task markers to complete selected lines without consuming the next line", () => {
    const result = formatPrMarkdown("first\nsecond\nthird", 2, 13, "checklist");
    expect(result.value).toBe("- [ ] first\n- [ ] second\nthird");
  });
  it("uses a fenced block for multiline code and leaves its contents selected", () => {
    const result = formatPrMarkdown("a\nb", 0, 3, "code");
    expect(result.value).toBe("```\na\nb\n```");
    expect(result.value.slice(result.start, result.end)).toBe("a\nb");
  });
  it("inserts an editable link at an empty cursor", () => {
    const result = formatPrMarkdown("hello ", 6, 6, "link");
    expect(result.value).toBe("hello [link text](https://example.com)");
    expect(result.value.slice(result.start, result.end)).toBe("link text");
  });
});
