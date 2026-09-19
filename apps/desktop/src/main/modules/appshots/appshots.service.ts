import {
  app,
  desktopCapturer,
  globalShortcut,
  shell,
  systemPreferences,
} from "electron";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { CHANNELS } from "../../../shared/ipc-kit/channels";
import {
  DEFAULT_APPSHOT_SHORTCUT,
  type AppshotAccessibilityStatus,
  type AppshotCapture,
  type AppshotScreenPermission,
  type AppshotShortcut,
  type AppshotsConfiguration,
  type AppshotsStatus,
  type AppshotsSystemSettingsPane,
} from "../../../shared/appshots";
import { createMainWindow, getMainWindow } from "../../windows";
import { appSettingsService } from "../appSettings";
import { findWindowSource, parseFrontmostWindow } from "./appshots.capture";
import { normalizedAppshotShortcut } from "./appshots.validation";

const execFileAsync = promisify(execFile);
const CAPTURE_CACHE_MAX_BYTES = 100 * 1024 * 1024;
const MAX_PENDING_CAPTURES = 8;
const MAX_ACCESSIBILITY_CHARS = 30_000;

const FRONTMOST_WINDOW_SCRIPT = String.raw`
ObjC.import("Cocoa");
ObjC.import("CoreGraphics");

function unwrap(value) {
  try {
    const result = ObjC.unwrap(value);
    return result === undefined ? null : result;
  } catch (_) {
    return null;
  }
}

const front = $.NSWorkspace.sharedWorkspace.frontmostApplication;
const processId = Number(front.processIdentifier);
const appName = String(unwrap(front.localizedName) || "Unknown app");
const bundleIdentifierValue = unwrap(front.bundleIdentifier);
const raw = $.CGWindowListCopyWindowInfo(
  $.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements,
  $.kCGNullWindowID
);
const count = Number($.CFArrayGetCount(raw));
let windowId = 0;
let windowTitle = "";

for (let index = 0; index < count; index += 1) {
  const info = ObjC.castRefToObject($.CFArrayGetValueAtIndex(raw, index));
  const ownerPid = Number(unwrap(info.objectForKey("kCGWindowOwnerPID")));
  const layer = Number(unwrap(info.objectForKey("kCGWindowLayer")));
  const alpha = Number(unwrap(info.objectForKey("kCGWindowAlpha")));
  if (ownerPid !== processId || layer !== 0 || alpha <= 0) continue;
  windowId = Number(unwrap(info.objectForKey("kCGWindowNumber")) || 0);
  windowTitle = String(unwrap(info.objectForKey("kCGWindowName")) || "");
  if (windowId > 0) break;
}

JSON.stringify({
  appName,
  bundleIdentifier: bundleIdentifierValue
    ? String(bundleIdentifierValue)
    : null,
  processId,
  windowId,
  windowTitle,
});
`;

const ACCESSIBILITY_TEXT_SCRIPT = String.raw`
function run(argv) {
  const MAX_ELEMENTS = 700;
  const MAX_CHARS = ${MAX_ACCESSIBILITY_CHARS};
  const processId = Number(argv[0]);
  const systemEvents = Application("System Events");

  function flatten(value, output) {
    if (!Array.isArray(value)) {
      output.push(value);
      return;
    }
    value.forEach(function (item) { flatten(item, output); });
  }

  function read(getter) {
    try {
      const value = getter();
      if (value === null || value === undefined) return "";
      const text = String(value).replace(/\s+/g, " ").trim();
      return text.length > 500 ? text.slice(0, 500) + "…" : text;
    } catch (_) {
      return "";
    }
  }

  const processes = systemEvents.applicationProcesses.whose({ unixId: processId })();
  if (!processes.length) return JSON.stringify({ text: "", truncated: false });
  const windows = processes[0].windows();
  if (!windows.length) return JSON.stringify({ text: "", truncated: false });

  const flattened = [];
  flatten(windows[0].entireContents(), flattened);
  const lines = [];
  const seen = new Set();
  let characters = 0;
  let truncated = flattened.length > MAX_ELEMENTS;

  for (let index = 0; index < flattened.length && index < MAX_ELEMENTS; index += 1) {
    const element = flattened[index];
    const role = read(function () { return element.role(); });
    const subrole = read(function () { return element.subrole(); });
    if ((role + " " + subrole).indexOf("SecureTextField") !== -1) continue;
    const candidates = [
      read(function () { return element.name(); }),
      read(function () { return element.value(); }),
      read(function () { return element.description(); }),
      read(function () { return element.help(); }),
    ];
    const localSeen = new Set();
    const content = candidates.filter(function (part) {
      if (!part || localSeen.has(part)) return false;
      localSeen.add(part);
      return true;
    });
    if (!content.length) continue;
    const line = (role ? "[" + role + "] " : "") + content.join(" | ");
    if (seen.has(line)) continue;
    if (characters + line.length + 1 > MAX_CHARS) {
      truncated = true;
      break;
    }
    seen.add(line);
    lines.push(line);
    characters += line.length + 1;
  }

  return JSON.stringify({ text: lines.join("\n"), truncated: truncated });
}
`;

const SETTINGS_URLS: Record<AppshotsSystemSettingsPane, string> = {
  "screen-recording":
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  accessibility:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  automation:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
};

let enabled = true;
let shortcut: AppshotShortcut = DEFAULT_APPSHOT_SHORTCUT;
let shortcutRegistered = false;
let capturing = false;
let lastError: string | null = null;
let pendingCaptures: AppshotCapture[] = [];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function captureDirectory(): string {
  const directory = path.join(app.getPath("userData"), "browser-captures");
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function pruneCaptureCache(): void {
  try {
    const entries = fs
      .readdirSync(captureDirectory())
      .map((name) => {
        const fullPath = path.join(captureDirectory(), name);
        try {
          const stat = fs.statSync(fullPath);
          return stat.isFile()
            ? { fullPath, modifiedAt: stat.mtimeMs, size: stat.size }
            : null;
        } catch {
          return null;
        }
      })
      .filter(
        (
          entry,
        ): entry is { fullPath: string; modifiedAt: number; size: number } =>
          entry !== null,
      )
      .sort((a, b) => a.modifiedAt - b.modifiedAt);
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of entries) {
      if (total <= CAPTURE_CACHE_MAX_BYTES) break;
      try {
        fs.unlinkSync(entry.fullPath);
        total -= entry.size;
      } catch {
        // Best-effort cache eviction.
      }
    }
  } catch {
    // Best-effort cache eviction.
  }
}

function screenPermission(): AppshotScreenPermission {
  if (process.platform !== "darwin") return "unknown";
  try {
    return systemPreferences.getMediaAccessStatus(
      "screen",
    ) as AppshotScreenPermission;
  } catch {
    return "unknown";
  }
}

function accessibilityTrusted(prompt = false): boolean {
  if (process.platform !== "darwin") return false;
  try {
    return systemPreferences.isTrustedAccessibilityClient(prompt);
  } catch {
    return false;
  }
}

async function frontmostWindow() {
  const { stdout } = await execFileAsync(
    "/usr/bin/osascript",
    ["-l", "JavaScript", "-e", FRONTMOST_WINDOW_SCRIPT],
    { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 3_000 },
  );
  return parseFrontmostWindow(stdout);
}

async function accessibleText(processId: number): Promise<{
  text: string;
  status: AppshotAccessibilityStatus;
  truncated: boolean;
}> {
  if (!accessibilityTrusted(false)) {
    return { text: "", status: "permission-denied", truncated: false };
  }
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", ACCESSIBILITY_TEXT_SCRIPT, String(processId)],
      { encoding: "utf8", maxBuffer: 256 * 1024, timeout: 4_000 },
    );
    const parsed = JSON.parse(stdout.trim()) as {
      text?: unknown;
      truncated?: unknown;
    };
    return {
      text:
        typeof parsed.text === "string"
          ? parsed.text.slice(0, MAX_ACCESSIBILITY_CHARS)
          : "",
      status: "captured",
      truncated: parsed.truncated === true,
    };
  } catch (error) {
    console.warn("[appshots] accessibility extraction failed:", messageOf(error));
    return { text: "", status: "unavailable", truncated: false };
  }
}

function unregisterShortcut(): void {
  if (shortcutRegistered) {
    globalShortcut.unregister(shortcut);
    shortcutRegistered = false;
  }
}

function emitError(message: string): void {
  const window = getMainWindow();
  if (window && !window.isDestroyed()) {
    window.webContents.send(CHANNELS.appshots.error, { message });
  }
}

function registerShortcut(): boolean {
  if (!enabled || process.platform !== "darwin") return false;
  try {
    shortcutRegistered = globalShortcut.register(shortcut, () => {
      if (capturing) return;
      void appshotsService.captureAndDeliver().catch((error) => {
        lastError = messageOf(error);
        emitError(lastError);
      });
    });
  } catch (error) {
    shortcutRegistered = false;
    lastError = messageOf(error);
  }
  if (!shortcutRegistered && !lastError) {
    lastError = `The shortcut ${shortcut} is already used by another app`;
  }
  return shortcutRegistered;
}

function showMainWindow(): void {
  const current = getMainWindow();
  if (!current || current.isDestroyed()) {
    createMainWindow({ show: true });
    return;
  }
  if (current.isMinimized()) current.restore();
  current.show();
  current.focus();
}

export const appshotsService = {
  async start(): Promise<AppshotsStatus> {
    if (process.platform !== "darwin") return this.getStatus();
    const settings = await appSettingsService.getSettings();
    unregisterShortcut();
    enabled = settings.appshotsEnabled;
    shortcut = normalizedAppshotShortcut(settings.appshotsShortcut);
    if (enabled) registerShortcut();
    return this.getStatus();
  },

  stop(): void {
    unregisterShortcut();
    pendingCaptures = [];
  },

  getStatus(): AppshotsStatus {
    return {
      supported: process.platform === "darwin",
      enabled,
      shortcut,
      shortcutRegistered,
      screenPermission: screenPermission(),
      accessibilityTrusted: accessibilityTrusted(false),
      capturing,
      lastError,
    };
  },

  async configure(input: AppshotsConfiguration): Promise<AppshotsStatus> {
    if (process.platform !== "darwin") {
      throw new Error("Lens is currently available on macOS only");
    }
    const previous = { enabled, shortcut };
    unregisterShortcut();
    enabled = input.enabled;
    shortcut = input.shortcut;
    lastError = null;

    if (enabled && !registerShortcut()) {
      const registrationError =
        lastError ?? `Could not register the shortcut ${shortcut}`;
      unregisterShortcut();
      enabled = previous.enabled;
      shortcut = previous.shortcut;
      if (enabled) registerShortcut();
      lastError = registrationError;
      throw new Error(registrationError);
    }

    try {
      await appSettingsService.updateAppshotsSettings({
        appshotsEnabled: enabled,
        appshotsShortcut: shortcut,
      });
    } catch (error) {
      unregisterShortcut();
      enabled = previous.enabled;
      shortcut = previous.shortcut;
      if (enabled) registerShortcut();
      throw error;
    }
    lastError = null;
    return this.getStatus();
  },

  async capture(): Promise<AppshotCapture> {
    if (process.platform !== "darwin") {
      throw new Error("Lens is currently available on macOS only");
    }
    if (capturing) throw new Error("A Lens capture is already in progress");
    const permission = screenPermission();
    if (permission === "denied" || permission === "restricted") {
      throw new Error(
        "Screen Recording permission is required. Enable Mains in System Settings → Privacy & Security → Screen Recording.",
      );
    }

    capturing = true;
    try {
      // Resolve the target before Mains is shown or focused.
      const target = await frontmostWindow();
      const sources = await desktopCapturer.getSources({
        types: ["window"],
        thumbnailSize: { width: 5120, height: 3200 },
        fetchWindowIcons: false,
      });
      const source = findWindowSource(sources, target);
      if (!source || source.thumbnail.isEmpty()) {
        throw new Error(
          "The frontmost window could not be captured. Check Screen Recording permission and try again.",
        );
      }

      const id = randomUUID();
      const captureName = `appshot-${id}-${Date.now()}.png`;
      const screenshotPath = path.join(captureDirectory(), captureName);
      const png = source.thumbnail.toPNG();
      if (png.length === 0) throw new Error("The captured window was empty");
      fs.writeFileSync(screenshotPath, png);
      pruneCaptureCache();

      const accessibility = await accessibleText(target.processId);
      const result: AppshotCapture = {
        id,
        appName: target.appName,
        bundleIdentifier: target.bundleIdentifier,
        windowTitle: target.windowTitle || source.name || target.appName,
        timestamp: new Date().toISOString(),
        screenshotPath,
        screenshotCaptureName: captureName,
        screenshotMimeType: "image/png",
        accessibilityText: accessibility.text,
        accessibilityStatus: accessibility.status,
        accessibilityTruncated: accessibility.truncated,
      };
      lastError = null;
      return result;
    } catch (error) {
      lastError = messageOf(error);
      throw error;
    } finally {
      capturing = false;
    }
  },

  async captureAndDeliver(): Promise<AppshotCapture> {
    const capture = await this.capture();
    pendingCaptures = [...pendingCaptures, capture].slice(-MAX_PENDING_CAPTURES);
    const window = getMainWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send(CHANNELS.appshots.captured, capture);
    }
    showMainWindow();
    return capture;
  },

  consumePending(): AppshotCapture[] {
    const captures = pendingCaptures;
    pendingCaptures = [];
    return captures;
  },

  acknowledge(captureId: string): null {
    pendingCaptures = pendingCaptures.filter((item) => item.id !== captureId);
    return null;
  },

  deleteCapture(captureName: string): null {
    const base = path.resolve(captureDirectory());
    const target = path.resolve(path.join(base, captureName));
    if (!target.startsWith(`${base}${path.sep}`)) {
      throw new Error("Path escape denied");
    }
    try {
      fs.unlinkSync(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    pendingCaptures = pendingCaptures.filter(
      (item) => item.screenshotCaptureName !== captureName,
    );
    return null;
  },

  requestAccessibility(): AppshotsStatus {
    accessibilityTrusted(true);
    return this.getStatus();
  },

  async openSystemSettings(pane: AppshotsSystemSettingsPane): Promise<null> {
    await shell.openExternal(SETTINGS_URLS[pane]);
    return null;
  },
};
