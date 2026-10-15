import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BrowserWindow } from "electron";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import type { WindowAppearance } from "@mains/contracts/window-appearance";

const mocks = vi.hoisted(() => ({
  userData: "",
  release: "10.0.26300",
  nativeTheme: { shouldUseDarkColors: true, on: vi.fn(), removeListener: vi.fn() },
  updates: new Set<() => void>(),
  handlers: new Map<string, (...args: any[]) => any>(),
}));
vi.mock("electron", () => ({
  app: { getPath: () => mocks.userData },
  nativeTheme: mocks.nativeTheme,
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) => mocks.handlers.set(channel, handler),
    removeHandler: (channel: string) => mocks.handlers.delete(channel),
  },
}));
vi.mock("node:os", async (original) => ({ ...await original<typeof import("node:os")>(), default: { ...await original<typeof import("node:os")>(), release: () => mocks.release } }));

import { attachWindowAppearance, registerWindowAppearanceIpc, unregisterWindowAppearanceIpc, windowsWindowAppearanceOptions } from "./window-appearance";

const hostPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
const windows: EventEmitter[] = [];
function fakeWindow() {
  let backgroundColor = "#FFFFFF";
  const window = Object.assign(new EventEmitter(), {
    webContents: {},
    isDestroyed: () => false,
    // Electron 41 resets the backing color to white when removing a material.
    setBackgroundMaterial: vi.fn((material: string) => { if (material === "none") backgroundColor = "#FFFFFF"; }),
    setBackgroundColor: vi.fn((color: string) => { backgroundColor = color; }),
    getBackgroundColor: () => backgroundColor,
    setTitleBarOverlay: vi.fn(),
  });
  windows.push(window);
  return window;
}
const appearance: WindowAppearance = {
  light: { translucent: false, backgroundColor: "#faf9f5" },
  dark: { translucent: true, backgroundColor: "#1a1b26" },
};
const statePath = () => path.join(mocks.userData, "window-appearance.json");
const update = (window: ReturnType<typeof fakeWindow>, value: unknown = appearance) =>
  mocks.handlers.get(CHANNELS.app.setWindowAppearance)!({ sender: window.webContents }, value);

beforeEach(() => {
  Object.defineProperty(process, "platform", { ...hostPlatform, value: "win32" });
  mocks.userData = fs.mkdtempSync(path.join(os.tmpdir(), "mains-window-appearance-"));
  mocks.release = "10.0.26300";
  mocks.nativeTheme.shouldUseDarkColors = true;
  mocks.nativeTheme.on.mockImplementation((_event, listener) => { mocks.updates.add(listener); });
  mocks.nativeTheme.removeListener.mockImplementation((_event, listener) => { mocks.updates.delete(listener); });
  windowsWindowAppearanceOptions();
  registerWindowAppearanceIpc();
});
afterEach(() => {
  windows.splice(0).forEach(window => window.emit("closed"));
  unregisterWindowAppearanceIpc();
  fs.rmSync(mocks.userData, { recursive: true, force: true });
  vi.restoreAllMocks();
  Object.defineProperty(process, "platform", hostPlatform);
});

describe("Windows native appearance", () => {
  it("keeps native buttons and opaque theme colors for the initial window", () => {
    expect(windowsWindowAppearanceOptions()).toEqual({
      titleBarStyle: "hidden", titleBarOverlay: { color: "#00000000", symbolColor: "#ffffff", height: 38 },
      backgroundMaterial: "none", backgroundColor: "#141414",
    });
  });

  it("switches Acrylic and opaque backing as the current appearance changes", async () => {
    const window = fakeWindow();
    attachWindowAppearance(window as unknown as BrowserWindow);
    await expect(update(window)).resolves.toEqual({ success: true, data: null });
    expect(window.setBackgroundMaterial).toHaveBeenLastCalledWith("acrylic");
    expect(window.setBackgroundColor).toHaveBeenLastCalledWith("#00000000");
    expect(window.setBackgroundMaterial.mock.invocationCallOrder[0]).toBeLessThan(window.setBackgroundColor.mock.invocationCallOrder[0]);
    mocks.nativeTheme.shouldUseDarkColors = false;
    mocks.updates.forEach(listener => listener());
    expect(window.setBackgroundMaterial).toHaveBeenLastCalledWith("none");
    expect(window.setBackgroundColor).toHaveBeenLastCalledWith("#faf9f5");
    expect(window.setBackgroundColor.mock.invocationCallOrder[1]).toBeLessThan(window.setBackgroundMaterial.mock.invocationCallOrder[1]);
    expect(window.setTitleBarOverlay).toHaveBeenLastCalledWith({ color: "#00000000", symbolColor: "#111111", height: 38 });
  });

  it("restores the last provider's appearance before the next window is constructed", async () => {
    const window = fakeWindow();
    attachWindowAppearance(window as unknown as BrowserWindow);
    await update(window);
    expect(JSON.parse(fs.readFileSync(statePath(), "utf8"))).toEqual(appearance);
    window.emit("closed");
    expect(mocks.updates.size).toBe(0);
    expect(windowsWindowAppearanceOptions()).toMatchObject({ backgroundMaterial: "acrylic", backgroundColor: "#00000000" });
  });

  it("removes Acrylic immediately when the toggle is disabled", async () => {
    const window = fakeWindow();
    attachWindowAppearance(window as unknown as BrowserWindow);
    await update(window);
    await update(window, { ...appearance, dark: { ...appearance.dark, translucent: false } });
    expect(window.setBackgroundMaterial).toHaveBeenLastCalledWith("none");
    expect(window.setBackgroundColor).toHaveBeenLastCalledWith("#1a1b26");
  });

  it("restores the opaque theme after Electron resets the color while removing Acrylic", async () => {
    const window = fakeWindow();
    attachWindowAppearance(window as unknown as BrowserWindow);
    await update(window);
    await update(window, { ...appearance, dark: { ...appearance.dark, translucent: false } });
    expect(window.getBackgroundColor()).toBe("#1a1b26");
  });

  it.each(["10.0.19045", "10.0.22000"])("uses an opaque fallback on Windows %s", async (release) => {
    mocks.release = release;
    const window = fakeWindow();
    attachWindowAppearance(window as unknown as BrowserWindow);
    await update(window);
    expect(window.setBackgroundMaterial).toHaveBeenLastCalledWith("none");
    expect(window.setBackgroundColor).toHaveBeenLastCalledWith("#1a1b26");
  });

  it("ignores corrupt saved state", () => {
    fs.writeFileSync(statePath(), '{"dark":{"translucent":"yes","backgroundColor":"transparent"}}');
    expect(windowsWindowAppearanceOptions()).toMatchObject({ backgroundMaterial: "none", backgroundColor: "#141414" });
  });

  it.each([null, { ...appearance, dark: { translucent: true, backgroundColor: "red" } }, { ...appearance, light: { translucent: "true", backgroundColor: "#ffffff" } }])(
    "rejects malformed renderer state: %j", async (value) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const window = fakeWindow();
      attachWindowAppearance(window as unknown as BrowserWindow);
      await expect(update(window, value)).resolves.toMatchObject({ success: false });
      expect(window.setBackgroundMaterial).not.toHaveBeenCalled();
      expect(fs.existsSync(statePath())).toBe(false);
    },
  );

  it("rejects requests from other windows", () => {
    const window = fakeWindow();
    attachWindowAppearance(window as unknown as BrowserWindow);
    expect(update(fakeWindow())).toMatchObject({ success: false });
    expect(window.setBackgroundMaterial).not.toHaveBeenCalled();
  });

  it("keeps macOS window construction and vibrancy untouched", () => {
    Object.defineProperty(process, "platform", { ...hostPlatform, value: "darwin" });
    const window = fakeWindow();
    expect(windowsWindowAppearanceOptions()).toEqual({});
    attachWindowAppearance(window as unknown as BrowserWindow);
    expect(update(window)).toMatchObject({ success: false });
    expect(window.setBackgroundMaterial).not.toHaveBeenCalled();
    expect(mocks.updates.size).toBe(0);
  });
});
