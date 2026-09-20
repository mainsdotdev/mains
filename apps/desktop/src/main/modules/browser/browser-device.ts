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

type BrowserDeviceEmulationParameters = ReturnType<
  typeof browserDeviceEmulationParameters
>;

export interface BrowserDeviceEmulationContents {
  isDestroyed(): boolean;
  isLoading(): boolean;
  enableDeviceEmulation(parameters: BrowserDeviceEmulationParameters): void;
  disableDeviceEmulation(): void;
}

interface BrowserDevicePaintContents extends BrowserDeviceEmulationContents {
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
}

interface BrowserDeviceEmulationRequest {
  contents: BrowserDeviceEmulationContents;
  device: BrowserDeviceEmulation;
  bounds: BrowserBounds | null;
}

interface BrowserDeviceEmulationQueueOptions {
  delayMs?: number;
}

const WAIT_FOR_DEVICE_PAINT_SCRIPT = `new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
})`;

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

export function createBrowserDeviceEmulationQueue(
  options: BrowserDeviceEmulationQueueOptions = {},
) {
  const delayMs = Math.max(0, options.delayMs ?? 50);
  let ready = false;
  let timer: NodeJS.Timeout | null = null;
  let pending: BrowserDeviceEmulationRequest | null = null;
  let lastAppliedSignature: string | null = null;
  let navigationVersion = 0;

  const clearTimer = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  const flush = () => {
    timer = null;
    const request = pending;
    if (
      !ready ||
      !request ||
      request.contents.isDestroyed() ||
      request.contents.isLoading()
    ) {
      return;
    }

    const parameters = request.device.enabled
      ? browserDeviceEmulationParameters(request.device, request.bounds)
      : null;
    const signature = parameters ? JSON.stringify(parameters) : "disabled";
    pending = null;
    if (signature === lastAppliedSignature) return;

    if (parameters) {
      request.contents.enableDeviceEmulation(parameters);
    } else {
      request.contents.disableDeviceEmulation();
    }
    lastAppliedSignature = signature;
  };

  const schedulePending = () => {
    if (!ready || !pending) return;
    clearTimer();
    timer = setTimeout(flush, delayMs);
  };

  return {
    schedule(
      contents: BrowserDeviceEmulationContents,
      device: BrowserDeviceEmulation,
      bounds: BrowserBounds | null,
    ) {
      pending = {
        contents,
        device: { ...device },
        bounds: bounds && { ...bounds },
      };
      schedulePending();
    },

    beginNavigation() {
      navigationVersion += 1;
      ready = false;
      clearTimer();
    },

    async readyAfterPaint(contents: BrowserDevicePaintContents) {
      if (contents.isDestroyed() || contents.isLoading()) return false;
      const expectedNavigationVersion = navigationVersion;
      try {
        await contents.executeJavaScript(
          WAIT_FOR_DEVICE_PAINT_SCRIPT,
          true,
        );
      } catch {
        return false;
      }
      if (
        expectedNavigationVersion !== navigationVersion ||
        contents.isDestroyed() ||
        contents.isLoading()
      ) {
        return false;
      }
      ready = true;
      schedulePending();
      return true;
    },

    setReady(nextReady: boolean) {
      ready = nextReady;
      if (!ready) {
        clearTimer();
        return;
      }
      schedulePending();
    },

    cancel() {
      navigationVersion += 1;
      ready = false;
      clearTimer();
      pending = null;
    },

    reset() {
      navigationVersion += 1;
      clearTimer();
      pending = null;
      ready = false;
      lastAppliedSignature = null;
    },
  };
}

export type BrowserDeviceEmulationQueue = ReturnType<
  typeof createBrowserDeviceEmulationQueue
>;
