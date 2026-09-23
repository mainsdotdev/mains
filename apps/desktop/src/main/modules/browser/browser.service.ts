import {
  app,
  BrowserWindow,
  clipboard,
  Menu,
  shell,
  WebContentsView,
  type DownloadItem,
  type ClearDataOptions as ElectronClearDataOptions,
  type NavigationEntry,
  type Rectangle,
  type Session,
  type WebContents,
} from "electron";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { CHANNELS } from "@mains/contracts/channels";
import {
  buildInspectorScript,
  INSPECTOR_SENTINEL,
} from "./inspector.script";
import {
  BLANK_URL,
  isAllowedBrowserUrl,
  resolveBrowserInput,
} from "../../../shared/browser-url";
import {
  isPathInsideDirectory,
  nextDownloadPath,
} from "./browser-downloads";
import {
  addBrowserHistoryVisit,
  MAX_BROWSER_HISTORY_ENTRIES,
  normalizedBrowserHistoryEntry,
  updateBrowserHistoryMetadata,
} from "./browser-history";
import type {
  BrowserBounds,
  BrowserClearDataOptions,
  BrowserClearDataResult,
  BrowserDeviceEmulation,
  BrowserDownload,
  BrowserDownloadState,
  BrowserFindResult,
  BrowserHistoryEntry,
  BrowserNavState,
  BrowserPrintResult,
  BrowserScreenshotMode,
  BrowserSelectionPayload,
  BrowserSelectionResult,
  BrowserState,
  BrowserTabSummary,
} from "./browser.dto";
import {
  downloadsAfterBrowsingDataClear,
  historyAfterBrowsingDataClear,
} from "./browser-clear-data";
import {
  createBrowserDeviceEmulationQueue,
  DEFAULT_BROWSER_DEVICE_EMULATION,
  normalizeBrowserDeviceEmulation,
  type BrowserDeviceEmulationQueue,
} from "./browser-device";
import { keyboardShortcutsService } from "../keyboardShortcuts";
import { buildBrowserContextMenu } from "./browser-context-menu";
import {
  KEYBOARD_SHORTCUTS,
  matchesKeyboardShortcut,
  type KeyboardShortcutId,
} from "../../../shared/keyboard-shortcuts";

const BROWSER_PARTITION = "persist:mains-browser";
const VIEW_BORDER_RADIUS_PX = 0;
const CAPTURE_CACHE_MAX_BYTES = 100 * 1024 * 1024;
const IDLE_HIBERNATE_MS = 2 * 60 * 1000;
const MAX_TABS_PER_CONTEXT = 20;
const MAX_PERSISTED_TABS = 400;
const MAX_HISTORY_ENTRIES = 100;
const MAX_FULL_PAGE_SCREENSHOT_PIXELS = 50_000_000;
const MAX_FULL_PAGE_SCREENSHOT_DIMENSION = 16_384;
const PERSIST_VERSION = 2;
const DEFAULT_OWNER_KEY = "default";
const DOWNLOADS_PERSIST_VERSION = 1;
const HISTORY_PERSIST_VERSION = 1;
const MAX_DOWNLOADS = 100;
const EXTERNAL_PROTOCOLS = new Set(["mailto:", "tel:"]);
const DOWNLOAD_STATES = new Set<BrowserDownloadState>([
  "progressing",
  "paused",
  "completed",
  "cancelled",
  "interrupted",
]);

interface BrowserHistorySnapshot {
  entries: NavigationEntry[];
  index: number;
}

interface BrowserTabRecord {
  id: string;
  ownerKey: string;
  url: string;
  title: string;
  faviconUrl: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  isCrashed: boolean;
  zoomFactor: number;
  deviceEmulation: BrowserDeviceEmulation;
  history: BrowserHistorySnapshot | null;
  view: WebContentsView | null;
  viewPromise: Promise<WebContentsView> | null;
  deviceEmulationQueue: BrowserDeviceEmulationQueue;
  isClosing: boolean;
}

interface PersistedBrowserTab {
  id: string;
  ownerKey?: string;
  url: string;
  title: string;
  faviconUrl: string | null;
  zoomFactor: number;
  deviceEmulation?: BrowserDeviceEmulation;
  history: BrowserHistorySnapshot | null;
}

interface PersistedBrowserState {
  version: number;
  activeTabId: string;
  activeOwnerKey?: string;
  activeTabIdsByOwner?: Record<string, string>;
  tabs: PersistedBrowserTab[];
}

interface PersistedDownloadsState {
  version: number;
  downloads: BrowserDownload[];
}

interface PersistedBrowserHistoryState {
  version: number;
  entries: BrowserHistoryEntry[];
}

interface BrowserPageMetrics {
  viewport: { width: number; height: number };
  content: { width: number; height: number };
  scroll: { x: number; y: number };
  devicePixelRatio: number;
}

function clampZoom(value: number): number {
  return Math.min(5, Math.max(0.25, Math.round(value * 100) / 100));
}

function createTabRecord(
  url = BLANK_URL,
  title = "New tab",
  id: string = randomUUID(),
  ownerKey = DEFAULT_OWNER_KEY,
): BrowserTabRecord {
  return {
    id,
    ownerKey,
    url,
    title,
    faviconUrl: null,
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    isCrashed: false,
    zoomFactor: 1,
    deviceEmulation: { ...DEFAULT_BROWSER_DEVICE_EMULATION },
    history: null,
    view: null,
    viewPromise: null,
    deviceEmulationQueue: createBrowserDeviceEmulationQueue(),
    isClosing: false,
  };
}

function cacheDir(): string {
  const dir = path.join(app.getPath("userData"), "browser-captures");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Best-effort cache creation.
  }
  return dir;
}

function browserStatePath(): string {
  return path.join(app.getPath("userData"), "browser-tabs.json");
}

function browserDownloadsPath(): string {
  return path.join(app.getPath("userData"), "browser-downloads.json");
}

function browserHistoryPath(): string {
  return path.join(app.getPath("userData"), "browser-history.json");
}

function browserDownloadsDirectory(): string {
  return app.getPath("downloads");
}

function downloadNavigationKey(webContentsId: number, url: string): string {
  return `${webContentsId}\0${url}`;
}

function normalizedDownload(value: unknown): BrowserDownload | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<BrowserDownload>;
  const state = DOWNLOAD_STATES.has(record.state as BrowserDownloadState)
    ? (record.state as BrowserDownloadState)
    : null;
  if (
    typeof record.id !== "string" ||
    !record.id ||
    typeof record.fileName !== "string" ||
    !record.fileName ||
    typeof record.savePath !== "string" ||
    !path.isAbsolute(record.savePath) ||
    !isPathInsideDirectory(browserDownloadsDirectory(), record.savePath) ||
    typeof record.sourceUrl !== "string" ||
    typeof record.startedAt !== "string" ||
    typeof record.updatedAt !== "string" ||
    !state
  ) {
    return null;
  }

  return {
    id: record.id,
    tabId: typeof record.tabId === "string" ? record.tabId : null,
    fileName: record.fileName,
    savePath: record.savePath,
    sourceUrl: record.sourceUrl,
    mimeType: typeof record.mimeType === "string" ? record.mimeType : "",
    state:
      state === "progressing" || state === "paused" ? "interrupted" : state,
    receivedBytes: Math.max(0, Number(record.receivedBytes) || 0),
    totalBytes: Math.max(0, Number(record.totalBytes) || 0),
    speedBytesPerSecond: 0,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
  };
}

function pruneCaptureCache() {
  try {
    const dir = cacheDir();
    const entries = fs
      .readdirSync(dir)
      .map((name) => {
        const full = path.join(dir, name);
        try {
          const stat = fs.statSync(full);
          return stat.isFile()
            ? { full, mtime: stat.mtimeMs, size: stat.size }
            : null;
        } catch {
          return null;
        }
      })
      .filter(
        (entry): entry is { full: string; mtime: number; size: number } =>
          entry !== null,
      )
      .sort((a, b) => a.mtime - b.mtime);

    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of entries) {
      if (total <= CAPTURE_CACHE_MAX_BYTES) break;
      try {
        fs.unlinkSync(entry.full);
        total -= entry.size;
      } catch {
        // Best-effort eviction.
      }
    }
  } catch {
    // Best-effort eviction.
  }
}

function safeUnlink(filePath: string) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Best-effort cleanup.
  }
}

function captureBasename(filePath: string | undefined): string | undefined {
  return filePath ? path.basename(filePath) : undefined;
}

function sanitizedHistory(
  history: BrowserHistorySnapshot | null,
): BrowserHistorySnapshot | null {
  if (!history || !Array.isArray(history.entries)) return null;
  const entries = history.entries
    .filter(
      (entry) =>
        entry &&
        typeof entry.url === "string" &&
        typeof entry.title === "string" &&
        isAllowedBrowserUrl(entry.url),
    )
    .slice(-MAX_HISTORY_ENTRIES)
    // Deliberately omit pageState: Chromium may put form values in it.
    .map((entry) => ({ url: entry.url, title: entry.title }));
  if (entries.length === 0) return null;
  return {
    entries,
    index: Math.min(
      entries.length - 1,
      Math.max(0, Number(history.index) || 0),
    ),
  };
}

export const browserService = {
  tabs: new Map<string, BrowserTabRecord>(),
  activeTabId: null as string | null,
  activeOwnerKey: DEFAULT_OWNER_KEY,
  activeTabIdsByOwner: {} as Record<string, string>,
  host: null as BrowserWindow | null,
  bounds: null as BrowserBounds | null,
  visible: false,
  selectMode: false,
  restored: false,
  sessionConfigured: false,
  downloadsLoaded: false,
  downloads: new Map<string, BrowserDownload>(),
  historyLoaded: false,
  historyEntries: [] as BrowserHistoryEntry[],
  activeDownloadItems: new Map<string, DownloadItem>(),
  reservedDownloadPaths: new Set<string>(),
  recentDownloadUrls: new Set<string>(),
  idleTimer: null as NodeJS.Timeout | null,
  persistTimer: null as NodeJS.Timeout | null,
  downloadPersistTimer: null as NodeJS.Timeout | null,
  historyPersistTimer: null as NodeJS.Timeout | null,

  _loadPersistedDownloads() {
    if (this.downloadsLoaded) return;
    this.downloadsLoaded = true;

    try {
      const parsed = JSON.parse(
        fs.readFileSync(browserDownloadsPath(), "utf8"),
      ) as PersistedDownloadsState;
      if (
        parsed.version !== DOWNLOADS_PERSIST_VERSION ||
        !Array.isArray(parsed.downloads)
      ) {
        throw new Error("Unsupported browser downloads state");
      }

      for (const value of parsed.downloads.slice(0, MAX_DOWNLOADS)) {
        const download = normalizedDownload(value);
        if (download) this.downloads.set(download.id, download);
      }
    } catch {
      // First launch or a partial write: start with an empty download list.
    }
  },

  _scheduleDownloadsPersist() {
    if (this.downloadPersistTimer) clearTimeout(this.downloadPersistTimer);
    this.downloadPersistTimer = setTimeout(() => {
      this.downloadPersistTimer = null;
      this._persistDownloadsNow();
    }, 250);
  },

  _persistDownloadsNow() {
    this._loadPersistedDownloads();
    const state: PersistedDownloadsState = {
      version: DOWNLOADS_PERSIST_VERSION,
      downloads: this.getDownloads().slice(0, MAX_DOWNLOADS),
    };
    const target = browserDownloadsPath();
    const temporary = `${target}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(state));
      fs.renameSync(temporary, target);
    } catch (error) {
      safeUnlink(temporary);
      console.warn("[browser] failed to persist downloads:", error);
    }
  },

  _emitDownloads() {
    this._sendToRenderer(
      CHANNELS.browser.downloadsChanged,
      this.getDownloads(),
    );
  },

  _loadPersistedHistory() {
    if (this.historyLoaded) return;
    this.historyLoaded = true;

    try {
      const parsed = JSON.parse(
        fs.readFileSync(browserHistoryPath(), "utf8"),
      ) as PersistedBrowserHistoryState;
      if (
        parsed.version !== HISTORY_PERSIST_VERSION ||
        !Array.isArray(parsed.entries)
      ) {
        throw new Error("Unsupported browser history state");
      }

      this.historyEntries = parsed.entries
        .map(normalizedBrowserHistoryEntry)
        .filter((entry): entry is BrowserHistoryEntry => entry !== null)
        .sort((left, right) => right.visitedAt.localeCompare(left.visitedAt))
        .slice(0, MAX_BROWSER_HISTORY_ENTRIES);
    } catch {
      // First launch or a partial write: start with an empty history.
    }
  },

  _scheduleHistoryPersist() {
    if (this.historyPersistTimer) clearTimeout(this.historyPersistTimer);
    this.historyPersistTimer = setTimeout(() => {
      this.historyPersistTimer = null;
      this._persistHistoryNow();
    }, 250);
  },

  _persistHistoryNow() {
    this._loadPersistedHistory();
    const state: PersistedBrowserHistoryState = {
      version: HISTORY_PERSIST_VERSION,
      entries: this.historyEntries.slice(0, MAX_BROWSER_HISTORY_ENTRIES),
    };
    const target = browserHistoryPath();
    const temporary = `${target}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(state));
      fs.renameSync(temporary, target);
    } catch (error) {
      safeUnlink(temporary);
      console.warn("[browser] failed to persist history:", error);
    }
  },

  _emitHistory() {
    this._sendToRenderer(CHANNELS.browser.historyChanged, this.getHistory());
  },

  _recordHistoryVisit(url: string) {
    this._loadPersistedHistory();
    const visit = normalizedBrowserHistoryEntry({
      id: randomUUID(),
      url,
      title: url,
      faviconUrl: null,
      visitedAt: new Date().toISOString(),
      visitCount: 1,
    });
    if (!visit) return;

    this.historyEntries = addBrowserHistoryVisit(this.historyEntries, visit);
    this._scheduleHistoryPersist();
    this._emitHistory();
  },

  _refreshHistoryMetadata(record: BrowserTabRecord) {
    this._loadPersistedHistory();
    const updated = updateBrowserHistoryMetadata(
      this.historyEntries,
      record.url,
      { title: record.title, faviconUrl: record.faviconUrl },
    );
    if (updated === this.historyEntries) return;
    this.historyEntries = updated;
    this._scheduleHistoryPersist();
    this._emitHistory();
  },

  _trackDownload(item: DownloadItem, sourceContents: WebContents) {
    this._loadPersistedDownloads();
    const downloadDirectory = browserDownloadsDirectory();
    try {
      fs.mkdirSync(downloadDirectory, { recursive: true });
    } catch {
      // Electron will surface a terminal interrupted state if the target fails.
    }

    const savePath = nextDownloadPath(
      downloadDirectory,
      item.getFilename(),
      (candidate) =>
        this.reservedDownloadPaths.has(candidate) || fs.existsSync(candidate),
    );
    item.setSavePath(savePath);
    this.reservedDownloadPaths.add(savePath);
    const downloadKeys = new Set(
      [...item.getURLChain(), item.getURL()].map((url) =>
        downloadNavigationKey(sourceContents.id, url),
      ),
    );
    for (const key of downloadKeys) this.recentDownloadUrls.add(key);
    setTimeout(() => {
      for (const key of downloadKeys) this.recentDownloadUrls.delete(key);
    }, 10_000);

    const now = new Date().toISOString();
    const startTime = item.getStartTime();
    const startedAt = Number.isFinite(startTime) && startTime > 0
      ? new Date(startTime * 1000).toISOString()
      : now;
    const tabId =
      Array.from(this.tabs.values()).find(
        (record) => record.view?.webContents === sourceContents,
      )?.id ?? null;
    const id = randomUUID();
    const download: BrowserDownload = {
      id,
      tabId,
      fileName: path.basename(savePath),
      savePath,
      sourceUrl: item.getURL(),
      mimeType: item.getMimeType(),
      state: "progressing",
      receivedBytes: Math.max(0, item.getReceivedBytes()),
      totalBytes: Math.max(0, item.getTotalBytes()),
      speedBytesPerSecond: Math.max(0, item.getCurrentBytesPerSecond()),
      startedAt,
      updatedAt: now,
    };
    this.downloads.set(id, download);
    this.activeDownloadItems.set(id, item);
    this._scheduleDownloadsPersist();
    this._emitDownloads();

    item.on("updated", (_event, state) => {
      const current = this.downloads.get(id);
      if (!current) return;
      current.state = item.isPaused()
        ? "paused"
        : state === "interrupted"
          ? "interrupted"
          : "progressing";
      current.receivedBytes = Math.max(0, item.getReceivedBytes());
      current.totalBytes = Math.max(0, item.getTotalBytes());
      current.speedBytesPerSecond = Math.max(
        0,
        item.getCurrentBytesPerSecond(),
      );
      current.updatedAt = new Date().toISOString();
      this._scheduleDownloadsPersist();
      this._emitDownloads();
    });

    item.once("done", (_event, state) => {
      const current = this.downloads.get(id);
      this.activeDownloadItems.delete(id);
      this.reservedDownloadPaths.delete(savePath);
      if (!current) return;
      current.state = state;
      current.receivedBytes = Math.max(0, item.getReceivedBytes());
      current.totalBytes = Math.max(
        current.receivedBytes,
        item.getTotalBytes(),
      );
      current.speedBytesPerSecond = 0;
      current.savePath = item.getSavePath() || savePath;
      current.fileName = path.basename(current.savePath);
      current.updatedAt = new Date().toISOString();
      this._scheduleDownloadsPersist();
      this._emitDownloads();
    });
  },

  _findHost(): BrowserWindow | null {
    return (
      BrowserWindow.getFocusedWindow() ||
      BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) ||
      null
    );
  },

  _loadPersistedTabs() {
    if (this.restored) return;
    this.restored = true;

    try {
      const parsed = JSON.parse(
        fs.readFileSync(browserStatePath(), "utf8"),
      ) as PersistedBrowserState;
      if ((parsed.version !== 1 && parsed.version !== PERSIST_VERSION) || !Array.isArray(parsed.tabs)) {
        throw new Error("Unsupported browser state");
      }

      for (const saved of parsed.tabs.slice(0, MAX_PERSISTED_TABS)) {
        if (!saved || typeof saved.id !== "string" || !saved.id) continue;
        const url =
          typeof saved.url === "string" && isAllowedBrowserUrl(saved.url)
            ? saved.url
            : BLANK_URL;
        const record = createTabRecord(
          url,
          typeof saved.title === "string" && saved.title
            ? saved.title
            : "New tab",
          saved.id,
          parsed.version === 1
            ? DEFAULT_OWNER_KEY
            : typeof saved.ownerKey === "string" && saved.ownerKey
              ? saved.ownerKey
              : DEFAULT_OWNER_KEY,
        );
        record.faviconUrl =
          typeof saved.faviconUrl === "string" ? saved.faviconUrl : null;
        record.zoomFactor = clampZoom(Number(saved.zoomFactor) || 1);
        record.deviceEmulation = normalizeBrowserDeviceEmulation(
          saved.deviceEmulation,
        );
        record.history = sanitizedHistory(saved.history);
        if (record.history) {
          record.canGoBack = record.history.index > 0;
          record.canGoForward =
            record.history.index < record.history.entries.length - 1;
        }
        this.tabs.set(record.id, record);
      }

      this.activeOwnerKey = parsed.version === PERSIST_VERSION && typeof parsed.activeOwnerKey === "string" && parsed.activeOwnerKey
        ? parsed.activeOwnerKey
        : DEFAULT_OWNER_KEY;
      this.activeTabIdsByOwner = parsed.version === PERSIST_VERSION && parsed.activeTabIdsByOwner && typeof parsed.activeTabIdsByOwner === "object"
        ? parsed.activeTabIdsByOwner
        : {};
      if (this.tabs.has(parsed.activeTabId)) {
        const active = this.tabs.get(parsed.activeTabId)!;
        this.activeTabIdsByOwner[active.ownerKey] = active.id;
        if (parsed.version === 1) this.activeOwnerKey = active.ownerKey;
      }
      this.activeTabId = this.activeTabIdsByOwner[this.activeOwnerKey] ?? null;
    } catch {
      // First launch, old format, or a partial write: start with a clean tab.
    }

  },

  _activeTab(): BrowserTabRecord {
    this._loadPersistedTabs();
    const active = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    if (active?.ownerKey === this.activeOwnerKey) return active;
    const remembered = this.tabs.get(this.activeTabIdsByOwner[this.activeOwnerKey]);
    if (remembered?.ownerKey === this.activeOwnerKey) {
      this.activeTabId = remembered.id;
      return remembered;
    }
    const first = Array.from(this.tabs.values()).find((record) => record.ownerKey === this.activeOwnerKey);
    if (first) {
      this.activeTabId = first.id;
      this.activeTabIdsByOwner[this.activeOwnerKey] = first.id;
      return first;
    }
    const created = createTabRecord(BLANK_URL, "New tab", randomUUID(), this.activeOwnerKey);
    this.tabs.set(created.id, created);
    this.activeTabId = created.id;
    this.activeTabIdsByOwner[this.activeOwnerKey] = created.id;
    return created;
  },

  _configureSession(browserSession: Session) {
    if (this.sessionConfigured) return;
    this.sessionConfigured = true;
    this._loadPersistedDownloads();

    browserSession.on("will-download", (_event, item, sourceContents) => {
      this._trackDownload(item, sourceContents);
    });

    // Remote pages get no privileged browser permissions until Mains grows a
    // first-class, origin-scoped permission prompt.
    browserSession.setPermissionCheckHandler(() => false);
    browserSession.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    );
    browserSession.setDevicePermissionHandler(() => false);
  },

  _openExternalIfAllowed(url: string) {
    try {
      if (EXTERNAL_PROTOCOLS.has(new URL(url).protocol)) {
        void shell.openExternal(url);
      }
    } catch {
      // Invalid URLs are ignored.
    }
  },

  _wireView(record: BrowserTabRecord, view: WebContentsView) {
    const contents = view.webContents;

    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedBrowserUrl(url)) {
        void this.createTab(url, record.ownerKey).catch((error) => {
          console.warn("[browser] Failed to open popup in a new tab:", error);
        });
      } else {
        this._openExternalIfAllowed(url);
      }
      return { action: "deny" };
    });

    contents.on("context-menu", (_event, params) => {
      const host = this.host;
      if (
        !host ||
        host.isDestroyed() ||
        !this.visible ||
        this.activeTabId !== record.id ||
        contents.isDestroyed()
      ) {
        return;
      }

      const ifAlive = (action: () => void) => () => {
        if (!contents.isDestroyed()) action();
      };
      const template = buildBrowserContextMenu(
        params,
        {
          canGoBack: contents.navigationHistory.canGoBack(),
          canGoForward: contents.navigationHistory.canGoForward(),
          canInspect: !app.isPackaged,
        },
        {
          openTab: (url) => {
            void this.createTab(url, record.ownerKey).catch((error) => {
              console.warn("[browser] Failed to open context link:", error);
            });
          },
          openExternal: (url) => {
            void shell.openExternal(url).catch((error) => {
              console.warn("[browser] Failed to open external link:", error);
            });
          },
          download: (url) => {
            if (!contents.isDestroyed()) contents.downloadURL(url);
          },
          copyText: (value) => clipboard.writeText(value),
          copyImage: (x, y) => {
            if (!contents.isDestroyed()) contents.copyImageAt(x, y);
          },
          undo: ifAlive(() => contents.undo()),
          redo: ifAlive(() => contents.redo()),
          cut: ifAlive(() => contents.cut()),
          copy: ifAlive(() => contents.copy()),
          paste: ifAlive(() => contents.paste()),
          selectAll: ifAlive(() => contents.selectAll()),
          back: ifAlive(() => {
            if (!contents.navigationHistory.canGoBack()) return;
            record.deviceEmulationQueue.beginNavigation();
            contents.navigationHistory.goBack();
          }),
          forward: ifAlive(() => {
            if (!contents.navigationHistory.canGoForward()) return;
            record.deviceEmulationQueue.beginNavigation();
            contents.navigationHistory.goForward();
          }),
          reload: ifAlive(() => {
            record.deviceEmulationQueue.beginNavigation();
            contents.reload();
          }),
          inspect: (x, y) => {
            if (!contents.isDestroyed()) contents.inspectElement(x, y);
          },
        },
      );
      Menu.buildFromTemplate(template).popup({
        window: host,
        frame: params.frame ?? undefined,
      });
    });

    contents.on("will-navigate", (event, url) => {
      if (isAllowedBrowserUrl(url)) {
        record.deviceEmulationQueue.beginNavigation();
        return;
      }
      event.preventDefault();
      this._openExternalIfAllowed(url);
    });

    contents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown" || input.isAutoRepeat) return;
      const shortcutInput = {
        code: input.code,
        key: input.key,
        metaKey: input.meta,
        ctrlKey: input.control,
        altKey: input.alt,
        shiftKey: input.shift,
      };
      const matches = (id: KeyboardShortcutId) =>
        matchesKeyboardShortcut(
          shortcutInput,
          keyboardShortcutsService.getBinding(id),
        );
      const appShortcut = KEYBOARD_SHORTCUTS.find(
        (shortcut) => shortcut.scope === "app" && matches(shortcut.id),
      );
      if (appShortcut) {
        event.preventDefault();
        this._sendToRenderer(CHANNELS.browser.shortcut, {
          action: "app-shortcut",
          shortcutId: appShortcut.id,
        });
        return;
      }
      if (matches("browser.focusLocation") || matches("browser.find")) {
        event.preventDefault();
        this._sendToRenderer(CHANNELS.browser.shortcut, {
          action: matches("browser.focusLocation")
            ? "focus-location"
            : "find",
        });
        return;
      }
      if (matches("browser.newTab")) {
        event.preventDefault();
        void this.createTab("", record.ownerKey).catch((error) => {
          console.warn("[browser] Failed to create a tab from shortcut:", error);
        });
        return;
      }
      if (matches("browser.closeTab")) {
        event.preventDefault();
        void this.closeTab(record.id).catch((error) => {
          console.warn("[browser] Failed to close a tab from shortcut:", error);
        });
        return;
      }
      if (matches("browser.print")) {
        event.preventDefault();
        void this.printPage().catch((error) => {
          console.warn("[browser] Failed to print from shortcut:", error);
        });
        return;
      }
      if (matches("browser.back")) {
        event.preventDefault();
        void this.goBack();
        return;
      }
      if (matches("browser.forward")) {
        event.preventDefault();
        void this.goForward();
        return;
      }
      if (matches("browser.resetZoom")) {
        event.preventDefault();
        this.setZoomFactor(1);
        return;
      }
      if (matches("browser.zoomIn")) {
        event.preventDefault();
        this.setZoomFactor(record.zoomFactor + 0.1);
        return;
      }
      if (matches("browser.zoomOut")) {
        event.preventDefault();
        this.setZoomFactor(record.zoomFactor - 0.1);
        return;
      }
      if (matches("browser.nextTab") || matches("browser.previousTab")) {
        event.preventDefault();
        const ids = Array.from(this.tabs.values())
          .filter((tab) => tab.ownerKey === record.ownerKey)
          .map((tab) => tab.id);
        const current = ids.indexOf(record.id);
        const direction = matches("browser.previousTab") ? -1 : 1;
        const next = (current + direction + ids.length) % ids.length;
        if (ids[next]) {
          void this.activateTab(ids[next]).catch((error) => {
            console.warn(
              "[browser] Failed to activate a tab from shortcut:",
              error,
            );
          });
        }
      }
    });

    const sync = () => this._syncRecord(record);
    const syncAndRefreshHistory = () => {
      this._syncRecord(record);
      this._refreshHistoryMetadata(record);
    };
    contents.on(
      "did-start-navigation",
      (_event, _url, _isSameDocument, isMainFrame) => {
        if (!isMainFrame) return;
        record.faviconUrl = null;
        record.deviceEmulationQueue.beginNavigation();
      },
    );
    contents.on("did-finish-load", syncAndRefreshHistory);
    contents.on("did-navigate", (_event, url) => {
      this._syncRecord(record);
      this._recordHistoryVisit(url);
      this._refreshHistoryMetadata(record);
    });
    contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      this._syncRecord(record);
      if (!isMainFrame) return;
      this._recordHistoryVisit(url);
      this._refreshHistoryMetadata(record);
    });
    contents.on("page-title-updated", syncAndRefreshHistory);
    contents.on("did-start-loading", () => {
      record.deviceEmulationQueue.beginNavigation();
      sync();
    });
    contents.on("did-stop-loading", () => {
      void record.deviceEmulationQueue.readyAfterPaint(contents);
      sync();
    });
    contents.on("page-favicon-updated", (_event, favicons) => {
      record.faviconUrl =
        favicons.find((url) => /^https?:/i.test(url)) ?? null;
      this._schedulePersist();
      this._emitState();
      this._refreshHistoryMetadata(record);
    });
    contents.on("found-in-page", (_event, result) => {
      const payload: BrowserFindResult = {
        tabId: record.id,
        activeMatchOrdinal: result.activeMatchOrdinal,
        matches: result.matches,
        finalUpdate: result.finalUpdate,
      };
      this._sendToRenderer(CHANNELS.browser.findResult, payload);
    });
    contents.on("render-process-gone", () => {
      record.deviceEmulationQueue.reset();
      record.isCrashed = true;
      record.isLoading = false;
      this._emitState();
    });
    contents.on("destroyed", () => {
      record.deviceEmulationQueue.reset();
      if (record.view === view) record.view = null;
    });

    contents.on("console-message", (event) => {
      const message = event.message;
      if (!message.startsWith(INSPECTOR_SENTINEL)) return;
      const raw = message.slice(INSPECTOR_SENTINEL.length);
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.cancel) {
          this.selectMode = false;
          this._sendToRenderer(CHANNELS.browser.selectModeChanged, {
            enabled: false,
          });
          return;
        }
        void this._handleSelection(
          parsed as Omit<BrowserSelectionPayload, "id">,
          record.ownerKey,
        );
      } catch (error) {
        console.warn("[browser] failed to parse selection payload:", error);
      }
    });
  },

  async _ensureTabView(record: BrowserTabRecord): Promise<WebContentsView> {
    if (record.isClosing) throw new Error("Browser tab is closing");
    if (record.view && !record.view.webContents.isDestroyed()) return record.view;
    if (record.viewPromise) return record.viewPromise;

    record.viewPromise = (async () => {
      record.deviceEmulationQueue.reset();
      const view = new WebContentsView({
        webPreferences: {
          partition: BROWSER_PARTITION,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          devTools: !app.isPackaged,
          webSecurity: true,
          javascript: true,
          backgroundThrottling: true,
        },
      });
      record.view = view;
      record.isCrashed = false;
      this._configureSession(view.webContents.session);
      this._wireView(record, view);

      try {
        view.setBorderRadius(VIEW_BORDER_RADIUS_PX);
      } catch {
        // Older runtimes may not expose setBorderRadius.
      }

      try {
        if (record.history?.entries.length) {
          await view.webContents.navigationHistory.restore(record.history);
        } else if (record.url !== BLANK_URL) {
          await view.webContents.loadURL(record.url);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/ERR_ABORTED/.test(message) && record.url !== BLANK_URL) {
          try {
            await view.webContents.loadURL(record.url);
          } catch {
            // Keep the tab recoverable through a later explicit reload.
          }
        }
      }

      if (record.isClosing) {
        record.deviceEmulationQueue.reset();
        if (!view.webContents.isDestroyed()) view.webContents.close();
        if (record.view === view) record.view = null;
        throw new Error("Browser tab is closing");
      }

      view.webContents.setZoomFactor(record.zoomFactor);
      this._syncRecord(record);
      return view;
    })().finally(() => {
      record.viewPromise = null;
    });

    return record.viewPromise;
  },

  _syncRecord(record: BrowserTabRecord) {
    const contents = record.view?.webContents;
    if (!contents || contents.isDestroyed()) return;
    record.url = contents.getURL() || record.url || BLANK_URL;
    record.title =
      contents.getTitle() ||
      (record.url === BLANK_URL ? "New tab" : record.url);
    record.canGoBack = contents.navigationHistory.canGoBack();
    record.canGoForward = contents.navigationHistory.canGoForward();
    record.isLoading = contents.isLoading();
    record.zoomFactor = clampZoom(contents.getZoomFactor());
    record.isCrashed = false;
    this._schedulePersist();
    this._emitState();
  },

  _scheduleDeviceEmulation(record: BrowserTabRecord) {
    const view = record.view;
    if (
      !view ||
      !this.visible ||
      this.activeTabId !== record.id ||
      !this.host ||
      this.host.isDestroyed() ||
      !this.host.contentView.children.includes(view) ||
      view.webContents.isDestroyed()
    ) {
      return;
    }
    const contents = view.webContents;
    record.deviceEmulationQueue.schedule(
      contents,
      record.deviceEmulation,
      this.bounds,
    );
  },

  _snapshotRecord(record: BrowserTabRecord) {
    const contents = record.view?.webContents;
    if (!contents || contents.isDestroyed()) return;
    record.url = contents.getURL() || record.url || BLANK_URL;
    record.title =
      contents.getTitle() ||
      (record.url === BLANK_URL ? "New tab" : record.url);
    record.canGoBack = contents.navigationHistory.canGoBack();
    record.canGoForward = contents.navigationHistory.canGoForward();
    record.isLoading = contents.isLoading();
    record.zoomFactor = clampZoom(contents.getZoomFactor());

    const allEntries = contents.navigationHistory
      .getAllEntries()
      .filter((entry) => isAllowedBrowserUrl(entry.url));
    if (allEntries.length === 0) {
      record.history = null;
      return;
    }

    const activeIndex = contents.navigationHistory.getActiveIndex();
    const start = Math.max(
      0,
      Math.min(
        allEntries.length - MAX_HISTORY_ENTRIES,
        activeIndex - Math.floor(MAX_HISTORY_ENTRIES / 2),
      ),
    );
    const entries = allEntries
      .slice(start, start + MAX_HISTORY_ENTRIES)
      // pageState may contain form values, so it is never persisted.
      .map((entry) => ({ url: entry.url, title: entry.title }));
    record.history = {
      entries,
      index: Math.max(0, Math.min(entries.length - 1, activeIndex - start)),
    };
  },

  _tabSummary(record: BrowserTabRecord): BrowserTabSummary {
    return {
      tabId: record.id,
      url: record.url,
      title: record.title,
      faviconUrl: record.faviconUrl,
      canGoBack: record.canGoBack,
      canGoForward: record.canGoForward,
      isLoading: record.isLoading,
      isCrashed: record.isCrashed,
      zoomFactor: record.zoomFactor,
      deviceEmulation: { ...record.deviceEmulation },
    };
  },

  _sendToRenderer(channel: string, payload: unknown) {
    if (this.host && !this.host.isDestroyed()) {
      this.host.webContents.send(channel, payload);
    }
  },

  _emitState() {
    const state = this.getState();
    this._sendToRenderer(CHANNELS.browser.stateChanged, state);
    const active = this.tabs.get(state.activeTabId);
    if (active) {
      this._sendToRenderer(
        CHANNELS.browser.navState,
        this._tabSummary(active),
      );
    }
  },

  _schedulePersist() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this._persistNow();
    }, 150);
  },

  _persistNow() {
    this._loadPersistedTabs();
    for (const record of this.tabs.values()) this._snapshotRecord(record);
    const allTabs = Array.from(this.tabs.values());
    const currentTabs = allTabs.filter((record) => record.ownerKey === this.activeOwnerKey);
    const otherTabs = allTabs.filter((record) => record.ownerKey !== this.activeOwnerKey);
    const tabsToSave = [
      ...otherTabs.slice(-(MAX_PERSISTED_TABS - currentTabs.length)),
      ...currentTabs,
    ];

    const state: PersistedBrowserState = {
      version: PERSIST_VERSION,
      activeTabId: this.activeTabId ?? "",
      activeOwnerKey: this.activeOwnerKey,
      activeTabIdsByOwner: this.activeTabIdsByOwner,
      tabs: tabsToSave.map((record) => ({
        id: record.id,
        ownerKey: record.ownerKey,
        url: record.url,
        title: record.title,
        faviconUrl: record.faviconUrl,
        zoomFactor: record.zoomFactor,
        deviceEmulation: record.deviceEmulation,
        history: record.history,
      })),
    };

    const target = browserStatePath();
    const temporary = `${target}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(state));
      fs.renameSync(temporary, target);
    } catch (error) {
      safeUnlink(temporary);
      console.warn("[browser] failed to persist tabs:", error);
    }
  },

  _clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  },

  _scheduleIdleHibernate() {
    this._clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.visible) void this._hibernateViews();
    }, IDLE_HIBERNATE_MS);
  },

  async _hibernateViews() {
    this._persistNow();
    for (const record of this.tabs.values()) {
      if (this.visible) return;
      let view = record.view;
      if (record.viewPromise) {
        try {
          view = await record.viewPromise;
        } catch {
          view = record.view;
        }
      }
      if (this.visible) return;
      record.deviceEmulationQueue.reset();
      if (!view || view.webContents.isDestroyed()) continue;
      if (this.host && !this.host.isDestroyed()) {
        try {
          this.host.contentView.removeChildView(view);
        } catch {
          // It may already be detached.
        }
      }
      view.webContents.close();
      record.view = null;
    }
  },

  async _mountActiveView() {
    if (!this.visible || !this.host || this.host.isDestroyed()) return;
    const expectedTabId = this._activeTab().id;
    const record = this.tabs.get(expectedTabId);
    if (!record) return;
    const view = await this._ensureTabView(record);
    if (
      !this.visible ||
      !this.host ||
      this.host.isDestroyed() ||
      this.activeTabId !== expectedTabId
    ) {
      view.setVisible(false);
      return;
    }
    if (!this.host.contentView.children.includes(view)) {
      this.host.contentView.addChildView(view);
    }
    if (this.bounds) view.setBounds(this.bounds);
    view.setVisible(true);
    this._scheduleDeviceEmulation(record);
    void record.deviceEmulationQueue.readyAfterPaint(view.webContents);
    view.webContents.focus();
  },

  async _handleSelection(payload: Omit<BrowserSelectionPayload, "id">, ownerKey: string) {
    const id = randomUUID();
    const record = this._activeTab();
    if (!record.view || record.view.webContents.isDestroyed()) return;

    const elementRect = this._clampRect(payload.rect, payload.viewport);

    const element = await this._capture(elementRect, `element-${id}`);
    pruneCaptureCache();

    const result: BrowserSelectionResult = {
      id,
      ownerKey,
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
      screenshotMimeType: "image/png",
    };

    this.selectMode = false;
    this._sendToRenderer(CHANNELS.browser.selectModeChanged, { enabled: false });
    this._sendToRenderer(CHANNELS.browser.selection, result);
  },

  _clampRect(
    rect: { x: number; y: number; width: number; height: number },
    viewport: { width: number; height: number },
  ): Rectangle {
    const x = Math.max(0, Math.min(viewport.width, Math.floor(rect.x)));
    const y = Math.max(0, Math.min(viewport.height, Math.floor(rect.y)));
    const maxX = Math.max(
      x + 1,
      Math.min(viewport.width, Math.floor(rect.x + rect.width)),
    );
    const maxY = Math.max(
      y + 1,
      Math.min(viewport.height, Math.floor(rect.y + rect.height)),
    );
    return { x, y, width: maxX - x, height: maxY - y };
  },

  async _capture(
    rect: Rectangle,
    prefix: string,
  ): Promise<{ filePath: string } | undefined> {
    const view = this._activeTab().view;
    if (!view || view.webContents.isDestroyed()) return undefined;
    try {
      const image = await view.webContents.capturePage(rect);
      if (image.isEmpty()) return undefined;
      const filePath = path.join(cacheDir(), `${prefix}-${Date.now()}.png`);
      fs.writeFileSync(filePath, image.toPNG());
      return { filePath };
    } catch (error) {
      console.warn("[browser] capturePage failed:", error);
      return undefined;
    }
  },

  async _readPageMetrics(contents: WebContents): Promise<BrowserPageMetrics> {
    const metrics = (await contents.executeJavaScript(
      `(() => {
        const root = document.documentElement;
        const body = document.body;
        return {
          viewport: {
            width: Math.max(1, window.innerWidth || root.clientWidth || 1),
            height: Math.max(1, window.innerHeight || root.clientHeight || 1),
          },
          content: {
            width: Math.max(
              1,
              root.scrollWidth,
              root.clientWidth,
              body ? body.scrollWidth : 0,
              body ? body.clientWidth : 0,
            ),
            height: Math.max(
              1,
              root.scrollHeight,
              root.clientHeight,
              body ? body.scrollHeight : 0,
              body ? body.clientHeight : 0,
            ),
          },
          scroll: { x: window.scrollX || 0, y: window.scrollY || 0 },
          devicePixelRatio: window.devicePixelRatio || 1,
        };
      })()`,
      true,
    )) as BrowserPageMetrics;

    return {
      viewport: {
        width: Math.max(1, Number(metrics.viewport?.width) || 1),
        height: Math.max(1, Number(metrics.viewport?.height) || 1),
      },
      content: {
        width: Math.max(1, Number(metrics.content?.width) || 1),
        height: Math.max(1, Number(metrics.content?.height) || 1),
      },
      scroll: {
        x: Math.max(0, Number(metrics.scroll?.x) || 0),
        y: Math.max(0, Number(metrics.scroll?.y) || 0),
      },
      devicePixelRatio: Math.max(1, Number(metrics.devicePixelRatio) || 1),
    };
  },

  _writeCapture(buffer: Buffer, prefix: string): string {
    if (buffer.length === 0) throw new Error("The page produced an empty image");
    const filePath = path.join(cacheDir(), `${prefix}-${Date.now()}.png`);
    fs.writeFileSync(filePath, buffer);
    pruneCaptureCache();
    return filePath;
  },

  async _captureFullPage(
    contents: WebContents,
    fallbackMetrics: BrowserPageMetrics,
  ): Promise<{ buffer: Buffer; width: number; height: number }> {
    const debuggerApi = contents.debugger;
    const alreadyAttached = debuggerApi.isAttached();

    if (!alreadyAttached) {
      try {
        debuggerApi.attach("1.3");
      } catch {
        throw new Error(
          "Full-page screenshot is unavailable while DevTools is attached",
        );
      }
    }

    try {
      const layout = (await debuggerApi.sendCommand(
        "Page.getLayoutMetrics",
      )) as {
        cssContentSize?: { width?: number; height?: number };
        contentSize?: { width?: number; height?: number };
      };
      const contentSize = layout.cssContentSize ?? layout.contentSize;
      const width = Math.max(
        1,
        Math.ceil(Number(contentSize?.width) || fallbackMetrics.content.width),
      );
      const height = Math.max(
        1,
        Math.ceil(Number(contentSize?.height) || fallbackMetrics.content.height),
      );
      const scale = Math.min(
        1,
        MAX_FULL_PAGE_SCREENSHOT_DIMENSION / width,
        MAX_FULL_PAGE_SCREENSHOT_DIMENSION / height,
        Math.sqrt(MAX_FULL_PAGE_SCREENSHOT_PIXELS / (width * height)),
      );
      if (scale < 0.1) {
        throw new Error("This page is too large for a full-page screenshot");
      }

      const screenshot = (await debuggerApi.sendCommand(
        "Page.captureScreenshot",
        {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width, height, scale },
        },
      )) as { data?: string };
      if (!screenshot.data) throw new Error("The page produced an empty image");
      return {
        buffer: Buffer.from(screenshot.data, "base64"),
        width,
        height,
      };
    } finally {
      if (!alreadyAttached && debuggerApi.isAttached()) debuggerApi.detach();
    }
  },

  async attach(bounds: BrowserBounds): Promise<BrowserState> {
    const host = this._findHost();
    if (!host) throw new Error("No active window");
    this.host = host;
    this.bounds = {
      x: Math.max(0, Math.floor(bounds.x)),
      y: Math.max(0, Math.floor(bounds.y)),
      width: Math.max(1, Math.floor(bounds.width)),
      height: Math.max(1, Math.floor(bounds.height)),
    };
    this.visible = true;
    this._clearIdleTimer();
    this._loadPersistedTabs();
    await this._mountActiveView();
    this._emitState();
    return this.getState();
  },

  detach(): null {
    const activeRecord = this.activeTabId
      ? this.tabs.get(this.activeTabId)
      : null;
    const activeView = activeRecord?.view;
    activeRecord?.deviceEmulationQueue.cancel();
    if (activeView && this.host && !this.host.isDestroyed()) {
      try {
        this.host.contentView.removeChildView(activeView);
      } catch {
        // It may already be detached.
      }
    }
    this.visible = false;
    if (this.selectMode) void this.setSelectMode(false);
    this._scheduleIdleHibernate();
    return null;
  },

  destroy(): null {
    this._clearIdleTimer();
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (this.downloadPersistTimer) {
      clearTimeout(this.downloadPersistTimer);
      this.downloadPersistTimer = null;
    }
    if (this.historyPersistTimer) {
      clearTimeout(this.historyPersistTimer);
      this.historyPersistTimer = null;
    }
    this._persistNow();
    this._persistDownloadsNow();
    this._persistHistoryNow();
    for (const record of this.tabs.values()) {
      record.isClosing = true;
      record.deviceEmulationQueue.reset();
      if (record.view && !record.view.webContents.isDestroyed()) {
        if (this.host && !this.host.isDestroyed()) {
          try {
            this.host.contentView.removeChildView(record.view);
          } catch {
            // It may already be detached.
          }
        }
        record.view.webContents.close();
      }
    }
    this.tabs.clear();
    this.activeTabId = null;
    this.activeOwnerKey = DEFAULT_OWNER_KEY;
    this.activeTabIdsByOwner = {};
    this.host = null;
    this.bounds = null;
    this.visible = false;
    this.selectMode = false;
    this.restored = false;
    this.historyLoaded = false;
    this.historyEntries = [];
    return null;
  },

  getState(): BrowserState {
    this._loadPersistedTabs();
    const tabs = Array.from(this.tabs.values())
      .filter((record) => record.ownerKey === this.activeOwnerKey);
    const active = tabs.find((tab) => tab.id === this.activeTabId)
      ?? tabs.find((tab) => tab.id === this.activeTabIdsByOwner[this.activeOwnerKey])
      ?? tabs[0];
    if (active) {
      this.activeTabId = active.id;
      this.activeTabIdsByOwner[this.activeOwnerKey] = active.id;
    }
    return {
      ownerKey: this.activeOwnerKey,
      activeTabId: active?.id ?? "",
      tabs: tabs.map((record) => this._tabSummary(record)),
    };
  },

  async setContext(ownerKey: string, showBlankTab = false): Promise<BrowserState> {
    this._loadPersistedTabs();
    if (ownerKey === this.activeOwnerKey) return this.getState();
    if (this.activeTabId) {
      this.activeTabIdsByOwner[this.activeOwnerKey] = this.activeTabId;
    }

    // Tabs saved before browser contexts existed belong to the first chat
    // opened after upgrading. The same rule covers a tab opened before the
    // workspace page has resolved its owner on startup.
    if (
      this.activeOwnerKey === DEFAULT_OWNER_KEY &&
      ownerKey !== DEFAULT_OWNER_KEY &&
      !Array.from(this.tabs.values()).some((tab) => tab.ownerKey === ownerKey)
    ) {
      for (const tab of this.tabs.values()) {
        if (tab.ownerKey === DEFAULT_OWNER_KEY) tab.ownerKey = ownerKey;
      }
      if (this.activeTabIdsByOwner[DEFAULT_OWNER_KEY]) {
        this.activeTabIdsByOwner[ownerKey] = this.activeTabIdsByOwner[DEFAULT_OWNER_KEY];
        delete this.activeTabIdsByOwner[DEFAULT_OWNER_KEY];
      }
    }

    this.activeOwnerKey = ownerKey;
    const remembered = this.tabs.get(this.activeTabIdsByOwner[ownerKey]);
    const next = remembered?.ownerKey === ownerKey
      ? remembered
      : Array.from(this.tabs.values()).find((tab) => tab.ownerKey === ownerKey);
    if (!(showBlankTab && this.visible)) {
      const previous = this.activeTabId ? this.tabs.get(this.activeTabId) : null;
      if (previous?.view) {
        previous.deviceEmulationQueue.cancel();
        if (this.selectMode && !previous.view.webContents.isDestroyed()) {
          void previous.view.webContents
            .executeJavaScript(buildInspectorScript(false))
            .catch(() => {});
        }
        this._snapshotRecord(previous);
        previous.view.setVisible(false);
        if (this.host && !this.host.isDestroyed()) {
          try {
            this.host.contentView.removeChildView(previous.view);
          } catch {
            // It may already be detached.
          }
        }
      }
      if (this.selectMode) {
        this.selectMode = false;
        this._sendToRenderer(CHANNELS.browser.selectModeChanged, { enabled: false });
      }
      this.activeTabId = next?.id ?? null;
      if (next) this.activeTabIdsByOwner[ownerKey] = next.id;
      this._schedulePersist();
      this._emitState();
      return this.getState();
    }
    const target = next ?? createTabRecord(BLANK_URL, "New tab", randomUUID(), ownerKey);
    if (!next) this.tabs.set(target.id, target);
    await this.activateTab(target.id);
    return this.getState();
  },

  reassignTabs(fromOwnerKey: string, toOwnerKey: string): BrowserState {
    this._loadPersistedTabs();
    if (fromOwnerKey === toOwnerKey) return this.getState();
    const moved = Array.from(this.tabs.values()).filter((tab) => tab.ownerKey === fromOwnerKey);
    if (moved.length === 0) return this.getState();
    const chosenId = this.activeTabIdsByOwner[fromOwnerKey] ?? moved[0].id;
    for (const tab of moved) tab.ownerKey = toOwnerKey;
    this.activeTabIdsByOwner[toOwnerKey] = chosenId;
    delete this.activeTabIdsByOwner[fromOwnerKey];
    if (this.activeOwnerKey === fromOwnerKey) this.activeOwnerKey = toOwnerKey;
    this._schedulePersist();
    this._emitState();
    return this.getState();
  },

  getDownloads(): BrowserDownload[] {
    this._loadPersistedDownloads();
    return Array.from(this.downloads.values()).sort((left, right) =>
      right.startedAt.localeCompare(left.startedAt),
    );
  },

  getHistory(): BrowserHistoryEntry[] {
    this._loadPersistedHistory();
    return [...this.historyEntries];
  },

  removeHistoryEntry(historyEntryId: string): BrowserHistoryEntry[] {
    this._loadPersistedHistory();
    const next = this.historyEntries.filter(
      (entry) => entry.id !== historyEntryId,
    );
    if (next.length === this.historyEntries.length) {
      throw new Error("History entry not found");
    }
    this.historyEntries = next;
    this._scheduleHistoryPersist();
    this._emitHistory();
    return this.getHistory();
  },

  async _clearTabNavigationHistory(): Promise<void> {
    this._loadPersistedTabs();
    for (const record of this.tabs.values()) {
      // A view may still be restoring its saved history. Wait for it before
      // clearing Chromium's stack, or the next snapshot would write it back.
      if (record.viewPromise) {
        try {
          await record.viewPromise;
        } catch {
          // A failed view has no live navigation history to clear.
        }
      }
      const contents = record.view?.webContents;
      if (contents && !contents.isDestroyed()) {
        contents.navigationHistory.clear();
      }
      record.history = null;
      record.canGoBack = false;
      record.canGoForward = false;
    }
    // Current tab URLs remain so the open pages can be restored. The cleared
    // back/forward stacks must reach disk before the action reports success.
    this._persistNow();
    this._emitState();
  },

  async clearHistory(): Promise<BrowserHistoryEntry[]> {
    this._loadPersistedHistory();
    await this._clearTabNavigationHistory();
    this.historyEntries = [];
    this._persistHistoryNow();
    this._emitHistory();
    return [];
  },

  async clearBrowsingData(
    options: BrowserClearDataOptions,
  ): Promise<BrowserClearDataResult> {
    this._loadPersistedHistory();
    this._loadPersistedDownloads();
    const nextHistory = options.history
      ? historyAfterBrowsingDataClear(
        this.historyEntries,
        options.timeRange,
      )
      : null;
    const nextDownloads = options.downloads
      ? downloadsAfterBrowsingDataClear(
        this.getDownloads(),
        new Set(this.activeDownloadItems.keys()),
        options.timeRange,
      )
      : null;

    const dataTypes: NonNullable<ElectronClearDataOptions["dataTypes"]> = [];
    if (options.cookiesAndSiteData) {
      dataTypes.push(
        "backgroundFetch",
        "cookies",
        "fileSystems",
        "indexedDB",
        "localStorage",
        "serviceWorkers",
        "webSQL",
      );
    }
    if (options.cache) dataTypes.push("cache");

    if (dataTypes.length > 0) {
      const record = this._activeTab();
      const view = await this._ensureTabView(record);
      await view.webContents.session.clearData({ dataTypes });
      if (options.cookiesAndSiteData) {
        await view.webContents.session.clearAuthCache();
      }
    }

    if (nextHistory) {
      // Navigation entries have no visit timestamps, so a ranged clear also
      // drops each tab's back/forward stack to avoid retaining cleared URLs.
      await this._clearTabNavigationHistory();
      this.historyEntries = nextHistory;
      this._persistHistoryNow();
      this._emitHistory();
    }

    if (nextDownloads) {
      this.downloads = new Map(
        nextDownloads.map((download) => [download.id, download]),
      );
      this._scheduleDownloadsPersist();
      this._emitDownloads();
    }

    return {
      history: this.getHistory(),
      downloads: this.getDownloads(),
    };
  },

  cancelDownload(downloadId: string): BrowserDownload[] {
    const download = this.downloads.get(downloadId);
    if (!download) throw new Error("Download not found");
    const item = this.activeDownloadItems.get(downloadId);
    if (!item) throw new Error("Download is no longer active");
    item.cancel();
    download.state = "cancelled";
    download.speedBytesPerSecond = 0;
    download.updatedAt = new Date().toISOString();
    this._scheduleDownloadsPersist();
    this._emitDownloads();
    return this.getDownloads();
  },

  clearDownloads(): BrowserDownload[] {
    this._loadPersistedDownloads();
    for (const downloadId of this.downloads.keys()) {
      if (!this.activeDownloadItems.has(downloadId)) {
        this.downloads.delete(downloadId);
      }
    }
    this._scheduleDownloadsPersist();
    this._emitDownloads();
    return this.getDownloads();
  },

  async openDownload(downloadId: string): Promise<null> {
    this._loadPersistedDownloads();
    const download = this.downloads.get(downloadId);
    if (!download) throw new Error("Download not found");
    if (download.state !== "completed") {
      throw new Error("Download has not completed");
    }
    if (
      !isPathInsideDirectory(browserDownloadsDirectory(), download.savePath) ||
      !fs.existsSync(download.savePath)
    ) {
      throw new Error("Downloaded file is no longer available");
    }
    const error = await shell.openPath(download.savePath);
    if (error) throw new Error(error);
    return null;
  },

  showDownloadInFolder(downloadId: string): null {
    this._loadPersistedDownloads();
    const download = this.downloads.get(downloadId);
    if (!download) throw new Error("Download not found");
    if (
      !isPathInsideDirectory(browserDownloadsDirectory(), download.savePath) ||
      !fs.existsSync(download.savePath)
    ) {
      throw new Error("Downloaded file is no longer available");
    }
    shell.showItemInFolder(download.savePath);
    return null;
  },

  async createTab(rawUrl = "", ownerKey?: string): Promise<BrowserState> {
    this._loadPersistedTabs();
    const targetOwnerKey = ownerKey ?? this.activeOwnerKey;
    if (Array.from(this.tabs.values()).filter((tab) => tab.ownerKey === targetOwnerKey).length >= MAX_TABS_PER_CONTEXT) {
      throw new Error(`You can open up to ${MAX_TABS_PER_CONTEXT} browser tabs in one chat`);
    }
    const record = createTabRecord(resolveBrowserInput(rawUrl), "New tab", randomUUID(), targetOwnerKey);
    this.tabs.set(record.id, record);
    if (targetOwnerKey === this.activeOwnerKey) await this.activateTab(record.id);
    else {
      this.activeTabIdsByOwner[targetOwnerKey] = record.id;
      this._schedulePersist();
    }
    return this.getState();
  },

  async closeTab(tabId: string): Promise<BrowserState> {
    this._loadPersistedTabs();
    const record = this.tabs.get(tabId);
    if (!record || record.ownerKey !== this.activeOwnerKey) throw new Error("Browser tab not found");
    const orderedIds = Array.from(this.tabs.values())
      .filter((tab) => tab.ownerKey === record.ownerKey)
      .map((tab) => tab.id);
    const closingIndex = orderedIds.indexOf(tabId);
    record.isClosing = true;
    record.deviceEmulationQueue.reset();

    if (record.viewPromise) {
      try {
        await record.viewPromise;
      } catch {
        // Nothing left to close if view creation failed.
      }
    }
    if (record.view && !record.view.webContents.isDestroyed()) {
      if (this.host && !this.host.isDestroyed()) {
        try {
          this.host.contentView.removeChildView(record.view);
        } catch {
          // It may already be detached.
        }
      }
      record.view.webContents.close();
    }
    this.tabs.delete(tabId);

    if (!Array.from(this.tabs.values()).some((tab) => tab.ownerKey === record.ownerKey)) {
      const replacement = createTabRecord(BLANK_URL, "New tab", randomUUID(), record.ownerKey);
      this.tabs.set(replacement.id, replacement);
    }

    if (this.activeTabId === tabId) {
      const remaining = Array.from(this.tabs.values())
        .filter((tab) => tab.ownerKey === record.ownerKey)
        .map((tab) => tab.id);
      this.activeTabId =
        remaining[Math.min(closingIndex, remaining.length - 1)] ?? remaining[0];
      this.activeTabIdsByOwner[record.ownerKey] = this.activeTabId;
      this.selectMode = false;
      this._sendToRenderer(CHANNELS.browser.selectModeChanged, {
        enabled: false,
      });
      await this._mountActiveView();
    }

    this._schedulePersist();
    this._emitState();
    return this.getState();
  },

  async activateTab(tabId: string): Promise<BrowserState> {
    this._loadPersistedTabs();
    const next = this.tabs.get(tabId);
    if (!next || next.ownerKey !== this.activeOwnerKey) throw new Error("Browser tab not found");

    const previous = this.activeTabId ? this.tabs.get(this.activeTabId) : null;
    if (previous && previous.id !== next.id && previous.view) {
      previous.deviceEmulationQueue.cancel();
      if (this.selectMode && !previous.view.webContents.isDestroyed()) {
        try {
          await previous.view.webContents.executeJavaScript(
            buildInspectorScript(false),
          );
        } catch {
          // The previous page may have navigated or closed mid-switch.
        }
      }
      this._snapshotRecord(previous);
      previous.view.setVisible(false);
      if (this.host && !this.host.isDestroyed()) {
        try {
          this.host.contentView.removeChildView(previous.view);
        } catch {
          // It may already be detached.
        }
      }
    }

    if (this.selectMode) {
      this.selectMode = false;
      this._sendToRenderer(CHANNELS.browser.selectModeChanged, {
        enabled: false,
      });
    }
    this.activeTabId = next.id;
    this.activeTabIdsByOwner[this.activeOwnerKey] = next.id;
    await this._mountActiveView();
    this._schedulePersist();
    this._emitState();
    return this.getState();
  },

  setBounds(bounds: BrowserBounds): null {
    const rect: Rectangle = {
      x: Math.max(0, Math.floor(bounds.x)),
      y: Math.max(0, Math.floor(bounds.y)),
      width: Math.max(1, Math.floor(bounds.width)),
      height: Math.max(1, Math.floor(bounds.height)),
    };
    this.bounds = rect;
    const view = this._activeTab().view;
    if (view && !view.webContents.isDestroyed()) {
      view.setBounds(rect);
      this._scheduleDeviceEmulation(this._activeTab());
    }
    return null;
  },

  setVisible(visible: boolean): null {
    const record = this._activeTab();
    const view = record.view;
    if (view && !view.webContents.isDestroyed()) view.setVisible(visible);
    if (!visible) record.deviceEmulationQueue.cancel();
    this.visible = visible;
    if (visible) {
      this._clearIdleTimer();
      this._scheduleDeviceEmulation(record);
      if (view && !view.webContents.isDestroyed()) {
        void record.deviceEmulationQueue.readyAfterPaint(view.webContents);
      }
    } else {
      this._scheduleIdleHibernate();
    }
    return null;
  },

  async navigate(rawInput: string): Promise<null> {
    const record = this._activeTab();
    const view = await this._ensureTabView(record);
    const url = resolveBrowserInput(rawInput);
    record.url = url;
    if (url === BLANK_URL) record.title = "New tab";
    record.deviceEmulationQueue.beginNavigation();
    try {
      await view.webContents.loadURL(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/ERR_FAILED/.test(message)) {
        // Chromium rejects a navigation that becomes a download before
        // Electron emits `will-download`. Give that event one turn to register
        // the matching URL before treating this as a real navigation failure.
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const becameDownload =
        /ERR_FAILED/.test(message) &&
        this.recentDownloadUrls.has(
          downloadNavigationKey(view.webContents.id, url),
        );
      if (!/ERR_ABORTED/.test(message) && !becameDownload) throw error;
    }
    this._syncRecord(record);
    return null;
  },

  async goBack(): Promise<null> {
    const record = this._activeTab();
    const contents = record.view?.webContents;
    if (!contents || contents.isDestroyed()) throw new Error("No browser tab");
    if (contents.navigationHistory.canGoBack()) {
      record.deviceEmulationQueue.beginNavigation();
      contents.navigationHistory.goBack();
    }
    return null;
  },

  async goForward(): Promise<null> {
    const record = this._activeTab();
    const contents = record.view?.webContents;
    if (!contents || contents.isDestroyed()) throw new Error("No browser tab");
    if (contents.navigationHistory.canGoForward()) {
      record.deviceEmulationQueue.beginNavigation();
      contents.navigationHistory.goForward();
    }
    return null;
  },

  async reload(): Promise<null> {
    const record = this._activeTab();
    const contents = record.view?.webContents;
    if (!contents || contents.isDestroyed()) throw new Error("No browser tab");
    record.deviceEmulationQueue.beginNavigation();
    contents.reload();
    return null;
  },

  async stop(): Promise<null> {
    const contents = this._activeTab().view?.webContents;
    if (contents && !contents.isDestroyed()) contents.stop();
    return null;
  },

  async printPage(): Promise<BrowserPrintResult> {
    const contents = this._activeTab().view?.webContents;
    if (!contents || contents.isDestroyed()) throw new Error("No browser tab");

    return new Promise((resolve, reject) => {
      try {
        contents.print(
          { silent: false, printBackground: true },
          (printed, failureReason) => {
            resolve({
              printed,
              ...(failureReason ? { failureReason } : {}),
            });
          },
        );
      } catch (error) {
        reject(error);
      }
    });
  },

  async captureScreenshot(
    mode: BrowserScreenshotMode,
  ): Promise<BrowserSelectionResult> {
    const record = this._activeTab();
    const contents = record.view?.webContents;
    if (!contents || contents.isDestroyed()) throw new Error("No browser tab");

    const id = randomUUID();
    const metrics = await this._readPageMetrics(contents);
    let buffer: Buffer;
    let pageWidth = metrics.viewport.width;
    let pageHeight = metrics.viewport.height;

    if (mode === "fullPage") {
      const captured = await this._captureFullPage(contents, metrics);
      buffer = captured.buffer;
      pageWidth = captured.width;
      pageHeight = captured.height;
    } else {
      const image = await contents.capturePage();
      if (image.isEmpty()) throw new Error("The page produced an empty image");
      buffer = image.toPNG();
    }

    const filePath = this._writeCapture(buffer, `page-${mode}-${id}`);
    const isFullPage = mode === "fullPage";
    return {
      id,
      ownerKey: record.ownerKey,
      type: "browser_selection",
      url: contents.getURL() || record.url || BLANK_URL,
      title: contents.getTitle() || record.title,
      selector: isFullPage ? "html" : "viewport",
      tagName: "page",
      text: "",
      styles: {},
      rect: {
        x: 0,
        y: 0,
        width: isFullPage ? pageWidth : metrics.viewport.width,
        height: isFullPage ? pageHeight : metrics.viewport.height,
      },
      pageRect: {
        x: isFullPage ? 0 : metrics.scroll.x,
        y: isFullPage ? 0 : metrics.scroll.y,
        width: isFullPage ? pageWidth : metrics.viewport.width,
        height: isFullPage ? pageHeight : metrics.viewport.height,
      },
      scroll: metrics.scroll,
      viewport: metrics.viewport,
      devicePixelRatio: metrics.devicePixelRatio,
      componentName: isFullPage
        ? "Full page screenshot"
        : "Page screenshot",
      timestamp: new Date().toISOString(),
      screenshotPath: filePath,
      screenshotCaptureName: captureBasename(filePath),
      screenshotMimeType: "image/png",
    };
  },

  setZoomFactor(factor: number): BrowserNavState {
    const record = this._activeTab();
    const value = clampZoom(factor);
    record.zoomFactor = value;
    const contents = record.view?.webContents;
    if (contents && !contents.isDestroyed()) contents.setZoomFactor(value);
    this._schedulePersist();
    this._emitState();
    return this._tabSummary(record);
  },

  setDeviceEmulation(input: BrowserDeviceEmulation): BrowserState {
    const record = this._activeTab();
    record.deviceEmulation = normalizeBrowserDeviceEmulation(input);
    this._scheduleDeviceEmulation(record);
    this._schedulePersist();
    this._emitState();
    return this.getState();
  },

  findInPage(
    query: string,
    options: { forward?: boolean; findNext?: boolean } = {},
  ): { requestId: number | null } {
    const contents = this._activeTab().view?.webContents;
    if (!contents || contents.isDestroyed()) throw new Error("No browser tab");
    if (!query) {
      contents.stopFindInPage("clearSelection");
      return { requestId: null };
    }
    return {
      requestId: contents.findInPage(query, {
        forward: options.forward ?? true,
        findNext: options.findNext ?? false,
      }),
    };
  },

  stopFindInPage(
    action: "clearSelection" | "keepSelection" = "clearSelection",
  ): null {
    const contents = this._activeTab().view?.webContents;
    if (contents && !contents.isDestroyed()) contents.stopFindInPage(action);
    return null;
  },

  async setSelectMode(enabled: boolean): Promise<{ enabled: boolean }> {
    const contents = this._activeTab().view?.webContents;
    if (!contents || contents.isDestroyed()) {
      this.selectMode = false;
      throw new Error("No browser tab");
    }
    await contents.executeJavaScript(buildInspectorScript(enabled), true);
    this.selectMode = enabled;
    this._sendToRenderer(CHANNELS.browser.selectModeChanged, { enabled });
    return { enabled };
  },

  getNavState(): BrowserNavState {
    return this._tabSummary(this._activeTab());
  },

  deleteCapture(captureName: string): null {
    if (
      !captureName ||
      captureName.includes("/") ||
      captureName.includes("\\") ||
      captureName.includes("..")
    ) {
      throw new Error("Invalid capture name");
    }
    const base = path.resolve(cacheDir());
    const target = path.resolve(path.join(base, captureName));
    if (!target.startsWith(`${base}${path.sep}`)) {
      throw new Error("Path escape denied");
    }
    safeUnlink(target);
    return null;
  },
};
