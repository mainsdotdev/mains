import { describe, expect, it } from "vitest";
import {
  browserDeviceEmulationParameters,
  DEFAULT_BROWSER_DEVICE_EMULATION,
  normalizeBrowserDeviceEmulation,
} from "./browser-device";

describe("browser device emulation", () => {
  it("falls back to a disabled responsive device", () => {
    expect(normalizeBrowserDeviceEmulation(null)).toEqual(
      DEFAULT_BROWSER_DEVICE_EMULATION,
    );
    expect(normalizeBrowserDeviceEmulation({ enabled: false })).toEqual(
      DEFAULT_BROWSER_DEVICE_EMULATION,
    );
  });

  it("normalizes persisted and untrusted device values", () => {
    expect(
      normalizeBrowserDeviceEmulation({
        enabled: true,
        presetId: "unknown",
        width: 80,
        height: 9_000,
        deviceScaleFactor: 8,
        scale: 9,
      }),
    ).toEqual({
      enabled: true,
      presetId: "responsive",
      width: 200,
      height: 2_560,
      deviceScaleFactor: 3,
      scale: 2,
    });
  });

  it("fits a tall emulated viewport inside the available browser surface", () => {
    const parameters = browserDeviceEmulationParameters(
      {
        enabled: true,
        presetId: "iphone-14-pro",
        width: 393,
        height: 852,
        deviceScaleFactor: 3,
        scale: 0.84,
      },
      { x: 0, y: 0, width: 786, height: 639 },
    );

    expect(parameters.viewSize).toEqual({ width: 393, height: 852 });
    expect(parameters.screenSize).toEqual({ width: 393, height: 852 });
    expect(parameters.deviceScaleFactor).toBe(3);
    expect(parameters.scale).toBeCloseTo(0.75, 2);
  });

  it("honors display scales above 100% when the browser surface has room", () => {
    const parameters = browserDeviceEmulationParameters(
      {
        enabled: true,
        presetId: "responsive",
        width: 393,
        height: 852,
        deviceScaleFactor: 2,
        scale: 1.25,
      },
      { x: 0, y: 0, width: 500, height: 1_100 },
    );

    expect(parameters.scale).toBe(1.25);
  });
});
