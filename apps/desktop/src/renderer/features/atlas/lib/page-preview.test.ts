import { describe, expect, it } from "vitest";
import { pagePreviewRows } from "./page-preview";

describe("Page thumbnail projection", () => {
  it("keeps headings, task state and nested lists while reducing inline formatting to text", () => {
    expect(pagePreviewRows("## Today\n\nTop **priorities**\n- [ ] Test propulsion\n- [x] Verify course\n  - Inspect fuel\n1. [Report](https://example.com)\n> A `quote`"))
      .toEqual([
        { kind: "heading", text: "Today", level: 2, depth: 0 },
        { kind: "paragraph", text: "Top priorities", depth: 0 },
        { kind: "check", text: "Test propulsion", checked: false, depth: 0 },
        { kind: "check", text: "Verify course", checked: true, depth: 0 },
        { kind: "bullet", text: "Inspect fuel", depth: 1 },
        { kind: "numbered", text: "Report", marker: "1.", depth: 0 },
        { kind: "quote", text: "A quote", depth: 0 },
      ]);
  });

  it("treats blank Pages as empty and joins wrapped paragraphs", () => {
    expect(pagePreviewRows("\n   \n")).toEqual([]);
    expect(pagePreviewRows("First line\ncontinued.\n\nNext paragraph."))
      .toMatchObject([{ text: "First line continued." }, { text: "Next paragraph." }]);
  });

  it("bounds long content and the number of rendered rows", () => {
    expect(pagePreviewRows("- item\n".repeat(100))).toHaveLength(18);
    const rows = pagePreviewRows("Long ".repeat(10000));
    expect(rows[0].text.length).toBeLessThanOrEqual(300);
    expect(pagePreviewRows("x".repeat(2400) + "\n## Outside excerpt").some((row) => row.text.includes("Outside excerpt"))).toBe(false);
  });

  it("keeps code literal and reduces images to inert captions", () => {
    expect(pagePreviewRows("```md\n# not a heading\n```\n![Diagram](atlas-file://image)"))
      .toMatchObject([{ kind: "code", text: "# not a heading" }, { kind: "image", text: "Diagram", url: "atlas-file://image" }]);
  });
});
