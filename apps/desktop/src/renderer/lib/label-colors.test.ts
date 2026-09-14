import { describe, it, expect } from "vitest";
import { parseLabels } from "./label-colors";


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
