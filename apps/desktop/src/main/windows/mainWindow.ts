import { app, BrowserWindow, screen, shell } from "electron";
import path from "path";
import fs from "fs";
import { CHANNELS } from "@mains/contracts/channels";
import { attachCrashRecovery } from "./crash-recovery";
import { getAppIconPath, getSavedDockIcon } from "./dock-icon";
import { createOnboardingWindowState } from "./onboarding-window";
import { createOnboardingStartupState } from "./onboarding-startup";

let mainWindow: BrowserWindow | null = null;
let onboardingWindow: ReturnType<typeof createOnboardingWindowState> | null = null;
let onboardingStartup: ReturnType<typeof createOnboardingStartupState> | null = null;
let resolveWindowPresentation: (() => void) | null = null;
/** Whether this process has ever shown a main window (false under `--serve`). */
let hasOpenedMainWindow = false;

// ── Window state persistence ──────────────────────────────────

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized?: boolean;
}

function getStatePath(): string {
  return path.join(app.getPath("userData"), "window-state.json");
}

function loadWindowState(): WindowState | null {
  try {
    const data = fs.readFileSync(getStatePath(), "utf-8");
    return JSON.parse(data) as WindowState;
  } catch {
    return null;
  }
}

function saveWindowState(win: BrowserWindow): void {
  const isMaximized = win.isMaximized();
  const bounds = isMaximized ? win.getNormalBounds() : win.getBounds();

  const state: WindowState = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized,
  };

  try {
    fs.writeFileSync(getStatePath(), JSON.stringify(state));
  } catch {
    // Ignore write errors
  }
}

function isStateVisible(state: WindowState): boolean {
  const displays = screen.getAllDisplays();
  return displays.some((display) => {
    const { x, y, width, height } = display.bounds;
    return (
      (state.x ?? 0) >= x - 100 &&
      (state.y ?? 0) >= y - 100 &&
      (state.x ?? 0) < x + width + 100 &&
      (state.y ?? 0) < y + height + 100
    );
  });
}

export interface MainWindowOptions {
  show?: boolean;
  showStartupSplash?: boolean;
  onReadyToShow?: (window: BrowserWindow) => void;
}

export function createMainWindow(options: MainWindowOptions = {}): BrowserWindow {
  const { show = true, showStartupSplash = false, onReadyToShow } = options;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return mainWindow;
  }

  const defaults = screen.getPrimaryDisplay().workAreaSize;
  const saved = loadWindowState();
  const useSaved = saved && isStateVisible(saved);

  const iconPath = getAppIconPath(getSavedDockIcon());

  hasOpenedMainWindow = true;
  mainWindow = new BrowserWindow({
    width: useSaved ? saved.width : defaults.width,
    height: useSaved ? saved.height : defaults.height,
    ...(useSaved && saved.x !== undefined && saved.y !== undefined
      ? { x: saved.x, y: saved.y }
      : {}),
    minWidth: 800,
    title: "Mains",
    minHeight: 600,
    icon: iconPath,
    show: false, // Always create hidden, control visibility via ready-to-show
    webPreferences: {
      preload: path.join(__dirname, "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: !app.isPackaged,
      // Throttle timers/rAF when the window is hidden/occluded — saves
      // significant CPU and GPU when the user switches away. Streaming IPC
      // events still arrive via `webContents.send` regardless of throttling.
      backgroundThrottling: true,
    },
    ...(process.platform === "darwin" ? {
      titleBarStyle: "hiddenInset" as const,
      trafficLightPosition: { x: 16, y: 16 },
      transparent: true,
      vibrancy: "fullscreen-ui" as const,
      visualEffectState: "active" as const,
    } : {}),
  });

  const window = mainWindow;
  const presentation = createOnboardingWindowState(window, Boolean(useSaved && saved.isMaximized));
  onboardingWindow = presentation;
  const startup = createOnboardingStartupState(showStartupSplash);
  onboardingStartup = startup;
  let resolvePresentation!: () => void;
  const presentationReady = new Promise<void>((resolve) => { resolvePresentation = resolve; });
  resolveWindowPresentation = resolvePresentation;

  // Save state on resize/move
  const persistState = () => {
    if (!window.isDestroyed() && !presentation.isTemporary()) {
      saveWindowState(window);
    }
  };
  mainWindow.on("resize", persistState);
  mainWindow.on("move", persistState);
  mainWindow.on("maximize", persistState);
  mainWindow.on("unmaximize", persistState);

  // Handle ready-to-show event
  mainWindow.once("ready-to-show", async () => {
    // Wait for the rehydrated onboarding flag before exposing the window. A
    // broken renderer still gets a visible window for the recovery UI.
    const fallback = setTimeout(() => {
      void presentation.setOnboarding(startup.needsOnboarding()).then(resolvePresentation, (error) => {
        console.error("Unable to initialize window presentation", error);
        resolvePresentation();
      });
    }, 3000);
    await presentationReady;
    clearTimeout(fallback);
    if (window.isDestroyed()) return;
    startup.finish();
    if (onReadyToShow) {
      onReadyToShow(window);
    } else if (show) {
      window.show();
    }
  });

  // Disable Cmd/Ctrl+R reload
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if ((input.meta || input.control) && input.key === "r") {
      event.preventDefault();
    }
  });

  // Handle load failures
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    console.error(`Failed to load: ${errorDescription} (${errorCode})`);
  });

  // A crashed or hung renderer must not leave an empty window behind.
  attachCrashRecovery(mainWindow);

  // Load the app
  // In development, Electron Forge's Vite plugin injects the dev server URL
  // via compile-time define (process.env.RENDERER_VITE_DEV_SERVER_URL)
  const devServerUrl =
    process.env.VITE_DEV_SERVER_URL ||
    process.env.RENDERER_VITE_DEV_SERVER_URL ||
    "http://localhost:5173";

  // Same allowlist as `shell:openExternal` IPC handler in main/index.ts —
  // restricts which URL schemes can hand off to the OS.
  const ALLOWED_EXTERNAL = new Set(["https:", "http:", "mailto:"]);
  const openExternalSafe = (url: string) => {
    try {
      const parsed = new URL(url);
      if (ALLOWED_EXTERNAL.has(parsed.protocol)) {
        shell.openExternal(url).catch(() => { /* user-cancelled / no handler */ });
      }
    } catch { /* invalid URL */ }
  };

  // Route all popup attempts (window.open, target="_blank") to the user's
  // default browser. Denies in-app popups inheriting webPreferences/preload.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: "deny" };
  });

  // Block the renderer from navigating the main window off the app shell.
  // Permits the Vite dev server (dev) and file:// (packaged). Anything else
  // — typically an external link clicked inside the renderer — is routed
  // to the system browser instead of replacing the app UI.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const isDev = !app.isPackaged && url.startsWith(devServerUrl);
    const isFile = url.startsWith("file://");
    if (isDev || isFile) return;
    event.preventDefault();
    openExternalSafe(url);
  });

  if (!app.isPackaged) {
    // Development mode - load from Vite dev server
    mainWindow.loadURL(devServerUrl);
  } else {
    // Production mode - load from built files
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("enter-full-screen", () => {
    mainWindow?.webContents.send(CHANNELS.app.fullscreenChange, true);
  });
  mainWindow.on("leave-full-screen", () => {
    mainWindow?.webContents.send(CHANNELS.app.fullscreenChange, false);
  });

  mainWindow.on("closed", () => {
    startup.finish();
    resolvePresentation();
    onboardingWindow = null;
    onboardingStartup = null;
    resolveWindowPresentation = null;
    mainWindow = null;
  });

  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

/** Only the main renderer controls its temporary onboarding presentation. */
export async function setMainWindowOnboarding(onboarding: boolean, contentReady = true): Promise<void> {
  const presentation = onboardingWindow;
  const startup = onboardingStartup;
  const ready = resolveWindowPresentation;
  if (!presentation || !startup) throw new Error("Main window is not available");
  if (!startup.update(onboarding, contentReady)) return;
  try {
    await presentation.setOnboarding(onboarding);
  } finally {
    // The boot announcement prepares bounds/splash, but only mounted content
    // releases the hidden main window.
    if (contentReady) ready?.();
  }
}

/**
 * Bring the main window to the front, re-creating it if the user closed it
 * (macOS keeps the app running with no window). Returns null in a process that
 * never opened one — a headless `--serve` backend must not grow a window
 * because someone clicked a notification.
 */
export function reopenMainWindow(): BrowserWindow | null {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return hasOpenedMainWindow ? createMainWindow({ show: true }) : null;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  return mainWindow;
}
