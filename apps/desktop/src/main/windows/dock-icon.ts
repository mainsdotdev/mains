import { app, ipcMain, nativeImage, type NativeImage } from "electron";
import fs from "fs";
import path from "path";
import { CHANNELS } from "@mains/contracts/channels";
import { handle } from "@mains/backend/ipc-kit";
import {
  appIconAssetPath,
  DEFAULT_APP_ICON_ID,
  isAppIconId,
  type AppIconId,
} from "../../shared/app-icons";

const ICON_CANVAS_SIZE = 1024;
// Match the bundled app icon's 72px transparent inset for every Dock choice.
const ICON_CONTENT_SIZE = 880;
const ICON_INSET = (ICON_CANVAS_SIZE - ICON_CONTENT_SIZE) / 2;

function statePath(): string {
  return path.join(app.getPath("userData"), "dock-icon.json");
}

export function getSavedDockIcon(): AppIconId {
  try {
    const saved = JSON.parse(fs.readFileSync(statePath(), "utf8")) as {
      icon?: unknown;
    };
    return isAppIconId(saved.icon) ? saved.icon : DEFAULT_APP_ICON_ID;
  } catch {
    return DEFAULT_APP_ICON_ID;
  }
}

export function getAppIconPath(id: AppIconId): string {
  const assetPath = appIconAssetPath(id);
  if (!app.isPackaged) {
    return path.join(app.getAppPath(), "src/renderer/public", assetPath);
  }

  // NativeImage reads the extraResource copy outside app.asar. Vite's public
  // copy remains in the renderer bundle so the picker can display previews.
  const resourcePath = path.join(process.resourcesPath, assetPath);
  if (fs.existsSync(resourcePath)) return resourcePath;
  return path.join(app.getAppPath(), ".vite/renderer", assetPath);
}

function loadDockImage(id: AppIconId): NativeImage {
  const image = nativeImage.createFromPath(getAppIconPath(id));
  if (image.isEmpty()) throw new Error("That app icon is unavailable");

  const resized = image.resize({
    width: ICON_CONTENT_SIZE,
    height: ICON_CONTENT_SIZE,
    quality: "best",
  });
  const source = resized.toBitmap({ scaleFactor: 1 });
  if (source.length !== ICON_CONTENT_SIZE * ICON_CONTENT_SIZE * 4) {
    throw new Error("That app icon could not be resized");
  }

  const bitmap = Buffer.alloc(ICON_CANVAS_SIZE * ICON_CANVAS_SIZE * 4);
  for (let y = 0; y < ICON_CONTENT_SIZE; y++) {
    source.copy(
      bitmap,
      ((y + ICON_INSET) * ICON_CANVAS_SIZE + ICON_INSET) * 4,
      y * ICON_CONTENT_SIZE * 4,
      (y + 1) * ICON_CONTENT_SIZE * 4,
    );
  }
  const padded = nativeImage.createFromBitmap(bitmap, {
    width: ICON_CANVAS_SIZE,
    height: ICON_CANVAS_SIZE,
  });
  if (padded.isEmpty()) throw new Error("That app icon could not be loaded");
  return padded;
}

function setDockImage(id: AppIconId): void {
  if (!app.dock) throw new Error("The Dock icon is only available on macOS");
  app.dock.setIcon(loadDockImage(id));
}

/** Apply the persisted choice before the first window opens. */
export function applySavedDockIcon(): void {
  if (!app.dock) return;
  const selected = getSavedDockIcon();
  try {
    setDockImage(selected);
  } catch (error) {
    console.warn("Failed to set saved Dock icon:", error);
    if (selected !== DEFAULT_APP_ICON_ID) {
      try {
        setDockImage(DEFAULT_APP_ICON_ID);
      } catch (fallbackError) {
        console.warn("Failed to set default Dock icon:", fallbackError);
      }
    }
  }
}

export function setDockIcon(id: AppIconId): void {
  if (!app.dock) throw new Error("The Dock icon is only available on macOS");
  const image = loadDockImage(id);

  const previous = getSavedDockIcon();
  fs.writeFileSync(statePath(), JSON.stringify({ icon: id }));
  try {
    app.dock.setIcon(image);
  } catch (error) {
    try {
      fs.writeFileSync(statePath(), JSON.stringify({ icon: previous }));
    } catch {
      // Keep the original error; a later launch falls back to the saved value.
    }
    throw error;
  }
}

export function registerDockIconIpc(): void {
  ipcMain.handle(CHANNELS.app.getDockIcon, handle(() => getSavedDockIcon()));
  ipcMain.handle(CHANNELS.app.setDockIcon, handle((id: unknown) => {
    if (!isAppIconId(id)) throw new Error("Unknown app icon");
    setDockIcon(id);
    return id;
  }));
}

export function unregisterDockIconIpc(): void {
  ipcMain.removeHandler(CHANNELS.app.getDockIcon);
  ipcMain.removeHandler(CHANNELS.app.setDockIcon);
}
