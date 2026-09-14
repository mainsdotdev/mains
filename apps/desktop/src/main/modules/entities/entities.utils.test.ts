import { describe, it, expect } from "vitest";
import {
  serializeLabels,
  serializeMetadata,
  parseLabels,
  parseMetadata,
} from "./entities.utils";

describe("serializeLabels", () => {
  it("returns null for undefined", () => {
    expect(serializeLabels(undefined)).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(serializeLabels([])).toBeNull();
  });

  it("serializes labels to JSON string", () => {
    expect(serializeLabels(["bug", "urgent"])).toBe('["bug","urgent"]');
  });
});

describe("serializeMetadata", () => {
  it("returns null for undefined", () => {
    expect(serializeMetadata(undefined)).toBeNull();
  });

  it("serializes metadata to JSON string", () => {
    const meta = { key: "value", nested: { a: 1 } };
    expect(serializeMetadata(meta)).toBe(JSON.stringify(meta));
  });
});

describe("parseLabels", () => {
  it("returns empty array for null", () => {
    expect(parseLabels(null)).toEqual([]);
  });

  it("parses valid JSON array", () => {
    expect(parseLabels('["bug","urgent"]')).toEqual(["bug", "urgent"]);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseLabels("not-json")).toEqual([]);
  });
});

describe("parseMetadata", () => {
  it("returns empty object for null", () => {
    expect(parseMetadata(null)).toEqual({});
  });

  it("parses valid JSON object", () => {
    expect(parseMetadata('{"key":"value"}')).toEqual({ key: "value" });
  });

  it("returns empty object for invalid JSON", () => {
    expect(parseMetadata("{broken")).toEqual({});
  });
});
