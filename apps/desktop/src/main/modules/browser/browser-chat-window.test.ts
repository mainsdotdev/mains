import { afterEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";

const harness = vi.hoisted(() => {
  const parentEvents = new Map<string, () => void>();
  const parent = {
    webContents: { send: vi.fn() },
    getContentBounds: vi.fn(() => ({ x: 100, y: 200, width: 1200, height: 800 })),
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    isMinimized: vi.fn(() => false),
    on: vi.fn((name: string, listener: () => void) => { parentEvents.set(name, listener); }),
    off: vi.fn((name: string) => { parentEvents.delete(name); }),
  };
  return {
    parent,
    parentEvents,
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    cursor: { x: 110, y: 210 },
    child: null as Record<string, any> | null,
    childOptions: null as Record<string, unknown> | null,
  };
});

vi.mock("electron", () => ({
  app: { isPackaged: false },
  screen: { getCursorScreenPoint: () => harness.cursor },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      harness.handlers.set(channel, handler);
    },
    removeHandler: (channel: string) => { harness.handlers.delete(channel); },
  },
  BrowserWindow: class {
    visible = false;
    destroyed = false;
    bounds = { x: 0, y: 0, width: 800, height: 600 };
    events = new Map<string, () => void>();
    setBounds = vi.fn((bounds: { x: number; y: number; width: number; height: number }) => {
      this.bounds = bounds;
    });
    getBounds = vi.fn(() => this.bounds);
    setIgnoreMouseEvents = vi.fn();
    loadURL = vi.fn(async () => undefined);
    showInactive = vi.fn(() => { this.visible = true; });
    hide = vi.fn(() => { this.visible = false; });
    destroy = vi.fn(() => { this.destroyed = true; });
    on = vi.fn((name: string, listener: () => void) => { this.events.set(name, listener); });
    webContents = {
      send: vi.fn(),
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      isLoading: vi.fn(() => false),
    };
    isDestroyed = () => this.destroyed;
    isVisible = () => this.visible;
    constructor(options: Record<string, unknown>) {
      harness.child = this;
      harness.childOptions = options;
    }
  },
}));

vi.mock("../../windows/mainWindow", () => ({
  getMainWindow: () => harness.parent,
}));

import {
  browserChatWindow,
  registerBrowserChatWindowIpc,
  unregisterBrowserChatWindowIpc,
} from "./browser-chat-window";

afterEach(() => {
  unregisterBrowserChatWindowIpc();
  harness.child = null;
  harness.childOptions = null;
  harness.cursor = { x: 110, y: 210 };
  vi.clearAllMocks();
});

describe("native browser chat window", () => {
  it("positions over the live browser and lets outside pointer input pass through", () => {
    registerBrowserChatWindowIpc();
    browserChatWindow.update({
      visible: true,
      bounds: { x: 20, y: 90, width: 900, height: 600 },
      card: { x: 360, y: 400, width: 540, height: 280 },
    });

    const child = harness.child!;
    expect(harness.childOptions?.acceptFirstMouse).toBe(true);
    expect(child.setBounds).toHaveBeenCalledWith({
      x: 120, y: 290, width: 900, height: 600,
    });
    expect(child.showInactive).toHaveBeenCalledOnce();
    expect(child.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true });

    browserChatWindow.setInteractive(true);
    expect(child.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: false });
    browserChatWindow.postAction({ type: "mode", mode: "details" });
    expect(harness.parent.webContents.send).toHaveBeenCalledWith(
      CHANNELS.browser.chatAction,
      { type: "mode", mode: "details" },
    );
  });

  it("accepts window placement only from the main renderer and chat actions only from the child", () => {
    registerBrowserChatWindowIpc();
    const update = harness.handlers.get(CHANNELS.browser.chatUpdateWindow)!;
    const state = {
      visible: true,
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      card: { x: 250, y: 300, width: 540, height: 280 },
    };
    expect((update({ sender: {} }, state) as { success: boolean }).success).toBe(false);
    expect((update({ sender: harness.parent.webContents }, state) as { success: boolean }).success).toBe(true);

    const post = harness.handlers.get(CHANNELS.browser.chatPostAction)!;
    expect((post({ sender: harness.parent.webContents }, { type: "mode", mode: "icon" }) as { success: boolean }).success).toBe(false);
    expect((post({ sender: harness.child!.webContents }, { type: "mode", mode: "icon" }) as { success: boolean }).success).toBe(true);
    expect((post({ sender: harness.child!.webContents }, { type: "composerHeight", height: 76 }) as { success: boolean }).success).toBe(true);
    expect(harness.parent.webContents.send).toHaveBeenCalledWith(
      CHANNELS.browser.chatAction,
      { type: "composerHeight", height: 76 },
    );
    expect((post({ sender: harness.child!.webContents }, { type: "composerHeight", height: Number.NaN }) as { success: boolean }).success).toBe(false);
  });

  it("relays queue actions and frozen input to the parent without starting a second consumer", () => {
    registerBrowserChatWindowIpc();
    browserChatWindow.update({ visible: true, bounds: { x: 0, y: 0, width: 800, height: 600 }, card: { x: 250, y: 300, width: 540, height: 280 } });
    const post = harness.handlers.get(CHANNELS.browser.chatPostAction)!;
    for (const action of [
      { type: "queueSubmit", ownerKey: "run", draft: "next", items: [], uploads: [], model: "gpt", additionalDirectories: ["/folder"] },
      { type: "queueAction", ownerKey: "run", action: "steer", id: "input" },
      { type: "queueAction", ownerKey: "run", action: "edit", id: "input" },
      { type: "queueAction", ownerKey: "run", action: "remove", id: "input" },
      { type: "queueReorder", ownerKey: "run", orderedIds: ["second", "first"] },
      { type: "directories", ownerKey: "run", directories: ["/folder"] },
    ]) {
      expect((post({ sender: harness.child!.webContents }, action) as { success: boolean }).success).toBe(true);
      expect(harness.parent.webContents.send).toHaveBeenCalledWith(CHANNELS.browser.chatAction, action);
    }
    expect((post({ sender: harness.child!.webContents }, { type: "queueAction", ownerKey: "run", action: "invalid" }) as { success: boolean }).success).toBe(false);
    expect((post({ sender: harness.child!.webContents }, { type: "queueSubmit", ownerKey: "run", draft: "next", items: [], uploads: [], additionalDirectories: [123] }) as { success: boolean }).success).toBe(false);
    for (const orderedIds of [[123], ["duplicate", "duplicate"], [""]]) {
      expect((post({ sender: harness.child!.webContents }, { type: "queueReorder", ownerKey: "run", orderedIds }) as { success: boolean }).success).toBe(false);
    }
  });

  it("relays MCP app results only from the floating chat and rejects malformed app requests", () => {
    registerBrowserChatWindowIpc();
    browserChatWindow.update({ visible: true,
      bounds: { x: 0, y: 0, width: 800, height: 600 }, card: { x: 250, y: 300, width: 540, height: 280 } });
    const post = harness.handlers.get(CHANNELS.browser.chatPostAction)!;
    const result = { runId: "run-1", title: "MagicPath", input: { projectId: "project-1" }, output: { content: [] },
      app: { server: "codex_apps", tool: "magicpath.open", resourceUri: "ui://magicpath", originCallId: "call-1",
        connectorId: "magicpath", linkId: null } };
    const action = { type: "openMcpApp", ownerKey: "run-owner", result, automatic: true };
    expect((post({ sender: harness.parent.webContents }, action) as { success: boolean }).success).toBe(false);
    expect((post({ sender: harness.child!.webContents }, action) as { success: boolean }).success).toBe(true);
    expect(harness.parent.webContents.send).toHaveBeenCalledWith(CHANNELS.browser.chatAction, action);
    for (const invalid of [
      { ...action, automatic: "true" },
      { ...action, result: { ...result, runId: "" } },
      { ...action, result: { ...result, input: [] } },
      { ...action, result: { ...result, app: { ...result.app, resourceUri: "https://example.com" } } },
      { ...action, result: { ...result, app: { ...result.app, linkId: 123 } } },
    ]) {
      expect((post({ sender: harness.child!.webContents }, invalid) as { success: boolean }).success).toBe(false);
    }
  });

  it("accepts the selected Space in the parent context and rejects a provider mismatch", () => {
    registerBrowserChatWindowIpc();
    const publish = harness.handlers.get(CHANNELS.browser.chatPublishContext)!;
    const context = {
      route: "/code",
      activeTab: "new-run",
      activeSpace: { id: "space-codex", providerId: "codex", mode: "developer" },
      providerId: "codex",
      ownerKey: "draft",
      mode: "input",
      draft: "",
      selectedModel: "",
      selectedCollectionId: null,
      dark: false,
      themeCss: "",
      rootStyle: "",
      contextItems: [],
      uploadsVersion: 0,
      uploads: [],
    };
    expect((publish({ sender: harness.parent.webContents }, context) as { success: boolean }).success).toBe(true);
    expect(browserChatWindow.context).toEqual(context);
    expect((publish({ sender: harness.parent.webContents }, {
      ...context,
      activeSpace: { ...context.activeSpace, providerId: "claude_code" },
    }) as { success: boolean }).success).toBe(false);
  });

  it("restores pointer hit testing when the child is recreated and follows fullscreen", () => {
    browserChatWindow.update({
      visible: true,
      bounds: { x: 20, y: 90, width: 900, height: 600 },
      card: { x: 360, y: 400, width: 540, height: 280 },
    });
    const first = harness.child!;
    browserChatWindow.setInteractive(true);
    first.events.get("closed")!();

    harness.cursor = { x: 100 + 370, y: 200 + 410 };
    browserChatWindow.update({
      visible: true,
      bounds: { x: 20, y: 90, width: 900, height: 600 },
      card: { x: 360, y: 400, width: 540, height: 280 },
    });
    const second = harness.child!;
    expect(second).not.toBe(first);
    expect(second.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: false });

    harness.parentEvents.get("enter-full-screen")!();
    expect(second.setBounds).toHaveBeenCalledWith({ x: 120, y: 290, width: 900, height: 600 });
  });

  it("activates chat clicks when the pointer enters from the live browser", () => {
    vi.useFakeTimers();
    try {
      harness.cursor = { x: 110, y: 210 };
      browserChatWindow.update({
        visible: true,
        bounds: { x: 20, y: 90, width: 900, height: 600 },
        card: { x: 360, y: 400, width: 540, height: 280 },
      });
      const child = harness.child!;
      expect(child.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });

      harness.cursor = { x: 100 + 370, y: 200 + 410 };
      vi.advanceTimersByTime(50);
      expect(child.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: false });

      harness.cursor = { x: 110, y: 210 };
      vi.advanceTimersByTime(120);
      expect(child.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });
    } finally {
      browserChatWindow.destroy();
      vi.useRealTimers();
    }
  });

  it("keeps the chat clickable if a stale renderer hit test rejects a pointer inside it", () => {
    harness.cursor = { x: 100 + 370, y: 200 + 410 };
    browserChatWindow.update({
      visible: true,
      bounds: { x: 20, y: 90, width: 900, height: 600 },
      card: { x: 360, y: 400, width: 540, height: 280 },
    });
    const child = harness.child!;
    child.setIgnoreMouseEvents.mockClear();

    browserChatWindow.setInteractive(false);
    expect(child.setIgnoreMouseEvents).not.toHaveBeenCalled();

    harness.cursor = { x: 110, y: 210 };
    browserChatWindow.setInteractive(false);
    expect(child.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });
  });

  it("keeps portaled menus interactive outside the chat card", () => {
    vi.useFakeTimers();
    try {
      harness.cursor = { x: 100 + 370, y: 200 + 410 };
      browserChatWindow.update({
        visible: true,
        bounds: { x: 20, y: 90, width: 900, height: 600 },
        card: { x: 360, y: 400, width: 540, height: 280 },
      });
      const child = harness.child!;
      harness.cursor = { x: 110, y: 210 };
      browserChatWindow.setInteractive(true);
      child.setIgnoreMouseEvents.mockClear();

      vi.advanceTimersByTime(160);
      expect(child.setIgnoreMouseEvents).not.toHaveBeenCalled();
      browserChatWindow.setInteractive(false);
      expect(child.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });
    } finally {
      browserChatWindow.destroy();
      vi.useRealTimers();
    }
  });

  it("keeps a full-window preview interactive until it closes", () => {
    vi.useFakeTimers();
    try {
      registerBrowserChatWindowIpc();
      harness.cursor = { x: 100 + 870, y: 200 + 670 };
      const state = {
        visible: true,
        bounds: { x: 20, y: 90, width: 900, height: 600 },
        card: { x: 840, y: 630, width: 48, height: 48 },
      };
      browserChatWindow.update(state);
      const child = harness.child!;
      const setOverlay = harness.handlers.get(CHANNELS.browser.chatSetOverlayInteractive)!;
      expect((setOverlay({ sender: harness.parent.webContents }, true) as { success: boolean }).success).toBe(false);
      expect((setOverlay({ sender: child.webContents }, true) as { success: boolean }).success).toBe(true);

      harness.cursor = { x: 100 + 800, y: 200 + 100 };
      child.setIgnoreMouseEvents.mockClear();
      vi.advanceTimersByTime(160);
      browserChatWindow.setInteractive(false);
      browserChatWindow.update(state);
      expect(child.setIgnoreMouseEvents).not.toHaveBeenCalled();
      expect(browserChatWindow.interactive).toBe(true);

      expect((setOverlay({ sender: child.webContents }, false) as { success: boolean }).success).toBe(true);
      expect(child.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });
    } finally {
      browserChatWindow.destroy();
      vi.useRealTimers();
    }
  });

  it("does not reposition the native window for identical transition frames", () => {
    const state = {
      visible: true,
      bounds: { x: 20, y: 90, width: 900, height: 600 },
      card: { x: 360, y: 400, width: 540, height: 280 },
    };
    browserChatWindow.update(state);
    const child = harness.child!;
    browserChatWindow.update(state);

    expect(child.setBounds).toHaveBeenCalledTimes(1);
  });
});
