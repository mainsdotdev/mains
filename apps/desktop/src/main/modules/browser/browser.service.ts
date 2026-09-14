import {
  app,
  BrowserWindow,
  shell,
  WebContentsView,
  type Rectangle,
} from "electron";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import {
  buildInspectorScript,
  INSPECTOR_SENTINEL,
} from "./inspector.script";
import type {
  BrowserBounds,
  BrowserNavState,
  BrowserSelectionPayload,
  BrowserSelectionResult,
} from "./browser.dto";

// ─────────────────────────────────────────────────────────────
// Allowed protocols (anything else is opened in the system browser)
// ─────────────────────────────────────────────────────────────
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "about:"]);
const BLANK_URL = "about:blank";
const SURROUND_PADDING = 80;
/** Match panel `rounded-*-xl` (~12px) so WebContentsView fills bounds without square overflow. */
const VIEW_BORDER_RADIUS_PX = 0;
/** Max bytes kept in the browser-captures cache directory before LRU eviction kicks in. */
const CAPTURE_CACHE_MAX_BYTES = 100 * 1024 * 1024;
/** Idle time before the hidden WebContentsView is parked at about:blank to free page memory. */
const IDLE_PARK_MS = 2 * 60 * 1000;

function normalizeUrl(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return BLANK_URL;
  if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(trimmed)) return trimmed;
  if (/^about:/i.test(trimmed)) return trimmed;
  // localhost (with optional port/path)
  if (/^localhost(:\d+)?(\/.*)?$/i.test(trimmed)) return "http://" + trimmed;
  // bare IPv4 address
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(trimmed)) return "http://" + trimmed;
  // domain with a dot (e.g. example.com)
  if (/^[^\s.]+\.[^\s]+/.test(trimmed)) return "https://" + trimmed;
  return trimmed;
}

function ensureAllowed(url: string): string {
  try {
    const u = new URL(url);
    if (!ALLOWED_PROTOCOLS.has(u.protocol)) return BLANK_URL;
    return url;
  } catch {
    return BLANK_URL;
  }
}

function cacheDir(): string {
  const dir = path.join(app.getPath("userData"), "browser-captures");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
  return dir;
}

/** Best-effort LRU: when captures dir exceeds the byte budget, delete oldest-first. */
function pruneCaptureCache() {
  try {
    const dir = cacheDir();
    const entries = fs
      .readdirSync(dir)
      .map((name) => {
        const full = path.join(dir, name);
        try {
          const st = fs.statSync(full);
          if (!st.isFile()) return null;
          return { full, mtime: st.mtimeMs, size: st.size };
        } catch {
          return null;
        }
      })
      .filter((e): e is { full: string; mtime: number; size: number } => e !== null);

    let total = entries.reduce((sum, e) => sum + e.size, 0);
    if (total <= CAPTURE_CACHE_MAX_BYTES) return;

    entries.sort((a, b) => a.mtime - b.mtime);
    for (const e of entries) {
      if (total <= CAPTURE_CACHE_MAX_BYTES) break;
      try {
        fs.unlinkSync(e.full);
        total -= e.size;
      } catch {
        // ignore unlink failures
      }
    }
  } catch {
    // ignore prune failures — best-effort only
  }
}

function safeUnlink(filePath: string) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}


function captureBasename(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;
  return path.basename(filePath);
}

// ─────────────────────────────────────────────────────────────
// Browser Service — singleton WebContentsView owned by main
// ─────────────────────────────────────────────────────────────
export const browserService = {
  view: null as WebContentsView | null,
  host: null as BrowserWindow | null,
  bounds: null as BrowserBounds | null,
  visible: false,
  selectMode: false,
  idleParkTimer: null as NodeJS.Timeout | null,

  _findHost(): BrowserWindow | null {
    return (
      BrowserWindow.getFocusedWindow() ||
      BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ||
      null
    );
  },

  _ensureView(): WebContentsView {
    if (this.view && !this.view.webContents.isDestroyed()) return this.view;

    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools: !app.isPackaged,
        webSecurity: true,
        javascript: true,
      },
    });

    const wc = view.webContents;

    wc.setWindowOpenHandler(({ url }) => {
      const safe = ensureAllowed(normalizeUrl(url));
      if (safe !== BLANK_URL) shell.openExternal(safe).catch(() => {});
      return { action: "deny" };
    });

    wc.on("will-navigate", (event, url) => {
      try {
        const parsed = new URL(url);
        if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) event.preventDefault();
      } catch {
        event.preventDefault();
      }
    });

    const emitNav = () => this._emitNav();
    wc.on("did-finish-load", emitNav);
    wc.on("did-navigate", emitNav);
    wc.on("did-navigate-in-page", emitNav);
    wc.on("page-title-updated", emitNav);
    wc.on("did-start-loading", emitNav);
    wc.on("did-stop-loading", emitNav);

    wc.on("console-message", (event) => {
      const message = event.message;
      if (!message.startsWith(INSPECTOR_SENTINEL)) return;
      const raw = message.slice(INSPECTOR_SENTINEL.length);
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.cancel) {
          this.selectMode = false;
          this._sendToRenderer("browser:selectModeChanged", { enabled: false });
          return;
        }
        this._handleSelection(parsed as Omit<BrowserSelectionPayload, "id">);
      } catch (err) {
        console.warn("[browser] failed to parse selection payload:", err);
      }
    });

    try {
      view.setBorderRadius(VIEW_BORDER_RADIUS_PX);
    } catch {
      // setBorderRadius may be unavailable on some platforms / older runtimes
    }

    this.view = view;
    return view;
  },

  _sendToRenderer(channel: string, payload: unknown) {
    const host = this.host;
    if (host && !host.isDestroyed()) {
      host.webContents.send(channel, payload);
    }
  },

  async _emitNav() {
    const view = this.view;
    if (!view || view.webContents.isDestroyed()) return;
    const wc = view.webContents;
    const state: BrowserNavState = {
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: wc.navigationHistory?.canGoBack?.() ?? (wc as any).canGoBack?.() ?? false,
      canGoForward:
        wc.navigationHistory?.canGoForward?.() ?? (wc as any).canGoForward?.() ?? false,
      isLoading: wc.isLoading(),
    };
    this._sendToRenderer("browser:navState", state);
  },

  async _handleSelection(payload: Omit<BrowserSelectionPayload, "id">) {
    const id = randomUUID();
    const view = this.view;
    if (!view || view.webContents.isDestroyed()) return;

    const elementRect = this._clampRect(payload.rect, payload.viewport);
    const surroundingRect = this._clampRect(
      {
        x: payload.rect.x - SURROUND_PADDING,
        y: payload.rect.y - SURROUND_PADDING,
        width: payload.rect.width + SURROUND_PADDING * 2,
        height: payload.rect.height + SURROUND_PADDING * 2,
      },
      payload.viewport,
    );

    const element = await this._capture(elementRect, `element-${id}`);
    const surrounding = await this._capture(surroundingRect, `surround-${id}`);

    // LRU prune after writing new captures so the dir never drifts unbounded.
    pruneCaptureCache();

    const result: BrowserSelectionResult = {
      id,
      type: "browser_selection",
      url: payload.url,
      title: payload.title,
      selector: payload.selector,
      tagName: payload.tagName,
      text: payload.text,
      styles: payload.styles,
      rect: payload.rect,
      pageRect: payload.pageRect,
      scroll: payload.scroll,
      viewport: payload.viewport,
      devicePixelRatio: payload.devicePixelRatio,
      componentName: payload.componentName,
      sourceFile: payload.sourceFile,
      timestamp: payload.timestamp,
      screenshotPath: element?.filePath,
      screenshotCaptureName: captureBasename(element?.filePath),
      surroundingScreenshotPath: surrounding?.filePath,
      surroundingScreenshotCaptureName: captureBasename(surrounding?.filePath),
      screenshotMimeType: "image/png",
    };

    this.selectMode = false;
    this._sendToRenderer("browser:selectModeChanged", { enabled: false });
    this._sendToRenderer("browser:selection", result);
  },

  _clampRect(
    rect: { x: number; y: number; width: number; height: number },
    viewport: { width: number; height: number },
  ): Rectangle {
    const vx = Math.max(0, Math.min(viewport.width, Math.floor(rect.x)));
    const vy = Math.max(0, Math.min(viewport.height, Math.floor(rect.y)));
    const vmaxX = Math.max(
      vx + 1,
      Math.min(viewport.width, Math.floor(rect.x + rect.width)),
    );
    const vmaxY = Math.max(
      vy + 1,
      Math.min(viewport.height, Math.floor(rect.y + rect.height)),
    );
    const w = Math.max(1, vmaxX - vx);
    const h = Math.max(1, vmaxY - vy);
    return { x: vx, y: vy, width: w, height: h };
  },

  async _capture(
    rect: Rectangle,
    prefix: string,
  ): Promise<{ filePath: string } | undefined> {
    const view = this.view;
    if (!view || view.webContents.isDestroyed()) return undefined;
    try {
      const img = await view.webContents.capturePage(rect);
      if (img.isEmpty()) return undefined;
      const buffer = img.toPNG();
      const filePath = path.join(cacheDir(), `${prefix}-${Date.now()}.png`);
      fs.writeFileSync(filePath, buffer);
      return { filePath };
    } catch (err) {
      console.warn("[browser] capturePage failed:", err);
      return undefined;
    }
  },

  // ─────────────── Public API ───────────────

  _clearIdleParkTimer() {
    if (this.idleParkTimer) {
      clearTimeout(this.idleParkTimer);
      this.idleParkTimer = null;
    }
  },

  _scheduleIdlePark() {
    this._clearIdleParkTimer();
    this.idleParkTimer = setTimeout(() => {
      this.idleParkTimer = null;
      const wc = this.view?.webContents;
      if (!wc || wc.isDestroyed()) return;
      // Don't park if the panel has become visible again during the timer.
      if (this.visible) return;
      try {
        if (wc.getURL() !== BLANK_URL) {
          wc.loadURL(BLANK_URL).catch(() => {});
        }
      } catch {
        // ignore
      }
    }, IDLE_PARK_MS);
  },

  async attach(bounds: BrowserBounds): Promise<BrowserNavState> {
    const host = this._findHost();
    if (!host) throw new Error("No active window");

    const view = this._ensureView();
    this.host = host;

    if (!host.contentView.children.includes(view)) {
      host.contentView.addChildView(view);
    }
    this.setBounds(bounds);
    this.visible = true;
    this._clearIdleParkTimer();

    const wc = view.webContents;
    const current = wc.getURL();
    if (!current || current === "" || current === "about:blank") {
      // leave blank — renderer controls navigation
    }

    const state: BrowserNavState = {
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: wc.navigationHistory?.canGoBack?.() ?? false,
      canGoForward: wc.navigationHistory?.canGoForward?.() ?? false,
      isLoading: wc.isLoading(),
    };
    return state;
  },

  detach(): null {
    const view = this.view;
    const host = this.host;
    if (view && host && !host.isDestroyed()) {
      try {
        host.contentView.removeChildView(view);
      } catch {
        // ignore
      }
    }
    this.visible = false;
    if (this.selectMode) this.setSelectMode(false);
    this._scheduleIdlePark();
    return null;
  },

  destroy(): null {
    this._clearIdleParkTimer();
    this.detach();
    if (this.view && !this.view.webContents.isDestroyed()) {
      try {
        this.view.webContents.close();
      } catch {
        // ignore
      }
    }
    this.view = null;
    this.host = null;
    this.bounds = null;
    this.selectMode = false;
    return null;
  },

  deleteCapture(captureName: string): null {
    if (!captureName || typeof captureName !== "string") {
      throw new Error("captureName required");
    }
    if (captureName.includes("/") || captureName.includes("\\") || captureName.includes("..")) {
      throw new Error("Invalid capture name");
    }
    const base = cacheDir();
    const target = path.resolve(path.join(base, captureName));
    const resolvedBase = path.resolve(base);
    if (!target.startsWith(resolvedBase + path.sep)) {
      throw new Error("Path escape denied");
    }
    safeUnlink(target);
    return null;
  },

  setBounds(bounds: BrowserBounds): null {
    const view = this.view;
    if (!view || view.webContents.isDestroyed()) {
      throw new Error("No browser view");
    }
    const rect: Rectangle = {
      x: Math.max(0, Math.floor(bounds.x)),
      y: Math.max(0, Math.floor(bounds.y)),
      width: Math.max(1, Math.floor(bounds.width)),
      height: Math.max(1, Math.floor(bounds.height)),
    };
    view.setBounds(rect);
    this.bounds = rect;
    return null;
  },

  setVisible(visible: boolean): null {
    const view = this.view;
    if (!view || view.webContents.isDestroyed()) return null;
    try {
      view.setVisible?.(visible);
    } catch {
      // setVisible may not exist on older Electron; fall back to bounds collapse
      if (!visible) this.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
    this.visible = visible;
    if (visible) {
      this._clearIdleParkTimer();
    } else {
      this._scheduleIdlePark();
    }
    return null;
  },

  async navigate(rawUrl: string): Promise<null> {
    const view = this._ensureView();
    const url = ensureAllowed(normalizeUrl(rawUrl));
    try {
      await view.webContents.loadURL(url);
    } catch (err) {
      // loadURL rejects on abort/redirect; surface benign errors quietly
      const msg = (err as Error)?.message || "";
      if (!/ERR_ABORTED/.test(msg)) {
        throw err;
      }
    }
    this._emitNav();
    return null;
  },

  async goBack(): Promise<null> {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) throw new Error("No browser view");
    if (wc.navigationHistory?.canGoBack?.()) wc.navigationHistory.goBack();
    else if ((wc as any).canGoBack?.()) (wc as any).goBack();
    this._emitNav();
    return null;
  },

  async goForward(): Promise<null> {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) throw new Error("No browser view");
    if (wc.navigationHistory?.canGoForward?.()) wc.navigationHistory.goForward();
    else if ((wc as any).canGoForward?.()) (wc as any).goForward();
    this._emitNav();
    return null;
  },

  async reload(): Promise<null> {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) throw new Error("No browser view");
    wc.reload();
    return null;
  },

  async stop(): Promise<null> {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return null;
    try {
      wc.stop();
    } catch {
      // ignore
    }
    return null;
  },

  async setSelectMode(enabled: boolean): Promise<{ enabled: boolean }> {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) {
      this.selectMode = false;
      throw new Error("No browser view");
    }
    await wc.executeJavaScript(buildInspectorScript(enabled), true);
    this.selectMode = enabled;
    this._sendToRenderer("browser:selectModeChanged", { enabled });
    return { enabled };
  },

  async getNavState(): Promise<BrowserNavState> {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) {
      return {
        url: "",
        title: "",
        canGoBack: false,
        canGoForward: false,
        isLoading: false,
      };
    }
    return {
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: wc.navigationHistory?.canGoBack?.() ?? false,
      canGoForward: wc.navigationHistory?.canGoForward?.() ?? false,
      isLoading: wc.isLoading(),
    };
  },
};
