import { describe, expect, it } from "vitest";
import {
  normalizedAppshotShortcut,
  requireAppshotsConfiguration,
  requireCaptureName,
} from "./appshots.validation";

describe("Appshots validation", () => {
  it("accepts the settings UI shortcut choices", () => {
    expect(
      requireAppshotsConfiguration({
        enabled: true,
        shortcut: "Command+Shift+Space",
      }),
    ).toEqual({ enabled: true, shortcut: "Command+Shift+Space" });
  });

  it("rejects arbitrary accelerators", () => {
    expect(() =>
      requireAppshotsConfiguration({ enabled: true, shortcut: "F1" }),
    ).toThrow("Unsupported");
  });

  it("falls back when persisted data predates the current choices", () => {
    expect(normalizedAppshotShortcut("invalid")).toBe("Command+Shift+Space");
  });

  it("only permits Appshots-owned capture basenames", () => {
    expect(requireCaptureName("appshot-deadbeef-123.png")).toBe(
      "appshot-deadbeef-123.png",
    );
    expect(() => requireCaptureName("../browser.png")).toThrow("Invalid");
  });
});
