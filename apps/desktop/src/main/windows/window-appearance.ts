import { app, ipcMain, nativeTheme, type BrowserWindow, type BrowserWindowConstructorOptions } from "electron";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CHANNELS } from "@mains/contracts/channels";
import type { WindowAppearance } from "@mains/contracts/window-appearance";
import { handle } from "@mains/backend/ipc-kit";

const DEFAULT_APPEARANCE: WindowAppearance = {
  light: { translucent: false, backgroundColor: "#f7f7f6" },
  dark: { translucent: false, backgroundColor: "#141414" },
};
let appearance = DEFAULT_APPEARANCE;
let mainWindow: BrowserWindow | null = null;

function parseAppearance(value: unknown): WindowAppearance | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<WindowAppearance>;
  for (const mode of ["light", "dark"] as const) {
    const choice = raw[mode];
    if (!choice || typeof choice.translucent !== "boolean" ||
      typeof choice.backgroundColor !== "string" || !/^#[0-9a-f]{6}$/i.test(choice.backgroundColor)) return null;
  }
  return {
    light: { translucent: raw.light!.translucent, backgroundColor: raw.light!.backgroundColor },
    dark: { translucent: raw.dark!.translucent, backgroundColor: raw.dark!.backgroundColor },
  };
}

function statePath(): string {
  return path.join(app.getPath("userData"), "window-appearance.json");
}

function supportsAcrylic(): boolean {
  const [major, , build] = os.release().split(".").map(Number);
  return process.platform === "win32" && major >= 10 && build >= 22621;
}

function backdrop() {
  const choice = nativeTheme.shouldUseDarkColors ? appearance.dark : appearance.light;
  const acrylic = choice.translucent && supportsAcrylic();
  return {
    backgroundMaterial: acrylic ? "acrylic" as const : "none" as const,
    backgroundColor: acrylic ? "#00000000" : choice.backgroundColor,
  };
}

function titleBarOverlay() {
  return {
    color: "#00000000",
    symbolColor: nativeTheme.shouldUseDarkColors ? "#ffffff" : "#111111",
    height: 38,
  };
}

/** Read before construction so the first frame uses the last renderer theme. */
export function windowsWindowAppearanceOptions(): BrowserWindowConstructorOptions {
  if (process.platform !== "win32") return {};
  try {
    appearance = parseAppearance(JSON.parse(fs.readFileSync(statePath(), "utf8"))) ?? DEFAULT_APPEARANCE;
  } catch {
    appearance = DEFAULT_APPEARANCE;
  }
  // Acrylic requires a client-drawn frame in Electron. Keep the native window
  // buttons, resize borders and snap behavior through Window Controls Overlay.
  return { titleBarStyle: "hidden", titleBarOverlay: titleBarOverlay(), ...backdrop() };
}

function applyAppearance(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  const { backgroundMaterial, backgroundColor } = backdrop();
  // Fill before removing the material, then restore the color afterward:
  // Electron resets the backing surface to white when setting "none".
  if (backgroundMaterial === "none") window.setBackgroundColor(backgroundColor);
  window.setBackgroundMaterial(backgroundMaterial);
  window.setBackgroundColor(backgroundColor);
  window.setTitleBarOverlay(titleBarOverlay());
}

/** Only the main desktop window receives renderer/provider appearance changes. */
export function attachWindowAppearance(window: BrowserWindow): void {
  if (process.platform !== "win32") return;
  mainWindow = window;
  const update = () => applyAppearance(window);
  nativeTheme.on("updated", update);
  window.once("closed", () => {
    nativeTheme.removeListener("updated", update);
    if (mainWindow === window) mainWindow = null;
  });
}

export function registerWindowAppearanceIpc(): void {
  const update = handle((value: unknown) => {
    const next = parseAppearance(value);
    if (!next) throw new Error("Window appearance must contain light and dark colors and translucency");
    appearance = next;
    if (mainWindow) applyAppearance(mainWindow);
    try { fs.writeFileSync(statePath(), JSON.stringify(next)); } catch { /* Best-effort startup hint. */ }
    return null;
  });
  ipcMain.handle(CHANNELS.app.setWindowAppearance, (event, value: unknown) => {
    if (process.platform !== "win32" || !mainWindow || event.sender !== mainWindow.webContents) {
      return { success: false, error: "Only the Windows main window can change its backdrop" };
    }
    return update(event, value);
  });
}

export function unregisterWindowAppearanceIpc(): void {
  ipcMain.removeHandler(CHANNELS.app.setWindowAppearance);
}
