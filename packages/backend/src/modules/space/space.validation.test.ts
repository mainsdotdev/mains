import { describe, it, expect } from "vitest";
import { sanitizeString, generateSlug, sanitizeSpacePayload } from "./space.validation";

describe("sanitizeString", () => {
  it("returns undefined for non-string", () => {
    expect(sanitizeString(123, 50)).toBeUndefined();
    expect(sanitizeString(null, 50)).toBeUndefined();
  });

  it("trims and truncates", () => {
    expect(sanitizeString("  hello  ", 3)).toBe("hel");
  });

  it("returns trimmed string within limit", () => {
    expect(sanitizeString("  hello  ", 50)).toBe("hello");
  });
});

describe("generateSlug", () => {
  it("converts to lowercase kebab-case", () => {
    expect(generateSlug("My Cool Space")).toBe("my-cool-space");
  });

  it("strips special characters", () => {
    expect(generateSlug("Hello!@#World")).toBe("hello-world");
  });

  it("removes leading/trailing hyphens", () => {
    expect(generateSlug("--test--")).toBe("test");
  });
});

describe("sanitizeSpacePayload", () => {
  it("rejects non-object payload", () => {
    const result = sanitizeSpacePayload(null);
    expect(result.errors.body).toBe("Invalid payload");
  });

  it("does not require name when omitted (partial update)", () => {
    const result = sanitizeSpacePayload({});
    expect(result.errors.name).toBeUndefined();
    expect(result.data).toEqual({});
  });

  it("rejects empty name when name is provided", () => {
    const result = sanitizeSpacePayload({ name: "   " });
    expect(result.errors.name).toBe("Name is required");
  });

  it("accepts valid payload", () => {
    const result = sanitizeSpacePayload({
      name: "My Space",
      description: "A cool space",
    });
    expect(result.data.name).toBe("My Space");
    expect(result.data.description).toBe("A cool space");
    expect(result.errors).toEqual({});
  });

  it("rejects invalid themeConfig JSON", () => {
    const result = sanitizeSpacePayload({
      name: "Test",
      themeConfig: "{invalid json",
    });
    expect(result.errors.themeConfig).toBe("Invalid JSON format");
  });

  it("accepts valid themeConfig JSON", () => {
    const result = sanitizeSpacePayload({
      name: "Test",
      themeConfig: '{"primary":"#fff"}',
    });
    expect(result.data.themeConfig).toBe('{"primary":"#fff"}');
  });

  it("accepts partial payload with only themeConfig", () => {
    const json = '{"lightBackground":"#f6eae7","darkBackground":"#54241ce6"}';
    const result = sanitizeSpacePayload({ themeConfig: json });
    expect(result.errors).toEqual({});
    expect(result.data.themeConfig).toBe(json);
  });

  it("accepts sortOrder as number", () => {
    const result = sanitizeSpacePayload({ name: "Test", sortOrder: 5 });
    expect(result.data.sortOrder).toBe(5);
  });

  it("truncates name to 100 chars", () => {
    const longName = "A".repeat(150);
    const result = sanitizeSpacePayload({ name: longName });
    expect(result.data.name!.length).toBe(100);
  });
});
