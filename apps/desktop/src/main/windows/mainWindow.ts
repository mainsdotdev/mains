import { app, BrowserWindow, nativeImage, screen, shell } from "electron";
import path from "path";
import fs, { existsSync } from "fs";
import { CHANNELS } from "../../shared/ipc-kit/channels";

let mainWindow: BrowserWindow | null = null;

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
  onReadyToShow?: (window: BrowserWindow) => void;
}

// Get icon path based on app path
function getIconPath(): string {
  if (!app.isPackaged) {
    // Development: icon is in src/renderer/public
    return path.join(app.getAppPath(), "src/renderer/public/icon.png");
  }
  // Production: try extraResource first, then inside .vite/renderer
  const resourcePath = path.join(process.resourcesPath, "icon.png");
  if (existsSync(resourcePath)) {
    return resourcePath;
  }
  return path.join(app.getAppPath(), ".vite/renderer/icon.png");
}

export function createMainWindow(options: MainWindowOptions = {}): BrowserWindow {
  const { show = true, onReadyToShow } = options;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return mainWindow;
  }

  const defaults = screen.getPrimaryDisplay().workAreaSize;
  const saved = loadWindowState();
  const useSaved = saved && isStateVisible(saved);

  const iconPath = getIconPath();

  // Set dock icon on macOS
  if (process.platform === "darwin" && app.dock) {
    try {
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) {
        app.dock.setIcon(icon);
      }
    } catch (e) {
      console.warn("Failed to set dock icon:", e);
    }
  }

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

  // Restore maximized state
  if (useSaved && saved.isMaximized) {
    mainWindow.maximize();
  }

  // Save state on resize/move
  const persistState = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      saveWindowState(mainWindow);
    }
  };
  mainWindow.on("resize", persistState);
  mainWindow.on("move", persistState);
  mainWindow.on("maximize", persistState);
  mainWindow.on("unmaximize", persistState);

  // Handle ready-to-show event
  mainWindow.once("ready-to-show", () => {
    if (onReadyToShow && mainWindow) {
      onReadyToShow(mainWindow);
    } else if (show && mainWindow) {
      mainWindow.show();
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
    mainWindow = null;
  });

  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
