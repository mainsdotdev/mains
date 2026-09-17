import { describe, expect, it } from "vitest";
import {
  browserDeviceFrame,
  resizedBrowserDeviceDimensions,
} from "./browser-device-frame";

describe("browserDeviceFrame", () => {
  it("centers a scaled device inside the browser stage", () => {
    expect(browserDeviceFrame(1_000, 1_000, 393, 852, 0.84)).toEqual({
      left: 335,
      top: 142,
      width: 330,
      height: 716,
      effectiveScale: 0.84,
    });
  });

  it("fits the device while preserving centered gutters", () => {
    const frame = browserDeviceFrame(500, 600, 393, 852, 1);
    expect(frame.left).toBeGreaterThanOrEqual(18);
    expect(frame.top).toBeGreaterThanOrEqual(22);
    expect(frame.width).toBeLessThanOrEqual(464);
    expect(frame.height).toBeLessThanOrEqual(556);
  });

  it("resizes from the left, right, and bottom in logical pixels", () => {
    const start = { width: 393, height: 852 };
    expect(
      resizedBrowserDeviceDimensions("left", start, { x: 84, y: 0 }, 0.84),
    ).toEqual({ width: 293, height: 852 });
    expect(
      resizedBrowserDeviceDimensions("right", start, { x: 84, y: 0 }, 0.84),
    ).toEqual({ width: 493, height: 852 });
    expect(
      resizedBrowserDeviceDimensions("bottom", start, { x: 0, y: 84 }, 0.84),
    ).toEqual({ width: 393, height: 952 });
  });
});
