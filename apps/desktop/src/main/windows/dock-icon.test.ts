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
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock("electron", () => ({
  app: mocks.app,
  nativeImage: mocks.nativeImage,
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

let userData: string;
const resourcesDescriptor = Object.getOwnPropertyDescriptor(process, "resourcesPath");

beforeEach(() => {
  vi.resetAllMocks();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "mains-dock-icon-"));
  mocks.app.isPackaged = true;
  mocks.app.getPath.mockReturnValue(userData);
  mocks.app.getAppPath.mockReturnValue(process.cwd());
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
  fs.rmSync(userData, { recursive: true, force: true });
  if (resourcesDescriptor) Object.defineProperty(process, "resourcesPath", resourcesDescriptor);
  else Reflect.deleteProperty(process, "resourcesPath");
});

function saveIcon(icon: string) {
  fs.writeFileSync(path.join(userData, "dock-icon.json"), JSON.stringify({ icon }));
}

describe("Dock icons", () => {
  it("keeps native bundle appearances at startup and when returning to Default", () => {
    applySavedDockIcon();
    expect(mocks.app.dock.setIcon).not.toHaveBeenCalled();
    expect(mocks.nativeImage.createFromPath).not.toHaveBeenCalled();

    saveIcon("mains-blue");
    setDockIcon("mains-default");
    expect(mocks.app.dock.setIcon).toHaveBeenCalledWith({ bundled: true });
    expect(getSavedDockIcon()).toBe("mains-default");
    expect(mocks.nativeImage.createFromPath).not.toHaveBeenCalled();
  });

  it("falls back to Default for removed Japanese and Updates choices", () => {
    for (let n = 1; n <= 32; n++) {
      saveIcon(`mains-${n}`);
      expect(getSavedDockIcon()).toBe("mains-default");
      applySavedDockIcon();
    }
    expect(mocks.nativeImage.createFromPath).not.toHaveBeenCalled();
    expect(mocks.app.dock.setIcon).not.toHaveBeenCalled();
  });

  it("preserves every active choice and has a PNG plus Icon Composer source for each", () => {
    expect(APP_ICON_IDS).toHaveLength(16);
    for (const id of APP_ICON_IDS) {
      saveIcon(id);
      expect(getSavedDockIcon()).toBe(id);
      const file = path.join(process.cwd(), "src/renderer/public", appIconAssetPath(id));
      expect(fs.existsSync(file), file).toBe(true);
      expect(fs.existsSync(file.replace(/\.png$/, ".icon/icon.json")), id).toBe(true);
    }
  });

  it("uses the new flat asset path with a 96px transparent margin", () => {
    setDockIcon("risograph/pink-blush");
    expect(mocks.nativeImage.createFromPath.mock.calls[0][0]).toMatch(
      /icons\/pink-blush\.png$/,
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

  it("rolls back the saved choice when applying an icon fails", () => {
    saveIcon("mains-red");
    mocks.app.dock.setIcon.mockImplementationOnce(() => { throw new Error("Dock failure"); });
    expect(() => setDockIcon("mains-blue")).toThrow("Dock failure");
    expect(getSavedDockIcon()).toBe("mains-red");
  });

  it("rejects a removed choice over IPC without changing the current icon", async () => {
    saveIcon("mains-green");
    registerDockIconIpc();
    await expect(mocks.handlers.get(CHANNELS.app.setDockIcon)!({}, "mains-17"))
      .resolves.toMatchObject({ success: false, error: "Unknown app icon" });
    expect(getSavedDockIcon()).toBe("mains-green");
    expect(mocks.app.dock.setIcon).not.toHaveBeenCalled();
  });
});
