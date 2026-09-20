import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserDeviceEmulationParameters,
  createBrowserDeviceEmulationQueue,
  DEFAULT_BROWSER_DEVICE_EMULATION,
  normalizeBrowserDeviceEmulation,
} from "./browser-device";

describe("browser device emulation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("waits for a stable page and coalesces repeated emulation requests", () => {
    const enable = vi.fn();
    const disable = vi.fn();
    const contents = {
      isDestroyed: () => false,
      isLoading: () => false,
      enableDeviceEmulation: enable,
      disableDeviceEmulation: disable,
    };
    const queue = createBrowserDeviceEmulationQueue({ delayMs: 10 });
    const device = {
      ...DEFAULT_BROWSER_DEVICE_EMULATION,
      enabled: true,
    };

    vi.useFakeTimers();
    queue.schedule(contents, device, { x: 0, y: 0, width: 393, height: 852 });
    queue.schedule(contents, device, { x: 0, y: 0, width: 430, height: 852 });
    vi.advanceTimersByTime(20);
    expect(enable).not.toHaveBeenCalled();

    queue.setReady(true);
    vi.advanceTimersByTime(20);
    expect(enable).toHaveBeenCalledTimes(1);
    expect(enable).toHaveBeenLastCalledWith(
      browserDeviceEmulationParameters(device, {
        x: 0,
        y: 0,
        width: 430,
        height: 852,
      }),
    );
    expect(disable).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("does not reapply unchanged emulation parameters", () => {
    const enable = vi.fn();
    const contents = {
      isDestroyed: () => false,
      isLoading: () => false,
      enableDeviceEmulation: enable,
      disableDeviceEmulation: vi.fn(),
    };
    const queue = createBrowserDeviceEmulationQueue({ delayMs: 10 });
    const device = {
      ...DEFAULT_BROWSER_DEVICE_EMULATION,
      enabled: true,
    };
    const bounds = { x: 0, y: 0, width: 393, height: 852 };

    vi.useFakeTimers();
    queue.setReady(true);
    queue.schedule(contents, device, bounds);
    vi.advanceTimersByTime(20);
    queue.schedule(contents, device, bounds);
    vi.advanceTimersByTime(20);

    expect(enable).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("keeps a request pending while Chromium is still loading", () => {
    let loading = true;
    const enable = vi.fn();
    const contents = {
      isDestroyed: () => false,
      isLoading: () => loading,
      enableDeviceEmulation: enable,
      disableDeviceEmulation: vi.fn(),
    };
    const queue = createBrowserDeviceEmulationQueue({ delayMs: 10 });

    vi.useFakeTimers();
    queue.setReady(true);
    queue.schedule(
      contents,
      { ...DEFAULT_BROWSER_DEVICE_EMULATION, enabled: true },
      { x: 0, y: 0, width: 393, height: 852 },
    );
    vi.advanceTimersByTime(20);
    expect(enable).not.toHaveBeenCalled();

    loading = false;
    queue.setReady(true);
    vi.advanceTimersByTime(20);
    expect(enable).toHaveBeenCalledTimes(1);
  });

  it("drops pending emulation work when its view is reset", () => {
    const enable = vi.fn();
    const contents = {
      isDestroyed: () => false,
      isLoading: () => false,
      enableDeviceEmulation: enable,
      disableDeviceEmulation: vi.fn(),
    };
    const queue = createBrowserDeviceEmulationQueue({ delayMs: 10 });

    vi.useFakeTimers();
    queue.setReady(true);
    queue.schedule(
      contents,
      { ...DEFAULT_BROWSER_DEVICE_EMULATION, enabled: true },
      { x: 0, y: 0, width: 393, height: 852 },
    );
    queue.reset();
    vi.advanceTimersByTime(20);

    expect(enable).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("waits for rendered frames before applying changes after navigation", async () => {
    let resolvePaint: (() => void) | undefined;
    const enable = vi.fn();
    const contents = {
      isDestroyed: () => false,
      isLoading: () => false,
      enableDeviceEmulation: enable,
      disableDeviceEmulation: vi.fn(),
      executeJavaScript: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolvePaint = resolve;
          }),
      ),
    };
    const queue = createBrowserDeviceEmulationQueue({ delayMs: 10 });

    vi.useFakeTimers();
    queue.beginNavigation();
    queue.schedule(
      contents,
      { ...DEFAULT_BROWSER_DEVICE_EMULATION, enabled: true },
      { x: 0, y: 0, width: 393, height: 852 },
    );
    const readiness = queue.readyAfterPaint(contents);
    vi.advanceTimersByTime(20);
    expect(enable).not.toHaveBeenCalled();

    resolvePaint?.();
    await readiness;
    vi.advanceTimersByTime(20);
    expect(enable).toHaveBeenCalledTimes(1);
  });

  it("does not reapply unchanged emulation after a reload", async () => {
    const enable = vi.fn();
    const contents = {
      isDestroyed: () => false,
      isLoading: () => false,
      enableDeviceEmulation: enable,
      disableDeviceEmulation: vi.fn(),
      executeJavaScript: vi.fn(async () => true),
    };
    const queue = createBrowserDeviceEmulationQueue({ delayMs: 10 });
    const device = {
      ...DEFAULT_BROWSER_DEVICE_EMULATION,
      enabled: true,
    };
    const bounds = { x: 0, y: 0, width: 393, height: 852 };

    vi.useFakeTimers();
    queue.setReady(true);
    queue.schedule(contents, device, bounds);
    vi.advanceTimersByTime(20);
    expect(enable).toHaveBeenCalledTimes(1);

    queue.beginNavigation();
    await queue.readyAfterPaint(contents);
    vi.advanceTimersByTime(20);
    expect(enable).toHaveBeenCalledTimes(1);
  });
});
