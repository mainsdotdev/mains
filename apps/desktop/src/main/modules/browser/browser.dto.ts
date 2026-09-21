// ─────────────────────────────────────────────────────────────
// Browser DTOs
// ─────────────────────────────────────────────────────────────

export type { ServiceResponse } from "@mains/contracts/service-response";

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BrowserDevicePresetId =
  | "responsive"
  | "iphone-se"
  | "iphone-14-pro"
  | "iphone-14-pro-max"
  | "pixel-7"
  | "galaxy-s20-ultra"
  | "surface-duo"
  | "ipad-mini"
  | "ipad-air"
  | "nest-hub";

export interface BrowserDeviceEmulation {
  enabled: boolean;
  presetId: BrowserDevicePresetId;
  width: number;
  height: number;
  deviceScaleFactor: number;
  scale: number;
}

export interface BrowserNavState {
  tabId: string;
  url: string;
  title: string;
  faviconUrl: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  zoomFactor: number;
  deviceEmulation: BrowserDeviceEmulation;
}

export interface BrowserTabSummary extends BrowserNavState {
  isCrashed: boolean;
}

export interface BrowserState {
  activeTabId: string;
  tabs: BrowserTabSummary[];
}

export interface BrowserFindResult {
  tabId: string;
  activeMatchOrdinal: number;
  matches: number;
  finalUpdate: boolean;
}

export type BrowserDownloadState =
  | "progressing"
  | "paused"
  | "completed"
  | "cancelled"
  | "interrupted";

export interface BrowserDownload {
  id: string;
  tabId: string | null;
  fileName: string;
  savePath: string;
  sourceUrl: string;
  mimeType: string;
  state: BrowserDownloadState;
  receivedBytes: number;
  totalBytes: number;
  speedBytesPerSecond: number;
  startedAt: string;
  updatedAt: string;
}

export interface BrowserHistoryEntry {
  id: string;
  url: string;
  title: string;
  faviconUrl: string | null;
  visitedAt: string;
  visitCount: number;
}

export type BrowserClearDataTimeRange =
  | "last-hour"
  | "last-day"
  | "last-week"
  | "last-four-weeks"
  | "all-time";

export interface BrowserClearDataOptions {
  timeRange: BrowserClearDataTimeRange;
  history: boolean;
  cookiesAndSiteData: boolean;
  cache: boolean;
  downloads: boolean;
}

export interface BrowserClearDataResult {
  history: BrowserHistoryEntry[];
  downloads: BrowserDownload[];
}

export type BrowserScreenshotMode = "viewport" | "fullPage";

export interface BrowserPrintResult {
  printed: boolean;
  failureReason?: string;
}

export interface BrowserSelectionPayload {
  id: string;
  type: "browser_selection";
  url: string;
  title: string;
  selector: string;
  tagName: string;
  text: string;
  styles: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
  pageRect: { x: number; y: number; width: number; height: number };
  scroll: { x: number; y: number };
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  componentName?: string;
  sourceFile?: string;
  timestamp: string;
}

export interface BrowserSelectionResult extends BrowserSelectionPayload {
  /** Absolute path of the element screenshot on disk. */
  screenshotPath?: string;
  /** Basename used to resolve the capture via the `mains-capture://` scheme in the renderer. */
  screenshotCaptureName?: string;
  screenshotMimeType: string;
}
