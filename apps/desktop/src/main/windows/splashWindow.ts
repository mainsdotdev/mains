import { app, BrowserWindow, screen } from "electron";
import path from "path";

let splashWindow: BrowserWindow | null = null;

export interface SplashWindowOptions {
  backgroundColor?: string;
}

const DEFAULT_OPTIONS: Required<SplashWindowOptions> = {
  backgroundColor: "#00000000",
};

function getSplashPath(): string {
  if (!app.isPackaged) {
    return path.join(app.getAppPath(), "src/renderer/public/splash.html");
  }
  // In production, Vite copies public folder contents to renderer root
  return path.join(__dirname, "../renderer/splash.html");
}

export function createSplashWindow(
  options: SplashWindowOptions = {},
): BrowserWindow {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  splashWindow = new BrowserWindow({
    width,
    height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: opts.backgroundColor,
    hasShadow: false,
    // Same vibrancy material as the main window (mainWindow.ts) so the splash
    // background reads identically to the onboarding/main background.
    vibrancy: "fullscreen-ui",
    visualEffectState: "active",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  const splashPath = getSplashPath();
  splashWindow.loadFile(splashPath);

  splashWindow.once("ready-to-show", () => {
    splashWindow?.show();
  });

  splashWindow.on("closed", () => {
    splashWindow = null;
  });

  return splashWindow;
}

export function closeSplashWindow(): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
}

export function getSplashWindow(): BrowserWindow | null {
  return splashWindow;
}
