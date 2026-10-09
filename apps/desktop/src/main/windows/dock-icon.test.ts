import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { APP_ICON_IDS, appIconAssetPath } from "../../shared/app-icons";

const mocks = vi.hoisted(() => ({
  app: {
    isPackaged: true,
    getPath: vi.fn(),
    getAppPath: vi.fn(),
    dock: { setIcon: vi.fn() },
  },
  nativeImage: {
    createEmpty: vi.fn(),
    createFromPath: vi.fn(),
    createFromBitmap: vi.fn(),
  },
  nativeTheme: { themeSource: "system" },
  systemPreferences: {
    getUserDefault: vi.fn(),
    subscribeNotification: vi.fn(),
    unsubscribeNotification: vi.fn(),
  },
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock("electron", () => ({
  app: mocks.app,
  nativeImage: mocks.nativeImage,
  nativeTheme: mocks.nativeTheme,
  systemPreferences: mocks.systemPreferences,
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(channel, handler),
    removeHandler: (channel: string) => mocks.handlers.delete(channel),
  },
}));

import {
  applySavedDockIcon,
  getSavedDockIcon,
  registerDockIconIpc,
  setDockIcon,
  unregisterDockIconIpc,
} from "./dock-icon";
import { setThemeSource } from "./theme-source";

let userData: string;
const resourcesDescriptor = Object.getOwnPropertyDescriptor(process, "resourcesPath");

beforeEach(() => {
  vi.resetAllMocks();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "mains-dock-icon-"));
  mocks.app.isPackaged = true;
  mocks.app.getPath.mockReturnValue(userData);
  mocks.app.getAppPath.mockReturnValue(process.cwd());
  mocks.nativeTheme.themeSource = "system";
  mocks.systemPreferences.getUserDefault.mockReturnValue("");
  mocks.systemPreferences.subscribeNotification.mockReturnValue(0);
  mocks.nativeImage.createEmpty.mockReturnValue({ bundled: true });
  mocks.nativeImage.createFromPath.mockReturnValue({
    isEmpty: () => false,
    resize: () => ({ toBitmap: () => Buffer.alloc(832 * 832 * 4, 255) }),
  });
  mocks.nativeImage.createFromBitmap.mockReturnValue({ isEmpty: () => false });
  Object.defineProperty(process, "resourcesPath", { value: userData, configurable: true });
});

afterEach(() => {
  unregisterDockIconIpc();
  vi.restoreAllMocks();
  fs.rmSync(userData, { recursive: true, force: true });
  if (resourcesDescriptor) Object.defineProperty(process, "resourcesPath", resourcesDescriptor);
  else Reflect.deleteProperty(process, "resourcesPath");
});

function saveIcon(icon: string) {
  fs.writeFileSync(path.join(userData, "dock-icon.json"), JSON.stringify({ icon }));
}

const removedIconIds = [
  "mains-dark", "mains-light",
  "mains-blue", "mains-red", "mains-yellow", "mains-purple", "mains-green",
  "risograph/navy-orange", "risograph/pink-orange", "risograph/pink-blush",
  "risograph/orange-violet", "risograph/cocoa-blush", "risograph/cobalt-pink",
  "risograph/chartreuse-lilac", "risograph/mocha-cream",
  ...Array.from({ length: 32 }, (_, index) => `mains-${index + 1}`),
];

describe("Dock icons", () => {
  it("keeps native bundle appearances at startup and when returning to Default", () => {
    applySavedDockIcon();
    expect(mocks.app.dock.setIcon).not.toHaveBeenCalled();
    expect(mocks.nativeImage.createFromPath).not.toHaveBeenCalled();

    saveIcon("mains-atlas");
    setDockIcon("mains-default");
    expect(mocks.app.dock.setIcon).toHaveBeenCalledWith({ bundled: true });
    expect(getSavedDockIcon()).toBe("mains-default");
    expect(mocks.nativeImage.createFromPath).not.toHaveBeenCalled();
  });

  it("falls back to Default for every removed choice", () => {
    for (const id of removedIconIds) {
      saveIcon(id);
      expect(getSavedDockIcon()).toBe("mains-default");
      applySavedDockIcon();
    }
    expect(mocks.nativeImage.createFromPath).not.toHaveBeenCalled();
    expect(mocks.app.dock.setIcon).not.toHaveBeenCalled();
  });

  it("preserves every active choice and includes both appearances plus Icon Composer sources", () => {
    expect(APP_ICON_IDS).toEqual(["mains-default", "mains-atlas"]);
    for (const id of APP_ICON_IDS) {
      saveIcon(id);
      expect(getSavedDockIcon()).toBe(id);
      const file = path.join(process.cwd(), "src/renderer/public", appIconAssetPath(id));
      expect(fs.existsSync(file), file).toBe(true);
      const darkFile = path.join(process.cwd(), "src/renderer/public", appIconAssetPath(id, "dark"));
      expect(fs.existsSync(darkFile), darkFile).toBe(true);
      expect(fs.readFileSync(darkFile).equals(fs.readFileSync(file)), id).toBe(false);
      expect(fs.existsSync(file.replace(/\.png$/, ".icon/icon.json")), id).toBe(true);
    }
  });

  it("uses the new flat asset path with a 96px transparent margin", () => {
    setDockIcon("mains-atlas");
    expect(mocks.nativeImage.createFromPath.mock.calls[0][0]).toMatch(
      /icons\/atlas\.png$/,
    );
    const bitmap = mocks.nativeImage.createFromBitmap.mock.calls[0][0] as Buffer;
    expect(bitmap.length).toBe(1024 * 1024 * 4);
    expect(bitmap[(95 * 1024 + 96) * 4 + 3]).toBe(0);
    expect(bitmap[(96 * 1024 + 96) * 4 + 3]).toBe(255);
    expect(bitmap[(927 * 1024 + 927) * 4 + 3]).toBe(255);
    expect(bitmap[(928 * 1024 + 927) * 4 + 3]).toBe(0);
  });

  it("includes every logo layer referenced by the Icon Composer sources", () => {
    for (const id of APP_ICON_IDS) {
      const source = path.join(process.cwd(), "src/renderer/public",
        appIconAssetPath(id).replace(/\.png$/, ".icon"));
      const document = JSON.parse(fs.readFileSync(path.join(source, "icon.json"), "utf8")) as {
        groups: { layers: { "image-name"?: string }[] }[];
      };
      for (const group of document.groups) {
        for (const layer of group.layers) {
          const name = layer["image-name"];
          if (name) expect(fs.existsSync(path.join(source, "Assets", name)), `${id}: ${name}`).toBe(true);
        }
      }
    }
  });

  it("uses a PNG for Default in development", () => {
    mocks.app.isPackaged = false;
    applySavedDockIcon();
    expect(mocks.nativeImage.createFromPath).toHaveBeenCalledWith(
      path.join(process.cwd(), "src/renderer/public/icons/mains-default.png"),
    );
    expect(mocks.app.dock.setIcon).toHaveBeenCalledOnce();
  });

  it.each([
    ["", "atlas.png"],
    ["Dark", "atlas-dark.png"],
  ])("restores Atlas with the Mac's %j appearance at startup", (style, filename) => {
    saveIcon("mains-atlas");
    mocks.systemPreferences.getUserDefault.mockReturnValue(style);
    applySavedDockIcon();
    expect(mocks.nativeImage.createFromPath).toHaveBeenCalledWith(
      path.join(process.cwd(), ".vite/renderer/icons", filename),
    );
    expect(mocks.app.dock.setIcon).toHaveBeenCalledOnce();
  });

  it("switches Atlas with macOS while preserving the choice and ignoring Mains' theme override", () => {
    saveIcon("mains-atlas");
    setThemeSource("dark");
    applySavedDockIcon();
    const onAppearanceChanged = mocks.systemPreferences.subscribeNotification.mock.calls[0][1];
    expect(mocks.nativeImage.createFromPath.mock.lastCall?.[0]).toMatch(/icons\/atlas\.png$/);

    setThemeSource("light");
    mocks.systemPreferences.getUserDefault.mockReturnValue("Dark");
    onAppearanceChanged();
    expect(mocks.nativeImage.createFromPath.mock.lastCall?.[0]).toMatch(/icons\/atlas-dark\.png$/);

    mocks.systemPreferences.getUserDefault.mockReturnValue("");
    onAppearanceChanged();
    expect(mocks.nativeImage.createFromPath.mock.lastCall?.[0]).toMatch(/icons\/atlas\.png$/);
    expect(mocks.app.dock.setIcon).toHaveBeenCalledTimes(3);
    expect(getSavedDockIcon()).toBe("mains-atlas");
    expect(mocks.nativeTheme.themeSource).toBe("light");
    expect(mocks.systemPreferences.subscribeNotification).toHaveBeenCalledExactlyOnceWith(
      "AppleInterfaceThemeChangedNotification", expect.any(Function),
    );
  });

  it("leaves native Default appearances alone after switching away from Atlas", () => {
    saveIcon("mains-atlas");
    applySavedDockIcon();
    const onAppearanceChanged = mocks.systemPreferences.subscribeNotification.mock.calls[0][1];
    setDockIcon("mains-default");
    mocks.nativeImage.createFromPath.mockClear();
    mocks.app.dock.setIcon.mockClear();

    mocks.systemPreferences.getUserDefault.mockReturnValue("Dark");
    onAppearanceChanged();
    expect(mocks.nativeImage.createFromPath).not.toHaveBeenCalled();
    expect(mocks.app.dock.setIcon).not.toHaveBeenCalled();
    expect(getSavedDockIcon()).toBe("mains-default");
  });

  it("keeps the saved Atlas choice if an appearance refresh fails", () => {
    saveIcon("mains-atlas");
    applySavedDockIcon();
    const onAppearanceChanged = mocks.systemPreferences.subscribeNotification.mock.calls[0][1];
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.systemPreferences.getUserDefault.mockReturnValue("Dark");
    mocks.nativeImage.createFromPath.mockReturnValueOnce({ isEmpty: () => true });

    expect(() => onAppearanceChanged()).not.toThrow();
    expect(warning).toHaveBeenCalledOnce();
    expect(getSavedDockIcon()).toBe("mains-atlas");
    expect(mocks.app.dock.setIcon).toHaveBeenLastCalledWith({ bundled: true });

    onAppearanceChanged();
    expect(mocks.nativeImage.createFromPath.mock.lastCall?.[0]).toMatch(/icons\/atlas-dark\.png$/);
    expect(mocks.app.dock.setIcon.mock.lastCall?.[0]).not.toEqual({ bundled: true });
  });

  it("unsubscribes on cleanup and can subscribe again without duplicate observers", () => {
    applySavedDockIcon();
    applySavedDockIcon();
    unregisterDockIconIpc();
    unregisterDockIconIpc();
    expect(mocks.systemPreferences.subscribeNotification).toHaveBeenCalledOnce();
    expect(mocks.systemPreferences.unsubscribeNotification).toHaveBeenCalledExactlyOnceWith(0);

    applySavedDockIcon();
    expect(mocks.systemPreferences.subscribeNotification).toHaveBeenCalledTimes(2);
  });

  it("rolls back the saved choice when applying an icon fails", () => {
    saveIcon("mains-atlas");
    mocks.app.dock.setIcon.mockImplementationOnce(() => { throw new Error("Dock failure"); });
    expect(() => setDockIcon("mains-default")).toThrow("Dock failure");
    expect(getSavedDockIcon()).toBe("mains-atlas");
  });

  it("rejects every removed choice over IPC without changing the current icon", async () => {
    saveIcon("mains-atlas");
    registerDockIconIpc();
    for (const id of removedIconIds) {
      await expect(mocks.handlers.get(CHANNELS.app.setDockIcon)!({}, id))
        .resolves.toMatchObject({ success: false, error: "Unknown app icon" });
    }
    expect(getSavedDockIcon()).toBe("mains-atlas");
    expect(mocks.app.dock.setIcon).not.toHaveBeenCalled();
  });
});
