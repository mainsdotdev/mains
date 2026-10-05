import { describe, expect, it } from "vitest";
import { splitMarkdownFrontmatter } from "./markdown-frontmatter";

describe("Markdown document frontmatter", () => {
  it("separates skill metadata from the Markdown body", () => {
    const body = "\n# Apple Design\n\nContent.\n\n---\n\nMore content.";
    expect(splitMarkdownFrontmatter([
      "---", "name: apple-design", "description: Apple's approach to fluid interfaces.", "---", body,
    ].join("\n"))).toEqual({
      body,
      frontmatter: {
        source: "name: apple-design\ndescription: Apple's approach to fluid interfaces.",
        entries: [
          { key: "name", value: "apple-design" },
          { key: "description", value: "Apple's approach to fluid interfaces." },
        ],
      },
    });
  });

  it("supports folded descriptions, quoted values, booleans, dates and nested values", () => {
    const result = splitMarkdownFrontmatter([
      "---", "description: >-", "  First line", "  second line", "enabled: false",
      "date: 2026-10-05", "tools: [Read, Write]", "settings:", "  mode: safe", "empty: null",
      "---", "# Body",
    ].join("\n"));
    expect(result.frontmatter?.entries).toEqual([
      { key: "description", value: "First line second line" },
      { key: "enabled", value: "false" },
      { key: "date", value: "2026-10-05" },
      { key: "tools", value: "- Read\n- Write" },
      { key: "settings", value: "mode: safe" },
      { key: "empty", value: "null" },
    ]);
    expect(result.body).toBe("# Body");
  });

  it("accepts a BOM, CRLF and a YAML end marker", () => {
    expect(splitMarkdownFrontmatter("\uFEFF---\r\nname: skill\r\n...\r\n# Body\r\n"))
      .toEqual({ body: "# Body\r\n", frontmatter: { source: "name: skill", entries: [{ key: "name", value: "skill" }] } });
  });

  it.each([
    "# Title\n\n---\nname: normal body\n---\n",
    "---\nname: unclosed",
    "```yaml\n---\nname: example\n---\n```",
    "Plain Markdown without metadata.",
  ])("leaves ordinary Markdown and incomplete headers intact", (content) => {
    expect(splitMarkdownFrontmatter(content)).toEqual({ body: content, frontmatter: null });
  });

  it("keeps malformed or unsupported YAML visible as plain source", () => {
    for (const source of ['description: "unclosed', "name: !custom skill", "- first\n- second"]) {
      expect(splitMarkdownFrontmatter(`---\n${source}\n---\n# Body`))
        .toEqual({ body: "# Body", frontmatter: { source, entries: null } });
    }
  });

  it("handles empty metadata and headers ending at EOF", () => {
    expect(splitMarkdownFrontmatter("---\n---\n# Body")).toEqual({ body: "# Body", frontmatter: null });
    expect(splitMarkdownFrontmatter("---\nname: skill\n---").body).toBe("");
  });

  it("renders aliases without expanding repeated or cyclic values into JSON", () => {
    const result = splitMarkdownFrontmatter("---\nsettings: &settings\n  self: *settings\n---\n# Body");
    expect(result.frontmatter?.entries?.[0].value).toContain("*ref_");
    expect(result.body).toBe("# Body");
  });
});
