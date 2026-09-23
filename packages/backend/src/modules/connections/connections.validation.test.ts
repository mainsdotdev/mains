import { describe, it, expect } from "vitest";
import {
  validateConnectionStateId,
  validateUpdateStatePayload,
} from "./connections.validation";

describe("validateConnectionStateId", () => {
  it("returns null for a valid string", () => {
    expect(validateConnectionStateId("github")).toBeNull();
  });

  it("returns error for empty string", () => {
    expect(validateConnectionStateId("")).toBe("Invalid connection ID");
  });

  it("returns error for null", () => {
    expect(validateConnectionStateId(null)).toBe("Invalid connection ID");
  });

  it("returns error for undefined", () => {
    expect(validateConnectionStateId(undefined)).toBe("Invalid connection ID");
  });

  it("returns error for number", () => {
    expect(validateConnectionStateId(42)).toBe("Invalid connection ID");
  });
});

describe("validateUpdateStatePayload", () => {
  it("accepts valid payload with isConnected true", () => {
    const result = validateUpdateStatePayload({ isConnected: true });
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ isConnected: true, connectionId: null });
  });

  it("accepts payload with connectionId", () => {
    const result = validateUpdateStatePayload({
      isConnected: true,
      connectionId: "conn-1",
    });
    expect(result.data).toEqual({ isConnected: true, connectionId: "conn-1" });
  });

  it("sets connectionId to null when non-string", () => {
    const result = validateUpdateStatePayload({
      isConnected: false,
      connectionId: 42,
    });
    expect(result.data!.connectionId).toBeNull();
  });

  it("rejects null payload", () => {
    const result = validateUpdateStatePayload(null);
    expect(result.error).toBe("Invalid payload");
  });

  it("rejects non-object payload", () => {
    const result = validateUpdateStatePayload("string");
    expect(result.error).toBe("Invalid payload");
  });

  it("rejects missing isConnected", () => {
    const result = validateUpdateStatePayload({});
    expect(result.error).toBe("isConnected must be a boolean");
  });

  it("rejects non-boolean isConnected", () => {
    const result = validateUpdateStatePayload({ isConnected: "yes" });
    expect(result.error).toBe("isConnected must be a boolean");
  });
});
