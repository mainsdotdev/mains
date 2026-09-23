import { describe, it, expect } from "vitest";
import { parsePairDeviceInput } from "./backend.validation";

describe("parsePairDeviceInput", () => {
  it("accepts a well-formed body", () => {
    expect(
      parsePairDeviceInput({
        code: "abc",
        deviceName: "  Okan's iPhone ",
        platform: "ios",
        appVersion: "0.1.0",
      }),
    ).toEqual({
      code: "abc",
      deviceName: "Okan's iPhone",
      platform: "ios",
      appVersion: "0.1.0",
    });
  });

  it("defaults the platform and leaves the version optional", () => {
    expect(parsePairDeviceInput({ code: "abc", deviceName: "Phone" })).toEqual({
      code: "abc",
      deviceName: "Phone",
      platform: "unknown",
      appVersion: undefined,
    });
  });

  it("caps oversized strings instead of storing them whole", () => {
    const parsed = parsePairDeviceInput({
      code: "abc",
      deviceName: "x".repeat(500),
      appVersion: "y".repeat(500),
    });
    expect(parsed.deviceName).toHaveLength(80);
    expect(parsed.appVersion).toHaveLength(40);
  });

  it.each([
    [null, /must be an object/],
    [[], /must be an object/],
    [{ deviceName: "Phone" }, /Pairing code is required/],
    [{ code: "", deviceName: "Phone" }, /Pairing code is required/],
    [{ code: "abc" }, /Device name is required/],
    [{ code: "abc", deviceName: "   " }, /Device name is required/],
    [{ code: "abc", deviceName: "Phone", platform: "tv" }, /Unsupported device platform/],
    [{ code: "abc", deviceName: "Phone", appVersion: 1 }, /App version must be a string/],
  ])("rejects %j", (input, message) => {
    expect(() => parsePairDeviceInput(input)).toThrow(message);
  });
});
