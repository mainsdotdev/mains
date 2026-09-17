import type {
  BrowserBounds,
  BrowserDeviceEmulation,
  BrowserDevicePresetId,
} from "./browser.dto";

export const BROWSER_DEVICE_WIDTH_MIN = 200;
export const BROWSER_DEVICE_WIDTH_MAX = 2_560;
export const BROWSER_DEVICE_HEIGHT_MIN = 300;
export const BROWSER_DEVICE_HEIGHT_MAX = 2_560;
export const BROWSER_DEVICE_DPR_MIN = 1;
export const BROWSER_DEVICE_DPR_MAX = 3;
export const BROWSER_DEVICE_SCALE_MIN = 0.5;
export const BROWSER_DEVICE_SCALE_MAX = 2;

const DEVICE_PRESET_IDS = new Set<BrowserDevicePresetId>([
  "responsive",
  "iphone-se",
  "iphone-14-pro",
  "iphone-14-pro-max",
  "pixel-7",
  "galaxy-s20-ultra",
  "surface-duo",
  "ipad-mini",
  "ipad-air",
  "nest-hub",
]);

export const DEFAULT_BROWSER_DEVICE_EMULATION: BrowserDeviceEmulation = {
  enabled: false,
  presetId: "responsive",
  width: 393,
  height: 852,
  deviceScaleFactor: 2,
  scale: 0.84,
};

function clampInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

function clampNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

export function normalizeBrowserDeviceEmulation(
  value: unknown,
): BrowserDeviceEmulation {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_BROWSER_DEVICE_EMULATION };
  }

  const input = value as Partial<BrowserDeviceEmulation>;
  return {
    enabled: input.enabled === true,
    presetId: DEVICE_PRESET_IDS.has(input.presetId as BrowserDevicePresetId)
      ? (input.presetId as BrowserDevicePresetId)
      : DEFAULT_BROWSER_DEVICE_EMULATION.presetId,
    width: clampInteger(
      input.width,
      BROWSER_DEVICE_WIDTH_MIN,
      BROWSER_DEVICE_WIDTH_MAX,
      DEFAULT_BROWSER_DEVICE_EMULATION.width,
    ),
    height: clampInteger(
      input.height,
      BROWSER_DEVICE_HEIGHT_MIN,
      BROWSER_DEVICE_HEIGHT_MAX,
      DEFAULT_BROWSER_DEVICE_EMULATION.height,
    ),
    deviceScaleFactor: clampInteger(
      input.deviceScaleFactor,
      BROWSER_DEVICE_DPR_MIN,
      BROWSER_DEVICE_DPR_MAX,
      DEFAULT_BROWSER_DEVICE_EMULATION.deviceScaleFactor,
    ),
    scale: clampNumber(
      input.scale,
      BROWSER_DEVICE_SCALE_MIN,
      BROWSER_DEVICE_SCALE_MAX,
      DEFAULT_BROWSER_DEVICE_EMULATION.scale,
    ),
  };
}

export function browserDeviceEmulationParameters(
  device: BrowserDeviceEmulation,
  bounds: BrowserBounds | null,
) {
  const availableWidth = Math.max(1, bounds?.width ?? device.width);
  const availableHeight = Math.max(1, bounds?.height ?? device.height);
  const scale = Math.max(
    0.1,
    Math.min(
      device.scale,
      availableWidth / device.width,
      availableHeight / device.height,
    ),
  );

  return {
    screenPosition: "mobile" as const,
    screenSize: { width: device.width, height: device.height },
    viewPosition: { x: 0, y: 0 },
    deviceScaleFactor: device.deviceScaleFactor,
    viewSize: { width: device.width, height: device.height },
    scale,
  };
}
