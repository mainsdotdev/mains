if (process.platform === "win32") {
  if (require("electron-squirrel-startup")) process.exit(0);
}

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from "electron";

// Disable background Chromium features we never use. `CalculateNativeWinOcclusion`
// in particular can cause steady CPU churn on Windows when the window is hidden.
app.commandLine.appendSwitch(
  "disable-features",
  "HardwareMediaKeyHandling,MediaSessionService,CalculateNativeWinOcclusion",
);

// NOTE: Previously we capped V8 old-space at 512 MB here via `js-flags`. That
// switch propagates to *every* V8 isolate in the Electron process tree —
// including the main process that hosts the Vite dev-server (via
// @electron-forge/plugin-vite). Under that cap V8 thrashed on GC during Vite
// pre-transform, which in turn dragged out concurrent fs.open calls and
// tripped macOS's system-wide file-table limit ("ENFILE: file table
// overflow") during dev starts. The observed memory win was marginal vs. the
// startup fragility, so we leave V8 at its defaults.

// Enable GPU rasterization and compositing for smoother animations on first launch
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
import { spawn, execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { initializeDatabase, closeDatabase } from "./db/client";
import { registerBrowserWindowSink } from "./ipc-kit/browser-window-sink";
import { startBackendServer } from "./serve";
import { registerAccountIpc, unregisterAccountIpc } from "./modules/account";
import { registerSyncIpc, unregisterSyncIpc } from "./modules/sync";
import {
  registerEntitiesHandlers,
  unregisterEntitiesHandlers,
} from "./modules/entities";
import {
  registerConnectionsHandlers,
  unregisterConnectionsHandlers,
} from "./modules/connections";
import { registerSpaceIpc, unregisterSpaceIpc } from "./modules/space";
import {
  registerAppSettingsIpc,
  unregisterAppSettingsIpc,
  appSettingsService,
} from "./modules/appSettings";
import {
  registerProvidersIpc,
  unregisterProvidersIpc,
  shutdownAllWorkAdapters,
} from "./modules/providers";
import { augmentPathForPackagedApp } from "./modules/providers/providers.utils";
import { registerToolsIpc, unregisterToolsIpc } from "./modules/tools";
import {
  registerWorkspaceIpc,
  unregisterWorkspaceIpc,
} from "./modules/workspace";
import { registerRunsIpc, unregisterRunsIpc } from "./modules/runs";
import { runSessionRegistry } from "./modules/runs/run-session-registry";
import { registerProjectsIpc, unregisterProjectsIpc } from "./modules/projects";
import {
  registerCollectionsIpc,
  unregisterCollectionsIpc,
} from "./modules/collections";
import {
  registerFileExplorerIpc,
  unregisterFileExplorerIpc,
} from "./modules/fileExplorer";
import { registerGitFlowIpc, unregisterGitFlowIpc } from "./modules/gitFlow";
import {
  registerTerminalIpc,
  unregisterTerminalIpc,
  destroyAllTerminals,
} from "./modules/terminal";
import { registerStatsIpc, unregisterStatsIpc } from "./modules/stats";
import {
  createMainWindow,
  createSplashWindow,
  closeSplashWindow,
  openAboutWindow,
} from "./windows";
import {
  registerImageProxyScheme,
  registerImageProxyHandler,
  registerImageProxyIpc,
  unregisterImageProxyIpc,
} from "./modules/imageProxy";
import {
  registerUpdatesIpc,
  unregisterUpdatesIpc,
  updatesService,
} from "./modules/updates";
import {
  registerAutomationsIpc,
  unregisterAutomationsIpc,
  automationsService,
} from "./modules/automations";
import {
  registerPulseIpc,
  unregisterPulseIpc,
  pulseService,
} from "./modules/pulse";
import {
  registerGuardsIpc,
  unregisterGuardsIpc,
  shutdownAllGuardAdapters,
} from "./modules/guards";
import {
  registerPullRequestsIpc,
  unregisterPullRequestsIpc,
} from "./modules/pullRequests";
import {
  registerBrowserIpc,
  unregisterBrowserIpc,
  browserService,
} from "./modules/browser";
import { registerSshIpc, unregisterSshIpc, sshService } from "./modules/ssh";
import { tailscaleService } from "./modules/tailscale";
import {
  registerLocalBackendIpc,
  unregisterLocalBackendIpc,
  localBackendService,
} from "./modules/localBackend";
import {
  registerRemoteBackendsIpc,
  unregisterRemoteBackendsIpc,
} from "./modules/remoteBackends";
import { registerBackendIpc, unregisterBackendIpc } from "./modules/backend";
import { CHANNELS } from "../shared/ipc-kit/channels";

// ─────────────────────────────────────────────────────────────
// Installed app detection (macOS)
// ─────────────────────────────────────────────────────────────
const execFileAsync = promisify(execFile);

const KNOWN_APPS = [
  { id: "finder", name: "Finder", bundleId: "com.apple.finder" },
  {
    id: "vscode",
    name: "Visual Studio Code",
    bundleId: "com.microsoft.VSCode",
  },
  { id: "cursor", name: "Cursor", bundleId: "com.todesktop.230313mzl4w4u92" },
  { id: "windsurf", name: "Windsurf", bundleId: "com.exafunction.windsurf" },
  { id: "terminal", name: "Terminal", bundleId: "com.apple.Terminal" },
  { id: "iterm", name: "iTerm2", bundleId: "com.googlecode.iterm2" },
  { id: "warp", name: "Warp", bundleId: "dev.warp.Warp-Stable" },
  { id: "ghostty", name: "Ghostty", bundleId: "com.mitchellh.ghostty" },
  { id: "alacritty", name: "Alacritty", bundleId: "org.alacritty" },
  { id: "kitty", name: "kitty", bundleId: "net.kovidgoyal.kitty" },
  { id: "hyper", name: "Hyper", bundleId: "co.zeit.hyper" },
  { id: "wezterm", name: "WezTerm", bundleId: "com.github.wez.wezterm" },
  { id: "rio", name: "Rio", bundleId: "io.raphamorim.rio" },
  { id: "tabby", name: "Tabby", bundleId: "org.tabby" },
  { id: "xcode", name: "Xcode", bundleId: "com.apple.dt.Xcode" },
  {
    id: "android-studio",
    name: "Android Studio",
    bundleId: "com.google.android.studio",
  },
  { id: "sublime-text", name: "Sublime Text", bundleId: "com.sublimetext.4" },
  { id: "zed", name: "Zed", bundleId: "dev.zed.Zed" },
  { id: "nova", name: "Nova", bundleId: "com.panic.Nova" },
  { id: "fleet", name: "Fleet", bundleId: "com.jetbrains.fleet" },
  { id: "webstorm", name: "WebStorm", bundleId: "com.jetbrains.WebStorm" },
  { id: "intellij", name: "IntelliJ IDEA", bundleId: "com.jetbrains.intellij" },
  { id: "pycharm", name: "PyCharm", bundleId: "com.jetbrains.pycharm" },
  { id: "goland", name: "GoLand", bundleId: "com.jetbrains.goland" },
  { id: "rustrover", name: "RustRover", bundleId: "com.jetbrains.rustrover" },
  { id: "clion", name: "CLion", bundleId: "com.jetbrains.clion" },
  { id: "phpstorm", name: "PhpStorm", bundleId: "com.jetbrains.PhpStorm" },
  { id: "rider", name: "Rider", bundleId: "com.jetbrains.rider" },
  { id: "datagrip", name: "DataGrip", bundleId: "com.jetbrains.datagrip" },
  { id: "bbedit", name: "BBEdit", bundleId: "com.barebones.bbedit" },
  { id: "textmate", name: "TextMate", bundleId: "com.macromates.TextMate" },
  { id: "fork", name: "Fork", bundleId: "com.DanPristupov.Fork" },
  { id: "tower", name: "Tower", bundleId: "com.fournova.Tower3" },
  { id: "sourcetree", name: "Sourcetree", bundleId: "com.torusknot.SourceTreeNotMAS" },
  { id: "gitkraken", name: "GitKraken", bundleId: "com.axosoft.gitkraken" },
  { id: "tableplus", name: "TablePlus", bundleId: "com.tinyapp.TablePlus" },
  { id: "dbeaver", name: "DBeaver", bundleId: "org.jkiss.dbeaver.core.product" },
  { id: "postman", name: "Postman", bundleId: "com.postman.app" },
  { id: "insomnia", name: "Insomnia", bundleId: "com.insomnia.app" },
  { id: "mongodb-compass", name: "MongoDB Compass", bundleId: "com.mongodb.compass" },
  { id: "charles", name: "Charles Proxy", bundleId: "com.xk72.Charles" },
  { id: "proxyman", name: "Proxyman", bundleId: "com.proxyman.NSProxy" },
];

interface DetectedApp {
  id: string;
  name: string;
  bundleId: string;
  path: string;
  icon: string | null;
}

let isShuttingDown = false;
let hasUnsavedChanges = false;
let quitConfirmed = false;
let tray: Tray | null = null;
let installedAppsCache: DetectedApp[] | null = null;
let installedAppsCacheTime = 0;
let detectInFlight: Promise<DetectedApp[]> | null = null;
let persistedAppsLoaded = false;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
/** Bump when `DetectedApp` or `KNOWN_APPS` changes shape — invalidates the disk cache. */
const INSTALLED_APPS_CACHE_VERSION = 1;
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

function appIconsDir(): string {
  const dir = path.join(app.getPath("userData"), "app-icons");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* already exists or permission issue — handled downstream */
  }
  return dir;
}

/**
 * Extract the `.icns` for `appPath` and persist a 64×64 PNG to
 * `userData/app-icons/<id>.png`. Returns a `mains-appicon://icon/<id>.png` URL
 * the renderer can drop into `<img src>` without any base64 buffering.
 *
 * If the PNG already exists and is non-empty we skip the `sips` call —
 * `detectInstalledApps` runs on a 1h cache but the disk copy survives
 * restarts, so this is nearly free on subsequent launches.
 */
async function getAppIcon(
  appPath: string,
  id: string,
): Promise<string | null> {
  try {
    const outPath = path.join(appIconsDir(), `${id}.png`);
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
      return `mains-appicon://icon/${id}.png`;
    }

    // Read CFBundleIconFile from Info.plist
    const { stdout: iconName } = await execFileAsync("defaults", [
      "read",
      `${appPath}/Contents/Info`,
      "CFBundleIconFile",
    ]);
    let iconFile = iconName.trim();
    if (!iconFile) return null;
    if (!iconFile.endsWith(".icns")) iconFile += ".icns";

    const icnsPath = path.join(appPath, "Contents", "Resources", iconFile);
    if (!fs.existsSync(icnsPath)) return null;

    await execFileAsync("sips", [
      "-s",
      "format",
      "png",
      "-z",
      "64",
      "64",
      icnsPath,
      "--out",
      outPath,
    ]);

    if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
      return null;
    }
    return `mains-appicon://icon/${id}.png`;
  } catch {
    return null;
  }
}

/** Apps Launch Services associates with opening a file URL (macOS). */
interface FileHandlerApp {
  bundleId: string;
  name: string;
  path: string;
  icon: string | null;
}

const JXA_LIST_APPS_FOR_FILE = `
function run(argv) {
  if (!argv || argv.length < 1) return "[]";
  var filePath = argv[0];
  try {
    ObjC.import("AppKit");
    var ws = $.NSWorkspace.sharedWorkspace;
    var fileURL = $.NSURL.fileURLWithPath(filePath);
    var appURLs = ws.URLsForApplicationsToOpenURL(fileURL);
    if (!appURLs || appURLs.count === 0) return "[]";
    var out = [];
    var seen = {};
    for (var i = 0; i < appURLs.count; i++) {
      var u = appURLs.objectAtIndex(i);
      var p = ObjC.unwrap(u.path);
      if (seen[p]) continue;
      seen[p] = true;
      out.push(p);
    }
    return JSON.stringify(out);
  } catch (e) {
    return "[]";
  }
}
`.trim();

/** Remove invisible bidi / format characters macOS bundle names sometimes include (e.g. WhatsApp LRM). */
function sanitizeAppDisplayName(raw: string): string {
  return raw
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\u200B-\u200D\uFEFF]/g, "")
    .replace(/^\\u200e/gi, "")
    .trim();
}

async function readAppBundleMetadata(
  appPath: string,
): Promise<{ bundleId: string; name: string } | null> {
  const infoDir = path.join(appPath, "Contents", "Info");
  try {
    const { stdout: bundleIdRaw } = await execFileAsync("defaults", [
      "read",
      infoDir,
      "CFBundleIdentifier",
    ]);
    const bundleId = bundleIdRaw.trim();
    if (!bundleId) return null;

    let name: string | null = null;
    for (const key of ["CFBundleDisplayName", "CFBundleName"]) {
      try {
        const { stdout } = await execFileAsync("defaults", [
          "read",
          infoDir,
          key,
        ]);
        const v = stdout.trim();
        if (v) {
          name = v;
          break;
        }
      } catch {
        /* try next key */
      }
    }
    if (!name) name = path.basename(appPath, ".app");

    return { bundleId, name: sanitizeAppDisplayName(name) };
  } catch {
    return null;
  }
}

async function getMacOSAppsForFile(filePath: string): Promise<FileHandlerApp[]> {
  try {
    const { stdout } = await execFileAsync("osascript", [
      "-l",
      "JavaScript",
      "-e",
      JXA_LIST_APPS_FOR_FILE,
      "--",
      filePath,
    ]);
    const paths = JSON.parse(stdout.trim()) as string[];
    if (!Array.isArray(paths)) return [];

    const metas: FileHandlerApp[] = [];
    const seenBundles = new Set<string>();

    for (const appPath of paths) {
      if (!appPath.endsWith(".app")) continue;
      const meta = await readAppBundleMetadata(appPath);
      if (!meta || seenBundles.has(meta.bundleId)) continue;
      seenBundles.add(meta.bundleId);
      const iconId = `ls_${meta.bundleId.replace(/[^a-zA-Z0-9]/g, "_")}`;
      const icon = await getAppIcon(appPath, iconId);
      metas.push({
        bundleId: meta.bundleId,
        name: meta.name,
        path: appPath,
        icon,
      });
    }

    metas.sort((a, b) => {
      if (a.bundleId === "com.apple.Preview") return -1;
      if (b.bundleId === "com.apple.Preview") return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    return metas;
  } catch (err) {
    console.warn("getMacOSAppsForFile failed:", err);
    return [];
  }
}

// Directories to search for .app bundles (no Spotlight / mdfind needed)
const APP_SEARCH_DIRS = [
  "/Applications",
  "/Applications/Utilities",
  "/System/Applications",
  "/System/Applications/Utilities",
  "/System/Library/CoreServices",
  path.join(app.getPath("home"), "Applications"),
];

/** Run `worker` over `items` with at most `limit` in flight. */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        try {
          await worker(item);
        } catch {
          // one bad bundle shouldn't abort the sweep
        }
      }
    },
  );
  await Promise.all(runners);
}

/** Read a bundle's CFBundleIdentifier, or null if the plist is unreadable. */
async function readBundleId(appPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("defaults", [
      "read",
      path.join(appPath, "Contents", "Info"),
      "CFBundleIdentifier",
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Map every installed bundle id to its `.app` path in a single sweep of
 * APP_SEARCH_DIRS (no mdfind — that triggers the macOS "would like to access
 * data from other apps" privacy prompt).
 *
 * Scanning once and matching against the map is what keeps this cheap: the
 * previous shape asked "where is bundle X?" once per KNOWN_APPS entry, and each
 * of those questions re-walked all ~230 bundles — a full scan for every app the
 * user does *not* have installed. That was ~10k `defaults` spawns (~17s cold).
 * One sweep is one spawn per bundle.
 */
async function scanBundleIdMap(): Promise<Map<string, string>> {
  const appPaths: string[] = [];
  for (const dir of APP_SEARCH_DIRS) {
    let entries: string[];
    try {
      entries = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".app")) continue;
      const appPath = path.join(dir, entry);
      if (!fs.existsSync(path.join(appPath, "Contents", "Info.plist"))) continue;
      appPaths.push(appPath);
    }
  }

  const byBundleId = new Map<string, string>();
  await mapWithConcurrency(appPaths, 12, async (appPath) => {
    const bundleId = await readBundleId(appPath);
    // First match wins — APP_SEARCH_DIRS is ordered by preference.
    if (bundleId && !byBundleId.has(bundleId)) byBundleId.set(bundleId, appPath);
  });
  return byBundleId;
}

function installedAppsCachePath(): string {
  return path.join(app.getPath("userData"), "installed-apps.json");
}

/**
 * Seed the in-memory cache from disk. The scan result outlives the process, so
 * a restart doesn't pay for a cold detection — entries whose `.app` has since
 * been removed are dropped, and icons whose PNG was cleaned out are re-derived
 * on the next refresh.
 */
function loadPersistedInstalledApps(): void {
  if (persistedAppsLoaded) return;
  persistedAppsLoaded = true;
  try {
    const parsed = JSON.parse(
      fs.readFileSync(installedAppsCachePath(), "utf8"),
    ) as { version?: number; detectedAt?: number; apps?: DetectedApp[] };
    if (
      parsed?.version !== INSTALLED_APPS_CACHE_VERSION ||
      !Array.isArray(parsed.apps)
    ) {
      return;
    }
    const iconsDir = appIconsDir();
    installedAppsCache = parsed.apps
      .filter((a) => a && typeof a.path === "string" && fs.existsSync(a.path))
      .map((a) => ({
        ...a,
        icon:
          a.icon && fs.existsSync(path.join(iconsDir, `${a.id}.png`))
            ? a.icon
            : null,
      }));
    installedAppsCacheTime =
      typeof parsed.detectedAt === "number" ? parsed.detectedAt : 0;
  } catch {
    // no cache yet / unreadable — fall back to a full detection
  }
}

function persistInstalledApps(apps: DetectedApp[]): void {
  try {
    fs.writeFileSync(
      installedAppsCachePath(),
      JSON.stringify({
        version: INSTALLED_APPS_CACHE_VERSION,
        detectedAt: Date.now(),
        apps,
      }),
    );
  } catch (err) {
    console.warn("Failed to persist installed-apps cache:", err);
  }
}

/** Full detection sweep. Deduped across concurrent callers via `detectInFlight`. */
function refreshInstalledApps(): Promise<DetectedApp[]> {
  if (detectInFlight) return detectInFlight;

  detectInFlight = (async () => {
    try {
      const byBundleId = await scanBundleIdMap();

      const detected: DetectedApp[] = [];
      for (const knownApp of KNOWN_APPS) {
        const appPath = byBundleId.get(knownApp.bundleId);
        if (!appPath) continue;
        detected.push({
          id: knownApp.id,
          name: knownApp.name,
          bundleId: knownApp.bundleId,
          path: appPath,
          icon: null,
        });
      }

      // Icons are a no-op once the PNG is on disk (see getAppIcon).
      await mapWithConcurrency(detected, 8, async (detectedApp) => {
        detectedApp.icon = await getAppIcon(detectedApp.path, detectedApp.id);
      });

      installedAppsCache = detected;
      installedAppsCacheTime = Date.now();
      persistedAppsLoaded = true;
      persistInstalledApps(detected);
      return detected;
    } finally {
      detectInFlight = null;
    }
  })();

  return detectInFlight;
}

/**
 * Stale-while-revalidate: callers always get whatever we already know
 * immediately, and a stale cache refreshes in the background for next time.
 */
async function detectInstalledApps(): Promise<DetectedApp[]> {
  loadPersistedInstalledApps();

  if (installedAppsCache) {
    if (Date.now() - installedAppsCacheTime >= CACHE_TTL) {
      void refreshInstalledApps().catch((err) =>
        console.warn("Background installed-apps refresh failed:", err),
      );
    }
    return installedAppsCache;
  }

  return refreshInstalledApps();
}

/**
 * The 1x menu-bar asset. macOS loads the `@2x` file sitting beside it on its
 * own, so this path is the only one anything needs to name — and the image
 * must not be resized afterwards, or the crisp representation is thrown away.
 * `menu-icon.png` in the same folder is the master the two are cut from
 * (`sips -z 16 16` / `-z 32 32`). Both must be **black + clear**: a template
 * image is shape, not artwork, and AppKit takes that shape from the black
 * content — the white master rendered as a pale smudge next to the system's
 * own icons until it was recoloured.
 */
function resolveTrayIconPath(): string {
  if (!app.isPackaged) {
    return path.join(app.getAppPath(), "src/renderer/public/menu-iconTemplate.png");
  }
  const packed = path.join(process.resourcesPath, "menu-iconTemplate.png");
  if (fs.existsSync(packed)) return packed;
  return path.join(app.getAppPath(), ".vite/renderer/menu-iconTemplate.png");
}

function focusMainWindow() {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) {
    createMainWindow({ show: true });
    return;
  }
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

function createTray() {
  if (tray) return;

  const sourceImage = nativeImage.createFromPath(resolveTrayIconPath());
  const isMac = process.platform === "darwin";
  // The asset is already menu-bar sized (16pt, with its @2x beside it), so on
  // macOS it goes through untouched: `resize` returns a new image that drops
  // both the extra representation and the template flag. Windows and Linux
  // have no template concept and take whatever they are given, so they keep
  // the explicit 16px.
  const trayImage = isMac
    ? sourceImage
    : sourceImage.resize({ width: 16, height: 16 });

  // Template = the alpha channel is a mask, not artwork: macOS paints it black
  // on a light menu bar and white on a dark one, which is why every other icon
  // up there is crisp and this one used to sit there as a pale glyph. Set
  // explicitly rather than relying on the `…Template.png` filename, which only
  // marks the image at load time.
  if (isMac) trayImage.setTemplateImage(true);

  // Which file this actually resolved to, and whether it arrived as a mask.
  // The three-way path fallback above and the packaging step are both easy to
  // get wrong in a way that only shows up as a pale glyph in the menu bar.
  const trayPath = resolveTrayIconPath();
  console.log(
    `Tray icon: ${trayPath} (exists=${fs.existsSync(trayPath)}, ` +
      `empty=${trayImage.isEmpty()}, template=${trayImage.isTemplateImage()})`,
  );

  tray = new Tray(trayImage);
  tray.setToolTip("Mains");

  const contextMenu = Menu.buildFromTemplate([
    { label: "Show Mains", click: () => focusMainWindow() },
    {
      label: "Check for Updates…",
      click: () => updatesService.checkForUpdates(),
    },
    { type: "separator" },
    { label: "Quit Mains", role: "quit" },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on("click", () => focusMainWindow());
}

/**
 * Headless backend mode. Enabled with `--serve` (or MAINS_SERVE=1); optional
 * `--port=<n>` / `--host=<h>` (or MAINS_SERVE_PORT / MAINS_SERVE_HOST). When on,
 * the app boots the WebSocket backend and creates no window.
 */
function parseServeOptions(): {
  serve: boolean;
  port?: number;
  host?: string;
  token?: string;
  webRoot?: string;
  tailscaleServe?: boolean;
  tailscaleServePort?: number;
} {
  const argv = process.argv;
  const serve = argv.includes("--serve") || process.env.MAINS_SERVE === "1";
  if (!serve) return { serve: false };
  const readArg = (prefix: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : undefined;
  };
  const portRaw = readArg("--port=") ?? process.env.MAINS_SERVE_PORT;
  const port = portRaw !== undefined ? Number(portRaw) : undefined;
  const tsPortRaw =
    readArg("--tailscale-serve-port=") ??
    process.env.MAINS_TAILSCALE_SERVE_PORT;
  const tsPort = tsPortRaw !== undefined ? Number(tsPortRaw) : undefined;
  return {
    serve: true,
    port: port !== undefined && Number.isFinite(port) ? port : undefined,
    host: readArg("--host=") ?? process.env.MAINS_SERVE_HOST,
    token: readArg("--token=") ?? process.env.MAINS_SERVE_TOKEN,
    webRoot: readArg("--web-root=") ?? process.env.MAINS_SERVE_WEB_ROOT,
    tailscaleServe:
      argv.includes("--tailscale-serve") ||
      process.env.MAINS_TAILSCALE_SERVE === "1",
    tailscaleServePort:
      tsPort !== undefined && Number.isFinite(tsPort) ? tsPort : undefined,
  };
}

const SERVE = parseServeOptions();

/**
 * Initialize the application
 */
async function initializeApp() {
  try {
    console.log("Initializing application...");

    // Augment PATH early so provider binaries are discoverable in packaged app.
    // The login-shell read only runs packaged: dev inherits the terminal's PATH.
    augmentPathForPackagedApp(app.isPackaged);

    // Headless backend mode (`--serve`): boot the WebSocket backend and create no
    // window. startBackendServer handles DB init, module registration, and the WS
    // host (which registers the WebSocket event sink). See docs/design/remote-backend.md.
    if (SERVE.serve) {
      await startBackendServer({
        port: SERVE.port,
        host: SERVE.host,
        token: SERVE.token,
        webRoot: SERVE.webRoot,
        tailscaleServe: SERVE.tailscaleServe,
        tailscaleServePort: SERVE.tailscaleServePort,
      });
      console.log("Running in headless --serve mode (no window).");
      return;
    }

    // Show splash screen immediately
    createSplashWindow();

    // Initialize database
    await initializeDatabase({
      verbose: !app.isPackaged,
      enableWAL: true,
      busyTimeout: 5000,
    });

    // Wire the outbound event bus to the local renderer before any module can
    // emit. A headless `mains serve` would register a WebSocket sink instead.
    registerBrowserWindowSink();

    // Register IPC handlers
    registerAccountIpc();
    registerSyncIpc();
    registerEntitiesHandlers();
    registerConnectionsHandlers();
    registerSpaceIpc();
    registerAppSettingsIpc();
    registerProvidersIpc();
    registerToolsIpc();
    registerWorkspaceIpc();
    registerProjectsIpc();
    registerCollectionsIpc();
    registerRunsIpc();
    registerFileExplorerIpc();
    registerGitFlowIpc();
    registerTerminalIpc();
    registerImageProxyHandler();
    registerImageProxyIpc();
    registerStatsIpc();
    registerUpdatesIpc();
    updatesService.initialize();
    registerAutomationsIpc();
    registerPulseIpc();
    registerGuardsIpc();
    registerPullRequestsIpc();
    registerBrowserIpc();
    registerSshIpc();
    registerRemoteBackendsIpc();
    registerBackendIpc();
    registerLocalBackendIpc();
    // Re-apply any persisted "This machine" exposure (survives app restarts).
    void localBackendService.restore();
    automationsService.start();
    pulseService.start();

    // Shell utilities
    ipcMain.handle(CHANNELS.shell.openExternal, async (_, url: string) => {
      if (typeof url !== "string") return;
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return;
      }
      if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
        console.warn(
          "shell:openExternal blocked non-allowed protocol:",
          parsed.protocol,
        );
        return;
      }
      await shell.openExternal(url);
    });
    ipcMain.handle(CHANNELS.shell.openPath, async (_, filePath: string) => {
      if (typeof filePath !== "string" || !path.isAbsolute(filePath)) return;
      const normalized = path.normalize(filePath);
      if (normalized !== filePath) return;
      await shell.openPath(filePath);
    });
    ipcMain.handle(CHANNELS.shell.showItemInFolder, (_, filePath: string) => {
      if (typeof filePath !== "string" || !path.isAbsolute(filePath)) return;
      const normalized = path.normalize(filePath);
      if (normalized !== filePath) return;
      shell.showItemInFolder(filePath);
    });
    ipcMain.handle(
      CHANNELS.shell.openInApp,
      async (_, appId: string, filePath: string) => {
        if (process.platform !== "darwin") return;
        const known = KNOWN_APPS.find((a) => a.id === appId);
        if (!known) return;
        const child = spawn("open", ["-b", known.bundleId, filePath], {
          detached: true,
          stdio: "ignore",
        });
        child.unref();
        child.on("error", (err) =>
          console.warn("shell:openInApp spawn error:", err),
        );
      },
    );
    ipcMain.handle(CHANNELS.shell.getInstalledApps, async () => {
      if (process.platform !== "darwin") {
        return { success: true, data: [] };
      }
      try {
        const apps = await detectInstalledApps();
        return { success: true, data: apps };
      } catch (error) {
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to detect apps",
        };
      }
    });

    ipcMain.handle(CHANNELS.shell.getAppsForFile, async (_, filePath: string) => {
      if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
        return { success: false, error: "Invalid path" };
      }
      const normalized = path.normalize(filePath);
      if (normalized !== filePath) {
        return { success: false, error: "Invalid path" };
      }
      if (process.platform !== "darwin") {
        return { success: true, data: [] };
      }
      try {
        const data = await getMacOSAppsForFile(normalized);
        return { success: true, data };
      } catch (error) {
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to list applications",
        };
      }
    });

    ipcMain.handle(
      CHANNELS.shell.openFileWithBundle,
      async (_, filePath: string, bundleId: string) => {
        if (typeof filePath !== "string" || typeof bundleId !== "string") {
          return { success: false, error: "Invalid arguments" };
        }
        if (!path.isAbsolute(filePath)) {
          return { success: false, error: "Invalid path" };
        }
        const normalized = path.normalize(filePath);
        if (normalized !== filePath) {
          return { success: false, error: "Invalid path" };
        }
        if (process.platform !== "darwin") {
          return { success: false, error: "Unsupported platform" };
        }
        const apps = await getMacOSAppsForFile(normalized);
        if (!apps.some((a) => a.bundleId === bundleId)) {
          return {
            success: false,
            error: "App is not registered to open this file",
          };
        }
        try {
          const child = spawn("open", ["-b", bundleId, normalized], {
            detached: true,
            stdio: "ignore",
          });
          child.unref();
          child.on("error", (err) =>
            console.warn("shell:openFileWithBundle spawn error:", err),
          );
          return { success: true };
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : "open failed",
          };
        }
      },
    );

    ipcMain.handle(CHANNELS.app.setUnsavedChanges, (_, value: boolean) => {
      hasUnsavedChanges = value;
    });

    // Build custom application menu
    const template: Electron.MenuItemConstructorOptions[] = [
      ...(process.platform === "darwin"
        ? [{
            label: app.name,
            submenu: [
              {
                label: "About Mains",
                click: () => openAboutWindow(),
              },
              {
                label: "Check for Updates…",
                click: () => updatesService.checkForUpdates(),
              },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          }]
        : []),
      { role: "fileMenu" as const },
      { role: "editMenu" as const },
      {
        label: "View",
        submenu: app.isPackaged
          ? [
              { role: "toggleDevTools" as const },
              { type: "separator" as const },
              { role: "resetZoom" as const },
              { role: "zoomIn" as const },
              { role: "zoomOut" as const },
              { type: "separator" as const },
              { role: "togglefullscreen" as const },
            ]
          : [
              { role: "reload" as const },
              { role: "forceReload" as const },
              { role: "toggleDevTools" as const },
              { type: "separator" as const },
              { role: "resetZoom" as const },
              { role: "zoomIn" as const },
              { role: "zoomOut" as const },
              { type: "separator" as const },
              { role: "togglefullscreen" as const },
            ],
      },
      { role: "windowMenu" as const },
      {
        role: "help",
        submenu: [
          {
            label: "Documentation",
            click: () => shell.openExternal("https://docs.mains.dev"),
          },
          {
            label: "Report a Bug",
            click: () => shell.openExternal("https://github.com/mainsdotdev/mains/issues"),
          },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));

    // Create menu bar (tray) icon — respects user preference
    try {
      const settings = await appSettingsService.ensureSettings();
      if (settings.showMenuBarIcon) createTray();
    } catch (err) {
      console.warn("Failed to read menu bar icon preference, defaulting to shown:", err);
      createTray();
    }

    // IPC: toggle menu bar icon visibility at runtime
    ipcMain.handle(CHANNELS.app.setMenuBarIconVisible, (_, visible: boolean) => {
      if (visible) {
        createTray();
      } else {
        destroyTray();
      }
    });

    // Create main window (hidden until ready)
    createMainWindow({
      show: false,
      onReadyToShow: (window) => {
        // Close splash and show main window
        closeSplashWindow();
        window.show();

        // Warm the installed-app cache off the critical path so the workspace
        // "Open with" submenu is already populated the first time it opens.
        if (process.platform === "darwin") {
          setTimeout(() => {
            void detectInstalledApps().catch((err) =>
              console.warn("Installed-apps warmup failed:", err),
            );
          }, 1500);
        }

        // Check for updates after a short delay
        setTimeout(() => {
          updatesService.checkForUpdates();
        }, 3000);
      },
    });

    console.log("Application initialized successfully");
  } catch (error) {
    console.error("Failed to initialize application:", error);
    closeSplashWindow();
    app.quit();
  }
}

/**
 * Cleanup before app quits
 */
async function cleanupApp() {
  try {
    console.log("Cleaning up application...");

    // Destroy tray
    destroyTray();

    // Destroy all terminal PTY instances
    destroyAllTerminals();

    // Tear down any open SSH tunnels
    sshService.closeAllTunnels();

    // Tear down the in-app exposure (WS host + tailscale serve), if any
    await localBackendService.shutdown();
    // Stop `tailscale serve` if this process started it (no-op otherwise)
    await tailscaleService.stopServeIfActive();

    // Shutdown work adapters (Copilot, Claude Code, etc.)
    await shutdownAllWorkAdapters();

    // Force-finalize any active run sessions (releases sleep blockers,
    // marks runs as failed in DB so they don't sit as "running" across restart)
    runSessionRegistry.shutdownAll();

    // Unregister IPC handlers
    unregisterAccountIpc();
    unregisterAppSettingsIpc();
    unregisterSyncIpc();
    unregisterSpaceIpc();
    unregisterConnectionsHandlers();
    unregisterEntitiesHandlers();
    unregisterProvidersIpc();
    unregisterToolsIpc();
    unregisterWorkspaceIpc();
    unregisterProjectsIpc();
    unregisterCollectionsIpc();
    unregisterRunsIpc();
    unregisterFileExplorerIpc();
    unregisterGitFlowIpc();
    unregisterTerminalIpc();
    unregisterImageProxyIpc();
    unregisterStatsIpc();
    unregisterUpdatesIpc();
    automationsService.stop();
    unregisterAutomationsIpc();
    pulseService.stop();
    unregisterPulseIpc();
    unregisterGuardsIpc();
    unregisterPullRequestsIpc();
    await shutdownAllGuardAdapters();
    try { browserService.destroy(); } catch { /* ignore */ }
    unregisterBrowserIpc();
    unregisterSshIpc();
    unregisterRemoteBackendsIpc();
    unregisterBackendIpc();
    unregisterLocalBackendIpc();
    ipcMain.removeHandler(CHANNELS.shell.openExternal);
    ipcMain.removeHandler(CHANNELS.shell.openPath);
    ipcMain.removeHandler(CHANNELS.shell.showItemInFolder);
    ipcMain.removeHandler(CHANNELS.shell.openInApp);
    ipcMain.removeHandler(CHANNELS.shell.getInstalledApps);
    ipcMain.removeHandler(CHANNELS.shell.getAppsForFile);
    ipcMain.removeHandler(CHANNELS.shell.openFileWithBundle);
    ipcMain.removeHandler(CHANNELS.app.setUnsavedChanges);
    ipcMain.removeHandler(CHANNELS.app.setMenuBarIconVisible);

    // Close database
    await closeDatabase();

    console.log("Application cleanup completed");
  } catch (error) {
    console.error("Error during cleanup:", error);
  }
}

// Single instance lock — prevent multiple app instances
// Skip the single-instance lock in headless --serve mode so a backend can run
// alongside a local GUI instance (e.g. for testing).
if (!SERVE.serve) {
  const gotTheLock = app.requestSingleInstanceLock();

  if (!gotTheLock) {
    // Another instance is already running, quit this one
    app.quit();
  } else {
    app.on("second-instance", () => {
      // Someone tried to open a second instance — focus the existing window
      const allWindows = BrowserWindow.getAllWindows();
      if (allWindows.length > 0) {
        const win = allWindows[0];
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    });
  }
}

// Ensure app name is "Mains" even in dev (Electron Forge defaults to "Electron")
if (!app.isPackaged) {
  app.setName("Mains");
}
// The display name is "Mains", but userData has always lived under the
// lowercase dir — pin it so existing installs keep their data even on
// case-sensitive filesystems.
app.setPath("userData", path.join(app.getPath("appData"), "mains"));

// Custom About panel
app.setAboutPanelOptions({
  applicationName: "Mains",
  applicationVersion: app.getVersion(),
  copyright: "© 2026 Mains",
  website: "https://mains.dev",
});

// Register custom protocol scheme (must be before app.ready)
registerImageProxyScheme();

// App lifecycle events
app.whenReady().then(initializeApp);

app.on("activate", () => {
  if (SERVE.serve) return; // headless backend has no window to re-create
  // On macOS it's common to re-create a window when dock icon is clicked
  const allWindows = BrowserWindow.getAllWindows();
  if (allWindows.length === 0) {
    createMainWindow({ show: true });
  } else {
    // Focus existing window instead of creating a new one
    const win = allWindows[0];
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on("window-all-closed", () => {
  if (SERVE.serve) return; // headless backend stays alive without windows
  // On macOS, applications stay active until user quits explicitly
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async (event) => {
  if (isShuttingDown) {
    return;
  }

  // Show confirmation if there are unsaved changes
  if (hasUnsavedChanges && !quitConfirmed) {
    event.preventDefault();
    const { response } = await dialog.showMessageBox({
      type: "question",
      buttons: ["Save & Quit", "Quit without saving", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      title: "Unsaved Changes",
      message: "You have unsaved changes.",
      detail: "Do you want to save before quitting?",
    });

    if (response === 2) {
      return; // Cancel — don't quit
    }

    if (response === 0) {
      // Save & Quit — notify renderer to flush, then quit
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        win.webContents.send(CHANNELS.app.flushAndQuit);
        // Give renderer time to save
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    quitConfirmed = true;
  }

  event.preventDefault();
  isShuttingDown = true;
  await cleanupApp();
  app.exit(0);
});

// Handle graceful shutdown signals
async function handleShutdownSignal(signal: string) {
  if (isShuttingDown) {
    console.log(`Already shutting down, ignoring ${signal}`);
    return;
  }
  isShuttingDown = true;

  console.log(`Received ${signal}, shutting down gracefully...`);

  try {
    await cleanupApp();
  } catch (error) {
    // Ignore stream-destroyed errors during shutdown
    if (
      !(
        error instanceof Error && error.message.includes("ERR_STREAM_DESTROYED")
      )
    ) {
      console.error("Error during graceful shutdown:", error);
    }
  }

  process.exit(0);
}

process.on("SIGINT", () => handleShutdownSignal("SIGINT"));
process.on("SIGTERM", () => handleShutdownSignal("SIGTERM"));

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  // Suppress stream-destroyed errors during shutdown
  if (isShuttingDown && error.message?.includes("ERR_STREAM_DESTROYED")) {
    return;
  }
  console.error("Uncaught exception:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  // Suppress stream-destroyed errors during shutdown
  if (
    isShuttingDown &&
    reason instanceof Error &&
    reason.message?.includes("ERR_STREAM_DESTROYED")
  ) {
    return;
  }
  console.error("Unhandled rejection at:", promise, "reason:", reason);
});
