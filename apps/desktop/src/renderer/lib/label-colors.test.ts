import { describe, it, expect } from "vitest";
import { labelColor, parseLabels } from "./label-colors";

describe("labelColor", () => {
  it("gives the same label the same color, across case and connections", () => {
    expect(labelColor("Bug")).toBe(labelColor("bug"));
    expect(labelColor(" Feature ")).toBe(labelColor("feature"));
    expect(labelColor("Bug")).toMatch(/^#[\da-f]{6}$/);
  });

  it("spreads different labels over the palette", () => {
    const names = ["Bug", "Feature", "Improvement", "Desktop", "Mobile", "Docs", "Design", "Infra"];
    expect(new Set(names.map(labelColor)).size).toBeGreaterThan(3);
  });
});


describe("parseLabels", () => {
  it("returns empty array for null", () => {
    expect(parseLabels(null)).toEqual([]);
  });

  it("parses valid JSON array", () => {
    expect(parseLabels('["bug","feature"]')).toEqual(["bug", "feature"]);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseLabels("not json")).toEqual([]);
  });

  it("returns empty array for non-array JSON", () => {
    expect(parseLabels('"just a string"')).toEqual([]);
  });

  it("returns empty array for JSON object", () => {
    expect(parseLabels('{"key":"value"}')).toEqual([]);
  });
});
