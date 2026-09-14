import { app, BrowserWindow, shell } from "electron";
import path from "path";
import { existsSync } from "fs";

let aboutWindow: BrowserWindow | null = null;

function getAboutPath(): string {
  if (!app.isPackaged) {
    return path.join(app.getAppPath(), "src/renderer/public/about.html");
  }
  // In production, Vite copies public folder contents to the renderer root.
  return path.join(__dirname, "../renderer/about.html");
}

/**
 * Everything the panel shows, resolved in main and handed over as query params
 * — the page has no preload, so it can't ask for any of this itself.
 */
function aboutValues(): Record<string, string> {
  return {
    version: app.getVersion(),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    os: process.getSystemVersion(),
    arch: process.arch === "arm64" ? "Apple silicon" : "Intel",
    copyright: `© ${new Date().getFullYear()} Mains`,
  };
}

/**
 * The About panel: a small, fixed-size window rendering `about.html`.
 *
 * It replaces the stock `dialog.showMessageBox` about box, which can only ever
 * be an icon beside two lines of text — this one stacks icon, name, and a spec
 * list the way macOS's own About panel does, and can carry app-specific rows.
 */
export function openAboutWindow(): BrowserWindow {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.focus();
    return aboutWindow;
  }

  aboutWindow = new BrowserWindow({
    width: 360,
    height: 470,
    title: "About Mains",
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hidden" as const,
          trafficLightPosition: { x: 12, y: 12 },
          transparent: true,
          vibrancy: "fullscreen-ui" as const,
          visualEffectState: "active" as const,
        }
      : {}),
  });

  // The window ships no preload, so the page can't hand a URL to main. Popups
  // (the mains.dev link's target="_blank") are the one outbound path, and they
  // go to the system browser rather than opening a second Electron window.
  aboutWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const { protocol } = new URL(url);
      if (protocol === "https:" || protocol === "http:") {
        shell.openExternal(url).catch(() => {
          /* user-cancelled / no handler */
        });
      }
    } catch {
      /* invalid URL */
    }
    return { action: "deny" };
  });

  const aboutPath = getAboutPath();
  if (!existsSync(aboutPath)) {
    console.warn("about.html not found at", aboutPath);
  }
  aboutWindow.loadFile(aboutPath, { query: aboutValues() });

  aboutWindow.once("ready-to-show", () => {
    aboutWindow?.show();
  });

  aboutWindow.on("closed", () => {
    aboutWindow = null;
  });

  return aboutWindow;
}

export function getAboutWindow(): BrowserWindow | null {
  return aboutWindow;
}
