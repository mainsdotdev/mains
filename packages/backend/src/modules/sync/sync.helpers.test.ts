import { describe, it, expect } from "vitest";
import { pickUrl, isValidUrl, sanitizeUrl, formatDuration } from "./sync.helpers";

describe("pickUrl", () => {
  it("returns null for null/undefined", () => {
    expect(pickUrl(null)).toBeNull();
    expect(pickUrl(undefined)).toBeNull();
  });

  it("returns string directly", () => {
    expect(pickUrl("https://example.com")).toBe("https://example.com");
  });

  it("returns null for empty string", () => {
    expect(pickUrl("")).toBeNull();
  });

  it("picks first element from array", () => {
    expect(pickUrl(["https://a.com", "https://b.com"])).toBe("https://a.com");
  });

  it("returns null for empty array", () => {
    expect(pickUrl([])).toBeNull();
  });

  it("extracts url from object.url", () => {
    expect(pickUrl({ url: "https://example.com" })).toBe("https://example.com");
  });

  it("extracts url from object.href", () => {
    expect(pickUrl({ href: "https://example.com" })).toBe("https://example.com");
  });

  it("extracts url from object._", () => {
    expect(pickUrl({ _: "https://example.com" })).toBe("https://example.com");
  });

  it("extracts url from object.__cdata", () => {
    expect(pickUrl({ __cdata: "https://example.com" })).toBe("https://example.com");
  });

  it("extracts url from object.$.url", () => {
    expect(pickUrl({ $: { url: "https://example.com" } })).toBe("https://example.com");
  });

  it("returns null for object with no url fields", () => {
    expect(pickUrl({ name: "test" })).toBeNull();
  });
});

describe("isValidUrl", () => {
  it("accepts http URL", () => {
    expect(isValidUrl("http://example.com")).toBe(true);
  });

  it("accepts https URL", () => {
    expect(isValidUrl("https://example.com/path")).toBe(true);
  });

  it("rejects ftp", () => {
    expect(isValidUrl("ftp://example.com")).toBe(false);
  });

  it("rejects invalid URL", () => {
    expect(isValidUrl("not a url")).toBe(false);
  });

  it("rejects javascript protocol", () => {
    expect(isValidUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("sanitizeUrl", () => {
  it("returns valid URL as-is", () => {
    expect(sanitizeUrl("https://example.com")).toBe("https://example.com");
  });

  it("returns fallback for null", () => {
    expect(sanitizeUrl(null)).toBe("#");
  });

  it("returns fallback for undefined", () => {
    expect(sanitizeUrl(undefined)).toBe("#");
  });

  it("returns fallback for invalid URL", () => {
    expect(sanitizeUrl("not-a-url")).toBe("#");
  });

  it("uses custom fallback", () => {
    expect(sanitizeUrl(null, "/home")).toBe("/home");
  });
});

describe("formatDuration", () => {
  it("formats milliseconds", () => {
    expect(formatDuration(500)).toBe("500ms");
  });

  it("formats seconds", () => {
    expect(formatDuration(1500)).toBe("1.50s");
  });

  it("formats minutes", () => {
    expect(formatDuration(90000)).toBe("1.50m");
  });

  it("formats exactly 1 second", () => {
    expect(formatDuration(1000)).toBe("1.00s");
  });

  it("formats sub-millisecond as 0ms", () => {
    expect(formatDuration(0)).toBe("0ms");
  });
});
