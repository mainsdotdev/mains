// ─────────────────────────────────────────────────────────────
// Browser DTOs
// ─────────────────────────────────────────────────────────────

export type { ServiceResponse } from "../../../shared/ipc-kit/service-response";

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserNavState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
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
  /** Absolute path of the surrounding-context screenshot on disk. */
  surroundingScreenshotPath?: string;
  /** Basename used to resolve the surrounding capture via the `mains-capture://` scheme. */
  surroundingScreenshotCaptureName?: string;
  screenshotMimeType: string;
}
