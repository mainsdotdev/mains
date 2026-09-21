import { describe, it, expect } from "vitest";
import { validateUpdatePayload } from "./account.validation";

describe("validateUpdatePayload", () => {
  it("rejects non-object payloads", () => {
    const result = validateUpdatePayload(null);
    expect(result.errors.body).toBe("Invalid payload");
    expect(result.data).toEqual({});
  });

  it("rejects string payload", () => {
    const result = validateUpdatePayload("hello");
    expect(result.errors.body).toBe("Invalid payload");
  });

  it("sanitizes and accepts valid fields", () => {
    const result = validateUpdatePayload({
      displayName: "  Okan Balcı  ",
      bio: "Developer",
    });
    expect(result.data.displayName).toBe("Okan Balcı");
    expect(result.data.bio).toBe("Developer");
    expect(result.errors).toEqual({});
  });

  it("rejects invalid email", () => {
    const result = validateUpdatePayload({ email: "not-an-email" });
    expect(result.errors.email).toBe("Invalid email");
    expect(result.data.email).toBeUndefined();
  });

  it("accepts valid email", () => {
    const result = validateUpdatePayload({ email: "test@example.com" });
    expect(result.data.email).toBe("test@example.com");
    expect(result.errors).toEqual({});
  });

  it("accepts empty email (allows clearing)", () => {
    const result = validateUpdatePayload({ email: "" });
    expect(result.data.email).toBe("");
    expect(result.errors).toEqual({});
  });

  it("ignores non-string values", () => {
    const result = validateUpdatePayload({ displayName: 123, bio: true });
    expect(result.data).toEqual({});
  });

  it("strips unknown fields", () => {
    const result = validateUpdatePayload({
      displayName: "Test",
      unknownField: "should be ignored",
    });
    expect(result.data).toEqual({ displayName: "Test" });
    expect((result.data as any).unknownField).toBeUndefined();
  });

  it("truncates strings exceeding max length", () => {
    const longName = "A".repeat(200);
    const result = validateUpdatePayload({ displayName: longName });
    expect(result.data.displayName!.length).toBe(120); // FIELD_LIMITS.displayName
  });
});
