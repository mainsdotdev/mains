import { ipcMain } from "../../ipc-kit/ipc-main";
import { handle } from "../../ipc-kit/handle";
import { browserService } from "./browser.service";
import type {
  BrowserBounds,
  BrowserClearDataOptions,
  BrowserClearDataTimeRange,
  BrowserDeviceEmulation,
  BrowserDevicePresetId,
  BrowserScreenshotMode,
} from "./browser.dto";
import {
  BROWSER_DEVICE_DPR_MAX,
  BROWSER_DEVICE_DPR_MIN,
  BROWSER_DEVICE_HEIGHT_MAX,
  BROWSER_DEVICE_HEIGHT_MIN,
  BROWSER_DEVICE_SCALE_MAX,
  BROWSER_DEVICE_SCALE_MIN,
  BROWSER_DEVICE_WIDTH_MAX,
  BROWSER_DEVICE_WIDTH_MIN,
} from "./browser-device";
import { CHANNELS } from "../../../shared/ipc-kit/channels";

function requireBounds(input: unknown): BrowserBounds {
  if (!input || typeof input !== "object") throw new Error("Invalid bounds");
  const b = input as Record<string, unknown>;
  const nums = ["x", "y", "width", "height"].map((k) => b[k]);
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) {
    throw new Error("Invalid bounds");
  }
  return {
    x: b.x as number,
    y: b.y as number,
    width: b.width as number,
    height: b.height as number,
  };
}

function requireTabId(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("tabId must be a string");
  }
  return input;
}

function requireDownloadId(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("downloadId must be a string");
  }
  return input;
}

function requireHistoryEntryId(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("historyEntryId must be a string");
  }
  return input;
}

function requireZoomFactor(input: unknown): number {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    throw new Error("zoomFactor must be a number");
  }
  return input;
}

const CLEAR_DATA_TIME_RANGES = new Set<BrowserClearDataTimeRange>([
  "last-hour",
  "last-day",
  "last-week",
  "last-four-weeks",
  "all-time",
]);

function requireClearBrowsingData(input: unknown): BrowserClearDataOptions {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid browsing data settings");
  }
  const value = input as Record<string, unknown>;
  if (!CLEAR_DATA_TIME_RANGES.has(value.timeRange as BrowserClearDataTimeRange)) {
    throw new Error("Invalid browsing data time range");
  }
  const keys = ["history", "cookiesAndSiteData", "cache", "downloads"] as const;
  if (keys.some((key) => typeof value[key] !== "boolean")) {
    throw new Error("Browsing data selections must be boolean values");
  }
  if (!keys.some((key) => value[key] === true)) {
    throw new Error("Select at least one type of browsing data");
  }
  return {
    timeRange: value.timeRange as BrowserClearDataTimeRange,
    history: value.history as boolean,
    cookiesAndSiteData: value.cookiesAndSiteData as boolean,
    cache: value.cache as boolean,
    downloads: value.downloads as boolean,
  };
}

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

function requireDeviceEmulation(input: unknown): BrowserDeviceEmulation {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid device emulation settings");
  }
  const value = input as Record<string, unknown>;
  const width = value.width;
  const height = value.height;
  const deviceScaleFactor = value.deviceScaleFactor;
  const scale = value.scale;
  if (typeof value.enabled !== "boolean") {
    throw new Error("enabled must be a boolean");
  }
  if (!DEVICE_PRESET_IDS.has(value.presetId as BrowserDevicePresetId)) {
    throw new Error("Invalid device preset");
  }
  if (
    typeof width !== "number" ||
    !Number.isInteger(width) ||
    width < BROWSER_DEVICE_WIDTH_MIN ||
    width > BROWSER_DEVICE_WIDTH_MAX
  ) {
    throw new Error(
      `Device width must be between ${BROWSER_DEVICE_WIDTH_MIN} and ${BROWSER_DEVICE_WIDTH_MAX}`,
    );
  }
  if (
    typeof height !== "number" ||
    !Number.isInteger(height) ||
    height < BROWSER_DEVICE_HEIGHT_MIN ||
    height > BROWSER_DEVICE_HEIGHT_MAX
  ) {
    throw new Error(
      `Device height must be between ${BROWSER_DEVICE_HEIGHT_MIN} and ${BROWSER_DEVICE_HEIGHT_MAX}`,
    );
  }
  if (
    typeof deviceScaleFactor !== "number" ||
    !Number.isInteger(deviceScaleFactor) ||
    deviceScaleFactor < BROWSER_DEVICE_DPR_MIN ||
    deviceScaleFactor > BROWSER_DEVICE_DPR_MAX
  ) {
    throw new Error(
      `Device DPR must be between ${BROWSER_DEVICE_DPR_MIN} and ${BROWSER_DEVICE_DPR_MAX}`,
    );
  }
  if (
    typeof scale !== "number" ||
    !Number.isFinite(scale) ||
    scale < BROWSER_DEVICE_SCALE_MIN ||
    scale > BROWSER_DEVICE_SCALE_MAX
  ) {
    throw new Error(
      `Device scale must be between ${BROWSER_DEVICE_SCALE_MIN} and ${BROWSER_DEVICE_SCALE_MAX}`,
    );
  }
  return {
    enabled: value.enabled,
    presetId: value.presetId as BrowserDevicePresetId,
    width,
    height,
    deviceScaleFactor,
    scale,
  };
}

function requireScreenshotMode(input: unknown): BrowserScreenshotMode {
  if (input !== "viewport" && input !== "fullPage") {
    throw new Error("Invalid screenshot mode");
  }
  return input;
}

function requireFindInput(input: unknown): {
  query: string;
  forward?: boolean;
  findNext?: boolean;
} {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid find request");
  }
  const value = input as Record<string, unknown>;
  if (typeof value.query !== "string") {
    throw new Error("query must be a string");
  }
  return {
    query: value.query,
    forward:
      typeof value.forward === "boolean" ? value.forward : undefined,
    findNext:
      typeof value.findNext === "boolean" ? value.findNext : undefined,
  };
}

export function registerBrowserIpc(): void {
  ipcMain.handle(
    CHANNELS.browser.createTab,
    handle((url: unknown) => {
      if (url !== undefined && typeof url !== "string") {
        throw new Error("url must be a string");
      }
      return browserService.createTab(url as string | undefined);
    }),
  );
  ipcMain.handle(
    CHANNELS.browser.closeTab,
    handle((tabId: unknown) => browserService.closeTab(requireTabId(tabId))),
  );
  ipcMain.handle(
    CHANNELS.browser.activateTab,
    handle((tabId: unknown) =>
      browserService.activateTab(requireTabId(tabId)),
    ),
  );
  ipcMain.handle(
    CHANNELS.browser.attach,
    handle((payload: unknown) => browserService.attach(requireBounds(payload))),
  );
  ipcMain.handle(
    CHANNELS.browser.detach,
    handle(() => browserService.detach()),
  );
  ipcMain.handle(
    CHANNELS.browser.destroy,
    handle(() => browserService.destroy()),
  );
  ipcMain.handle(
    CHANNELS.browser.setBounds,
    handle((payload: unknown) =>
      browserService.setBounds(requireBounds(payload)),
    ),
  );
  ipcMain.handle(
    CHANNELS.browser.setVisible,
    handle((visible: unknown) => browserService.setVisible(Boolean(visible))),
  );
  ipcMain.handle(
    CHANNELS.browser.navigate,
    handle((url: unknown) => {
      if (typeof url !== "string") throw new Error("url must be a string");
      return browserService.navigate(url);
    }),
  );
  ipcMain.handle(
    CHANNELS.browser.back,
    handle(() => browserService.goBack()),
  );
  ipcMain.handle(
    CHANNELS.browser.forward,
    handle(() => browserService.goForward()),
  );
  ipcMain.handle(
    CHANNELS.browser.reload,
    handle(() => browserService.reload()),
  );
  ipcMain.handle(
    CHANNELS.browser.stop,
    handle(() => browserService.stop()),
  );
  ipcMain.handle(
    CHANNELS.browser.setSelectMode,
    handle((enabled: unknown) =>
      browserService.setSelectMode(Boolean(enabled)),
    ),
  );
  ipcMain.handle(
    CHANNELS.browser.getNavState,
    handle(() => browserService.getNavState()),
  );
  ipcMain.handle(
    CHANNELS.browser.getState,
    handle(() => browserService.getState()),
  );
  ipcMain.handle(
    CHANNELS.browser.getDownloads,
    handle(() => browserService.getDownloads()),
  );
  ipcMain.handle(
    CHANNELS.browser.getHistory,
    handle(() => browserService.getHistory()),
  );
  ipcMain.handle(
    CHANNELS.browser.removeHistoryEntry,
    handle((historyEntryId: unknown) =>
      browserService.removeHistoryEntry(
        requireHistoryEntryId(historyEntryId),
      ),
    ),
  );
  ipcMain.handle(
    CHANNELS.browser.clearBrowsingData,
    handle((input: unknown) =>
      browserService.clearBrowsingData(requireClearBrowsingData(input)),
    ),
  );
  ipcMain.handle(
    CHANNELS.browser.clearHistory,
    handle(() => browserService.clearHistory()),
  );
  ipcMain.handle(
    CHANNELS.browser.cancelDownload,
    handle((downloadId: unknown) =>
      browserService.cancelDownload(requireDownloadId(downloadId)),
    ),
  );
  ipcMain.handle(
    CHANNELS.browser.clearDownloads,
    handle(() => browserService.clearDownloads()),
  );
  ipcMain.handle(
    CHANNELS.browser.openDownload,
    handle((downloadId: unknown) =>
      browserService.openDownload(requireDownloadId(downloadId)),
    ),
  );
  ipcMain.handle(
    CHANNELS.browser.showDownloadInFolder,
    handle((downloadId: unknown) =>
      browserService.showDownloadInFolder(requireDownloadId(downloadId)),
    ),
  );
  ipcMain.handle(
    CHANNELS.browser.setZoomFactor,
    handle((factor: unknown) =>
      browserService.setZoomFactor(requireZoomFactor(factor)),
    ),
  );
  ipcMain.handle(
    CHANNELS.browser.setDeviceEmulation,
    handle((input: unknown) =>
      browserService.setDeviceEmulation(requireDeviceEmulation(input)),
    ),
  );
  ipcMain.handle(
    CHANNELS.browser.findInPage,
    handle((input: unknown) => {
      const { query, ...options } = requireFindInput(input);
      return browserService.findInPage(query, options);
    }),
  );
  ipcMain.handle(
    CHANNELS.browser.stopFindInPage,
    handle((action: unknown) => {
      if (
        action !== undefined &&
        action !== "clearSelection" &&
        action !== "keepSelection"
      ) {
        throw new Error("Invalid find stop action");
      }
      return browserService.stopFindInPage(
        action as "clearSelection" | "keepSelection" | undefined,
      );
    }),
  );
  ipcMain.handle(
    CHANNELS.browser.printPage,
    handle(() => browserService.printPage()),
  );
  ipcMain.handle(
    CHANNELS.browser.captureScreenshot,
    handle((mode: unknown) =>
      browserService.captureScreenshot(requireScreenshotMode(mode)),
    ),
  );
  ipcMain.handle(
    CHANNELS.browser.deleteCapture,
    handle((captureName: unknown) => {
      if (typeof captureName !== "string") {
        throw new Error("captureName must be a string");
      }
      return browserService.deleteCapture(captureName);
    }),
  );
}

export function unregisterBrowserIpc(): void {
  [
    CHANNELS.browser.createTab,
    CHANNELS.browser.closeTab,
    CHANNELS.browser.activateTab,
    CHANNELS.browser.attach,
    CHANNELS.browser.detach,
    CHANNELS.browser.destroy,
    CHANNELS.browser.setBounds,
    CHANNELS.browser.setVisible,
    CHANNELS.browser.navigate,
    CHANNELS.browser.back,
    CHANNELS.browser.forward,
    CHANNELS.browser.reload,
    CHANNELS.browser.stop,
    CHANNELS.browser.setSelectMode,
    CHANNELS.browser.getNavState,
    CHANNELS.browser.getState,
    CHANNELS.browser.getDownloads,
    CHANNELS.browser.getHistory,
    CHANNELS.browser.clearBrowsingData,
    CHANNELS.browser.removeHistoryEntry,
    CHANNELS.browser.clearHistory,
    CHANNELS.browser.cancelDownload,
    CHANNELS.browser.clearDownloads,
    CHANNELS.browser.openDownload,
    CHANNELS.browser.showDownloadInFolder,
    CHANNELS.browser.setZoomFactor,
    CHANNELS.browser.setDeviceEmulation,
    CHANNELS.browser.findInPage,
    CHANNELS.browser.stopFindInPage,
    CHANNELS.browser.printPage,
    CHANNELS.browser.captureScreenshot,
    CHANNELS.browser.deleteCapture,
  ].forEach((channel) => ipcMain.removeHandler(channel));
}
