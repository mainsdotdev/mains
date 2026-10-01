import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BrowserWindow, BrowserWindowConstructorOptions, Rectangle } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";

const mocks = vi.hoisted(() => ({
  userData: "",
  workArea: { x: 1440, y: 24, width: 1280, height: 776 },
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  reducedMotion: false,
  deferResize: false,
  createSplashWindow: vi.fn(),
  closeSplashWindow: vi.fn(),
}));

function fakeWindow(options: BrowserWindowConstructorOptions) {
  let bounds: Rectangle = { x: options.x ?? 0, y: options.y ?? 0, width: options.width!, height: options.height! };
  let normal = { ...bounds };
  let maximized = false;
  let fullscreen = false;
  let destroyed = false;
  let visible = false;
  let resizable = true;
  let maximizable = true;
  let fullscreenable = true;
  const events = new EventEmitter();
  const webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn(), send: vi.fn() });
  return Object.assign(events, {
    webContents,
    show: vi.fn(() => { visible = true; }), focus: vi.fn(), loadURL: vi.fn(), loadFile: vi.fn(),
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    getBounds: () => ({ ...bounds }),
    getNormalBounds: () => ({ ...normal }),
    isMaximized: () => maximized,
    isFullScreen: () => fullscreen,
    isResizable: () => resizable,
    isMaximizable: () => maximizable,
    isFullScreenable: () => fullscreenable,
    setResizable: vi.fn((value: boolean) => { resizable = value; }),
    setMaximizable: vi.fn((value: boolean) => { maximizable = value; }),
    setFullScreenable: vi.fn((value: boolean) => { fullscreenable = value; }),
    setBounds: vi.fn((value: Rectangle, animate = false) => {
      bounds = { ...value };
      normal = { ...value };
      events.emit("resize");
      events.emit("move");
      if (animate && !mocks.deferResize) events.emit("resized");
    }),
    maximize: vi.fn(() => {
      maximized = true;
      bounds = { ...mocks.workArea };
      events.emit("maximize");
    }),
    unmaximize: vi.fn(() => {
      maximized = false;
      bounds = { ...normal };
      events.emit("unmaximize");
    }),
    // macOS reports completion later, rather than inside setFullScreen.
    setFullScreen: vi.fn(),
    completeFullscreen: (value: boolean) => {
      fullscreen = value;
      bounds = value ? { ...mocks.workArea } : { ...normal };
      events.emit(value ? "enter-full-screen" : "leave-full-screen");
    },
    destroy: () => { destroyed = true; events.emit("closed"); },
  });
}

vi.mock("electron", () => ({
  app: { getPath: () => mocks.userData, isPackaged: false },
  BrowserWindow: vi.fn(function (options: BrowserWindowConstructorOptions) { return fakeWindow(options); }),
  screen: {
    getPrimaryDisplay: () => ({ workAreaSize: mocks.workArea }),
    getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 3000, height: 1200 } }],
    getDisplayMatching: () => ({ workArea: mocks.workArea }),
  },
  shell: { openExternal: vi.fn() },
  systemPreferences: { getAnimationSettings: () => ({ prefersReducedMotion: mocks.reducedMotion }) },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(channel, handler),
    removeHandler: (channel: string) => mocks.handlers.delete(channel),
  },
}));
vi.mock("./crash-recovery", () => ({ attachCrashRecovery: vi.fn() }));
vi.mock("./dock-icon", () => ({ getAppIconPath: () => "icon.png", getSavedDockIcon: () => "default" }));
vi.mock("./splashWindow", () => ({ createSplashWindow: mocks.createSplashWindow, closeSplashWindow: mocks.closeSplashWindow }));

import { createMainWindow, getMainWindow, setMainWindowOnboarding } from "./mainWindow";
import { registerOnboardingWindowIpc, unregisterOnboardingWindowIpc } from "./onboarding-window.ipc";

const workspaceBounds = { x: 100, y: 80, width: 1280, height: 880 };
const savedState = { ...workspaceBounds, isMaximized: false };
const statePath = () => path.join(mocks.userData, "window-state.json");
const readState = () => JSON.parse(fs.readFileSync(statePath(), "utf8"));
const createWindow = (options = {}) => createMainWindow(options) as BrowserWindow & ReturnType<typeof fakeWindow>;

beforeEach(() => {
  mocks.userData = fs.mkdtempSync(path.join(os.tmpdir(), "mains-onboarding-window-"));
  mocks.workArea = { x: 1440, y: 24, width: 1280, height: 776 };
  mocks.reducedMotion = false;
  mocks.deferResize = false;
  mocks.createSplashWindow.mockClear();
  mocks.closeSplashWindow.mockClear();
  fs.writeFileSync(statePath(), JSON.stringify(savedState));
});
afterEach(() => {
  getMainWindow()?.destroy();
  unregisterOnboardingWindowIpc();
  fs.rmSync(mocks.userData, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("native onboarding window", () => {
  it("ignores stale completion hints and waits for mounted onboarding without creating a splash", async () => {
    fs.writeFileSync(path.join(mocks.userData, "onboarding-startup.json"), JSON.stringify({ completed: true }));
    const onReadyToShow = vi.fn();
    const window = createWindow({ showStartupSplash: true, onReadyToShow });
    window.emit("ready-to-show");
    expect(mocks.createSplashWindow).not.toHaveBeenCalled();
    await setMainWindowOnboarding(true, false);
    expect(onReadyToShow).not.toHaveBeenCalled();
    expect(window.getBounds().width).toBe(1080);
    await setMainWindowOnboarding(true);
    await vi.waitFor(() => expect(onReadyToShow).toHaveBeenCalledWith(window));
    expect(mocks.createSplashWindow).not.toHaveBeenCalled();
    expect(readState()).toEqual(savedState);
  });

  it("shows the regular splash only after current storage confirms completion, keeping the main window hidden until mounted", async () => {
    const onReadyToShow = vi.fn();
    const window = createWindow({ showStartupSplash: true, onReadyToShow });
    window.emit("ready-to-show");
    expect(mocks.createSplashWindow).not.toHaveBeenCalled();
    await setMainWindowOnboarding(false, false);
    expect(mocks.createSplashWindow).toHaveBeenCalledOnce();
    expect(onReadyToShow).not.toHaveBeenCalled();
    await setMainWindowOnboarding(false);
    await vi.waitFor(() => expect(onReadyToShow).toHaveBeenCalledWith(window));
    expect(window.getBounds()).toEqual(workspaceBounds);
    expect(mocks.closeSplashWindow).toHaveBeenCalled();
  });

  it("does not resize mounted onboarding or show a splash for a late boot announcement", async () => {
    const window = createWindow({ showStartupSplash: true });
    await setMainWindowOnboarding(true);
    await setMainWindowOnboarding(false, false);
    expect(window.getBounds().width).toBe(1080);
    expect(mocks.createSplashWindow).not.toHaveBeenCalled();
  });

  it("first exposes the compact window, centered on its display", async () => {
    const onReadyToShow = vi.fn();
    const window = createWindow({ onReadyToShow });
    window.emit("ready-to-show");
    expect(onReadyToShow).not.toHaveBeenCalled();
    await setMainWindowOnboarding(true);
    await vi.waitFor(() => expect(onReadyToShow).toHaveBeenCalledWith(window));
    expect(window.getBounds()).toEqual({ x: 1540, y: 42, width: 1080, height: 740 });
    expect(window.isResizable()).toBe(false);
    expect(window.isFullScreenable()).toBe(false);
  });

  it("keeps the first visible window compact when the renderer is slow to announce its state", async () => {
    vi.useFakeTimers();
    fs.writeFileSync(path.join(mocks.userData, "onboarding-startup.json"), JSON.stringify({ completed: true }));
    const onReadyToShow = vi.fn();
    const window = createWindow({ onReadyToShow });
    window.emit("ready-to-show");
    await vi.advanceTimersByTimeAsync(3000);
    expect(onReadyToShow).toHaveBeenCalledWith(window);
    expect(window.getBounds()).toEqual({ x: 1540, y: 42, width: 1080, height: 740 });
    expect(readState()).toEqual(savedState);
    await setMainWindowOnboarding(false);
    expect(window.getBounds()).toEqual(workspaceBounds);
  });

  it("preserves saved workspace bounds while compact and resumes persistence after finishing", async () => {
    const window = createWindow();
    window.emit("move"); // Initial native positioning must not overwrite saved state.
    expect(readState()).toEqual(savedState);
    await setMainWindowOnboarding(true);
    window.setBounds({ ...window.getBounds(), x: 1500 });
    expect(readState()).toEqual(savedState);
    await setMainWindowOnboarding(false);
    expect(window.getBounds()).toEqual(workspaceBounds);
    expect(window.isResizable()).toBe(true);
    expect(window.isFullScreenable()).toBe(true);
    window.setBounds({ ...workspaceBounds, width: 1400 });
    expect(readState()).toEqual({ ...savedState, width: 1400 });
  });

  it("keeps the original snapshot through duplicate requests and renderer reloads", async () => {
    const window = createWindow();
    await Promise.all([setMainWindowOnboarding(true), setMainWindowOnboarding(true)]);
    window.setBounds({ ...window.getBounds(), x: 1700 });
    await setMainWindowOnboarding(true);
    await setMainWindowOnboarding(false);
    expect(window.getBounds()).toEqual(workspaceBounds);
  });

  it("restores a saved maximized workspace without maximizing before onboarding", async () => {
    fs.writeFileSync(statePath(), JSON.stringify({ ...savedState, isMaximized: true }));
    const window = createWindow();
    await setMainWindowOnboarding(true);
    expect(window.maximize).not.toHaveBeenCalled();
    expect(readState().isMaximized).toBe(true);
    await setMainWindowOnboarding(false);
    expect(window.isMaximized()).toBe(true);
    expect(window.getNormalBounds()).toEqual(workspaceBounds);
  });

  it("restores maximization immediately for users who already completed onboarding", async () => {
    fs.writeFileSync(statePath(), JSON.stringify({ ...savedState, isMaximized: true }));
    const window = createWindow();
    await setMainWindowOnboarding(false);
    expect(window.isMaximized()).toBe(true);
    expect(window.setBounds).not.toHaveBeenCalled();
  });

  it("waits for macOS to leave fullscreen and serializes completion behind it", async () => {
    const window = createWindow();
    await setMainWindowOnboarding(false);
    window.completeFullscreen(true);
    const enter = setMainWindowOnboarding(true);
    const finish = setMainWindowOnboarding(false);
    await vi.waitFor(() => expect(window.setFullScreen).toHaveBeenCalledWith(false));
    expect(window.setBounds).not.toHaveBeenCalled();
    window.completeFullscreen(false);
    await enter;
    await vi.waitFor(() => expect(window.setFullScreen).toHaveBeenCalledWith(true));
    window.completeFullscreen(true);
    await finish;
    expect(window.getNormalBounds()).toEqual(workspaceBounds);
    expect(window.isFullScreen()).toBe(true);
    expect(readState()).toEqual(savedState);
  });

  it("resolves an in-progress fullscreen transition if the window closes", async () => {
    const window = createWindow();
    await setMainWindowOnboarding(false);
    window.completeFullscreen(true);
    const enter = setMainWindowOnboarding(true);
    await vi.waitFor(() => expect(window.setFullScreen).toHaveBeenCalled());
    window.destroy();
    await enter;
    expect(window.setBounds).not.toHaveBeenCalled();
    expect(window.listenerCount("leave-full-screen")).toBe(1); // Main's notification listener only.
  });

  it("fits the available work area on smaller displays", async () => {
    mocks.workArea = { x: 0, y: 24, width: 864, height: 600 };
    const window = createWindow();
    await setMainWindowOnboarding(true);
    expect(window.getBounds()).toEqual(mocks.workArea);
  });

  it("waits for the visible workspace expansion to finish before completing", async () => {
    const window = createWindow();
    await setMainWindowOnboarding(true);
    window.show();
    mocks.deferResize = true;
    const finished = vi.fn();
    const restoring = setMainWindowOnboarding(false).then(finished);
    await vi.waitFor(() => expect(window.setBounds).toHaveBeenLastCalledWith(workspaceBounds, true));
    expect(finished).not.toHaveBeenCalled();
    expect(window.listenerCount("resized")).toBe(1);
    window.emit("resized");
    await restoring;
    expect(finished).toHaveBeenCalledOnce();
    expect(window.listenerCount("resized")).toBe(0);
  });

  it("restores without native motion when the OS requests reduced motion", async () => {
    const window = createWindow();
    await setMainWindowOnboarding(true);
    window.show();
    mocks.reducedMotion = true;
    await setMainWindowOnboarding(false);
    expect(window.setBounds).toHaveBeenLastCalledWith(workspaceBounds, false);
    expect(window.listenerCount("resized")).toBe(0);
  });

  it("releases an animated restore when the window closes", async () => {
    const window = createWindow();
    await setMainWindowOnboarding(true);
    window.show();
    mocks.deferResize = true;
    const restoring = setMainWindowOnboarding(false);
    await vi.waitFor(() => expect(window.listenerCount("resized")).toBe(1));
    window.destroy();
    await restoring;
    expect(window.listenerCount("resized")).toBe(0);
  });

  it("accepts local main-window IPC and rejects invalid state or another window", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const window = createWindow();
    registerOnboardingWindowIpc();
    const invoke = mocks.handlers.get(CHANNELS.app.setOnboardingWindow)!;
    await expect(invoke({ sender: window.webContents }, true)).resolves.toEqual({ success: true, data: null });
    await expect(invoke({ sender: window.webContents }, "true")).resolves.toMatchObject({ success: false });
    await expect(invoke({ sender: window.webContents }, false, "ready")).resolves.toMatchObject({ success: false });
    await expect(invoke({ sender: {} }, false)).resolves.toMatchObject({ success: false });
    await expect(invoke({ sender: {} }, false, false)).resolves.toMatchObject({ success: false });
    expect(window.getBounds().width).toBe(1080);
    unregisterOnboardingWindowIpc();
    expect(mocks.handlers.has(CHANNELS.app.setOnboardingWindow)).toBe(false);
  });
});
