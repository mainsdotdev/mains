import { describe, expect, it } from "vitest";
import {
  findWindowSource,
  parseFrontmostWindow,
  sourceWindowId,
} from "./appshots.capture";

describe("Appshots window matching", () => {
  it("parses the bounded JXA result", () => {
    expect(
      parseFrontmostWindow(
        JSON.stringify({
          appName: "Safari",
          bundleIdentifier: "com.apple.Safari",
          processId: 42,
          windowId: 99,
          windowTitle: "Docs",
        }),
      ),
    ).toEqual({
      appName: "Safari",
      bundleIdentifier: "com.apple.Safari",
      processId: 42,
      windowId: 99,
      windowTitle: "Docs",
    });
  });

  it("rejects missing window identity", () => {
    expect(() => parseFrontmostWindow('{"appName":"Finder"}')).toThrow(
      "capturable window",
    );
  });

  it("reads the CoreGraphics id from Electron window sources", () => {
    expect(sourceWindowId("window:3063:0")).toBe(3063);
    expect(sourceWindowId("screen:0:0")).toBeNull();
  });

  it("requires the exact CoreGraphics window id", () => {
    const sources = [
      { id: "window:1:0", name: "Docs" },
      { id: "window:2:0", name: "Other" },
    ];
    expect(findWindowSource(sources, { windowId: 2 }))
      .toBe(sources[1]);
    expect(findWindowSource(sources, { windowId: 3 }))
      .toBeNull();
  });
});
