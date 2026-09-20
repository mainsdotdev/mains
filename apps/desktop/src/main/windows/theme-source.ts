import { app, ipcMain, nativeTheme } from "electron";
import fs from "fs";
import path from "path";
import { CHANNELS } from "../../shared/ipc-kit/channels";
import { handle } from "../ipc-kit/handle";

/**
 * The window's theme, as macOS sees it. Mains paints its own content from the
 * renderer's preference (a `dark` class on `<html>`), but everything AppKit
 * draws — the vibrancy behind transparent surfaces, context and menu bar
 * menus, message boxes, file pickers — follows `nativeTheme.themeSource`.
 * Left at "system", a light Mains on a dark Mac sits on dark glass with dark
 * menus. The renderer hands its preference over; it also drives Chromium's
 * `prefers-color-scheme`, which the renderer's "system" choice reads — so
 * "system" here keeps that tracking the OS.
 *
 * The choice is saved beside the window state so the next launch opens the
 * splash and main window in it, before the renderer is up to say so.
 */

export type ThemeSource = "system" | "light" | "dark";

const THEME_SOURCES: ReadonlySet<string> = new Set(["system", "light", "dark"]);

export function isThemeSource(value: unknown): value is ThemeSource {
  return typeof value === "string" && THEME_SOURCES.has(value);
}

function statePath(): string {
  return path.join(app.getPath("userData"), "theme-source.json");
}

/** Apply the last saved theme — call before creating any window. */
export function applySavedThemeSource(): void {
  try {
    const saved = JSON.parse(fs.readFileSync(statePath(), "utf-8")) as {
      themeSource?: unknown;
    };
    if (isThemeSource(saved.themeSource)) nativeTheme.themeSource = saved.themeSource;
  } catch {
    // First launch, or an unreadable file: follow the system.
  }
}

export function setThemeSource(themeSource: ThemeSource): void {
  if (nativeTheme.themeSource === themeSource) return;
  nativeTheme.themeSource = themeSource;
  try {
    fs.writeFileSync(statePath(), JSON.stringify({ themeSource }));
  } catch {
    // Best-effort: the theme still applies for this session.
  }
}

/** Local Electron IPC only — it themes this Mac's windows. */
export function registerThemeSourceIpc(): void {
  ipcMain.handle(
    CHANNELS.app.setThemeSource,
    handle((themeSource: unknown) => {
      if (!isThemeSource(themeSource)) {
        throw new Error("Theme must be system, light, or dark");
      }
      setThemeSource(themeSource);
      return null;
    }),
  );
}

export function unregisterThemeSourceIpc(): void {
  ipcMain.removeHandler(CHANNELS.app.setThemeSource);
}
