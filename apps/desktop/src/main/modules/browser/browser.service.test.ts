import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const harness = vi.hoisted(() => ({ userData: "" }));

vi.mock("electron", () => ({
  app: { getPath: () => harness.userData, isPackaged: false },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  clipboard: {},
  Menu: {},
  shell: {},
  WebContentsView: class {},
}));
vi.mock("../keyboardShortcuts", () => ({
  keyboardShortcutsService: { getBinding: () => null },
}));

import { browserService } from "./browser.service";
import { CHANNELS } from "@mains/contracts/channels";
import { runOwnerKey } from "../../../shared/ui-state-keys";
import type { BrowserSelectionPayload } from "./browser.dto";

function resetInMemory() {
  if (browserService.persistTimer) clearTimeout(browserService.persistTimer);
  browserService.persistTimer = null;
  if (browserService.historyPersistTimer) clearTimeout(browserService.historyPersistTimer);
  browserService.historyPersistTimer = null;
  browserService.historyLoaded = false;
  browserService.historyEntries = [];
  browserService.tabs.clear();
  browserService.activeTabId = null;
  browserService.activeOwnerKey = "default";
  browserService.activeTabIdsByOwner = {};
  browserService.restored = false;
  browserService._clearIdleTimer();
  browserService.attached = false;
  browserService.visible = false;
  browserService.suppressionLeases.clear();
  browserService.host = null;
  browserService.selectMode = false;
}

describe("browserService — tabs by chat", () => {
  beforeEach(() => {
    harness.userData = mkdtempSync(join(tmpdir(), "mains-browser-context-"));
    resetInMemory();
  });

  afterEach(() => {
    resetInMemory();
    rmSync(harness.userData, { recursive: true, force: true });
  });

  it("does not create blank tabs while browsing chats with the panel closed", async () => {
    await browserService.setContext("chat-a");
    await browserService.setContext("chat-b");
    await browserService.setContext("chat-c");
    expect(browserService.tabs.size).toBe(0);
    browserService._persistNow();
    expect(JSON.parse(readFileSync(join(harness.userData, "browser-tabs.json"), "utf8")).tabs)
      .toEqual([]);
  });

  it("reports a click in the active live page without blocking the page", async () => {
    await browserService.setContext("chat-a");
    await browserService.createTab("https://example.com/a");
    const record = browserService.tabs.get(browserService.activeTabId!)!;
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const view = {
      webContents: {
        on: (name: string, listener: (...args: unknown[]) => void) => { listeners.set(name, listener); },
        setWindowOpenHandler: vi.fn(),
      },
    } as unknown as Parameters<typeof browserService._wireView>[1];
    browserService._wireView(record, view);
    browserService.visible = true;
    const send = vi.spyOn(browserService, "_sendToRenderer").mockImplementation(() => undefined);
    const preventDefault = vi.fn();
    const onMouse = listeners.get("before-mouse-event")!;

    onMouse({ preventDefault }, { type: "mouseMove" });
    expect(send).not.toHaveBeenCalled();
    onMouse({ preventDefault }, { type: "mouseDown" });
    expect(send).toHaveBeenCalledWith(CHANNELS.browser.chatAction, { type: "pagePointerDown" });
    expect(preventDefault).not.toHaveBeenCalled();
    send.mockRestore();
  });

  it("captures an annotation from its originating tab and keeps selection mode active", async () => {
    await browserService.setContext("chat-a");
    await browserService.createTab("https://example.com/a");
    const source = browserService.tabs.get(browserService.activeTabId!)!;
    await browserService.createTab("https://example.com/b");
    const other = browserService.tabs.get(browserService.activeTabId!)!;
    const image = { isEmpty: () => false, toPNG: () => Buffer.from("annotation pixels") };
    const sourceCapture = vi.fn().mockResolvedValue(image);
    const otherCapture = vi.fn();
    const executeJavaScript = vi.fn().mockResolvedValue(undefined);
    source.view = { webContents: { isDestroyed: () => false, capturePage: sourceCapture, executeJavaScript } } as unknown as typeof source.view;
    other.view = { webContents: { isDestroyed: () => false, capturePage: otherCapture } } as unknown as typeof other.view;
    browserService.selectMode = true;
    const send = vi.spyOn(browserService, "_sendToRenderer").mockImplementation(() => undefined);
    const element = {
      selector: "h1", tagName: "h1", text: "Introduction", styles: {},
      rect: { x: 10, y: 20, width: 100, height: 30 },
      pageRect: { x: 10, y: 20, width: 100, height: 30 },
      scroll: { x: 0, y: 0 }, viewport: { width: 1000, height: 700 }, devicePixelRatio: 2,
    };
    const payload: Omit<BrowserSelectionPayload, "id"> = {
      ...element, type: "browser_selection", url: source.url, title: "Docs",
      elements: [element, { ...element, selector: "nav", tagName: "nav" }],
      comment: "Explain these", timestamp: "2026-10-02T11:00:00Z",
    };
    await browserService._handleSelection(payload, source);
    expect(sourceCapture).toHaveBeenCalledWith(undefined);
    expect(otherCapture).not.toHaveBeenCalled();
    expect(browserService.selectMode).toBe(true);
    expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining("finishCapture"));
    expect(send).not.toHaveBeenCalledWith(CHANNELS.browser.selectModeChanged, expect.anything());
    const selection = send.mock.calls.find(([channel]) => channel === CHANNELS.browser.selection)![1] as Record<string, unknown>;
    expect(selection).toMatchObject({ ownerKey: "chat-a", elements: payload.elements, comment: payload.comment });
    expect(readFileSync(selection.screenshotPath as string).toString()).toBe("annotation pixels");
    send.mockRestore();
  });

  it("exits annotation mode when the active page navigates", async () => {
    await browserService.createTab("https://example.com/docs");
    const record = browserService.tabs.get(browserService.activeTabId!)!;
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const executeJavaScript = vi.fn().mockResolvedValue(undefined);
    const view = { webContents: {
      on: (name: string, listener: (...args: unknown[]) => void) => { listeners.set(name, listener); },
      setWindowOpenHandler: vi.fn(), executeJavaScript,
    } } as unknown as Parameters<typeof browserService._wireView>[1];
    browserService._wireView(record, view);
    browserService.selectMode = true;
    const send = vi.spyOn(browserService, "_sendToRenderer").mockImplementation(() => undefined);
    listeners.get("did-start-navigation")!({}, "https://example.com/next", false, false);
    expect(browserService.selectMode).toBe(true);
    listeners.get("did-start-navigation")!({}, "https://example.com/next", false, true);
    expect(browserService.selectMode).toBe(false);
    expect(send).toHaveBeenCalledWith(CHANNELS.browser.selectModeChanged, { enabled: false });
    expect(executeJavaScript).toHaveBeenCalledOnce();
    send.mockRestore();
  });

  it("focuses the guest when annotation starts so Escape works before the first selection", async () => {
    await browserService.createTab("https://example.com/docs");
    const record = browserService.tabs.get(browserService.activeTabId!)!;
    const contents = {
      isDestroyed: () => false,
      executeJavaScript: vi.fn().mockResolvedValue("installed"),
      focus: vi.fn(),
    };
    record.view = { webContents: contents } as unknown as typeof record.view;
    const send = vi.spyOn(browserService, "_sendToRenderer").mockImplementation(() => undefined);
    try {
      await expect(browserService.setSelectMode(true)).resolves.toEqual({ enabled: true });
      expect(contents.focus).toHaveBeenCalledOnce();
      expect(browserService.selectMode).toBe(true);
      await browserService.setSelectMode(false);
      expect(contents.focus).toHaveBeenCalledOnce();
      expect(browserService.selectMode).toBe(false);
      expect(send).toHaveBeenLastCalledWith(CHANNELS.browser.selectModeChanged, { enabled: false });
    } finally {
      send.mockRestore();
    }
  });

  it("remounts the selected chat's page when leaving a floating overlay", async () => {
    browserService.attached = true;
    await browserService.setContext("chat-a");
    await browserService.createTab("https://example.com/a");
    browserService.setVisible(false);
    await browserService.setContext("chat-b");
    await browserService.createTab("https://example.com/b");
    await browserService.setContext("chat-a");
    const mount = vi.spyOn(browserService, "_mountActiveView").mockResolvedValue(undefined);
    browserService.setVisible(true);
    expect(mount).toHaveBeenCalledOnce();
    expect(browserService.getState().ownerKey).toBe("chat-a");
    mount.mockRestore();
  });

  it("keeps the native view hidden on blank tabs, including after an overlay closes", async () => {
    await browserService.createTab();
    const tab = browserService.tabs.get(browserService.activeTabId!)!;
    const view = {
      setVisible: vi.fn(),
      setBounds: vi.fn(),
      webContents: {
        isDestroyed: () => false,
        isLoading: () => false,
        focus: vi.fn(),
      },
    };
    tab.view = view as unknown as typeof tab.view;
    browserService.host = {
      isDestroyed: () => false,
      contentView: { children: [view] },
    } as unknown as typeof browserService.host;
    browserService.attached = true;
    browserService.visible = true;

    await browserService._mountActiveView();
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    expect(view.webContents.focus).not.toHaveBeenCalled();

    browserService.setVisible(true);
    await Promise.resolve();
    expect(browserService.visible).toBe(true);
    expect(view.setVisible.mock.calls.every(([visible]) => !visible)).toBe(true);
  });

  it("shows a page opened from a blank tab and hides it when returning to blank", async () => {
    await browserService.createTab();
    const tab = browserService.tabs.get(browserService.activeTabId!)!;
    let url = "about:blank";
    const view = {
      setVisible: vi.fn(),
      webContents: {
        isDestroyed: () => false,
        getURL: () => url,
        getTitle: () => "",
        isLoading: () => false,
        getZoomFactor: () => 1,
        loadURL: vi.fn(async (next: string) => { url = next; }),
        navigationHistory: {
          canGoBack: () => false,
          canGoForward: () => false,
        },
      },
    };
    tab.view = view as unknown as typeof tab.view;
    browserService.attached = true;
    browserService.visible = true;

    await browserService.navigate("https://mains.dev/");
    expect(view.setVisible).toHaveBeenLastCalledWith(true);
    expect(tab.url).toBe("https://mains.dev/");

    url = "about:blank";
    browserService._syncRecord(tab);
    expect(view.setVisible).toHaveBeenLastCalledWith(false);

    browserService.visible = false;
    await browserService.navigate("https://mains.dev/");
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
  });

  it("does not create or reopen a browser panel when an overlay closes on another page", () => {
    const mount = vi.spyOn(browserService, "_mountActiveView").mockResolvedValue(undefined);
    try {
      browserService.setSuppressed("preview", true);
      browserService.setSuppressed("preview", false);
      browserService.setVisible(true);
      expect(browserService.visible).toBe(false);
      expect(browserService.attached).toBe(false);
      expect(browserService.tabs.size).toBe(0);
      expect(mount).not.toHaveBeenCalled();
    } finally { mount.mockRestore(); }
  });

  it("releases stacked overlay leases without overriding a hidden or detached panel", async () => {
    await browserService.createTab("https://example.com/docs");
    const record = browserService.tabs.get(browserService.activeTabId!)!;
    const view = { setVisible: vi.fn(), webContents: { isDestroyed: () => false } };
    record.view = view as unknown as typeof record.view;
    browserService.attached = browserService.visible = true;
    const mount = vi.spyOn(browserService, "_mountActiveView").mockResolvedValue(undefined);
    try {
      browserService.setSuppressed("main-modal", true);
      browserService.setSuppressed("floating-modal", true);
      expect(view.setVisible).toHaveBeenLastCalledWith(false);
      expect(browserService.visible).toBe(true);
      browserService.setSuppressed("main-modal", false);
      expect(mount).not.toHaveBeenCalled();
      browserService.setSuppressed("floating-modal", false);
      expect(mount).toHaveBeenCalledOnce();
      mount.mockClear();

      browserService.setVisible(false);
      browserService.setSuppressed("preview", true);
      browserService.setSuppressed("preview", false);
      expect(mount).not.toHaveBeenCalled();
      expect(browserService.visible).toBe(false);

      browserService.setSuppressed("preview", true);
      browserService.detach();
      browserService.setSuppressed("preview", false);
      browserService.setVisible(true);
      expect(mount).not.toHaveBeenCalled();
      expect(browserService.attached).toBe(false);
      expect(view.setVisible).toHaveBeenLastCalledWith(false);
    } finally { mount.mockRestore(); }
  });

  it("keeps an asynchronously mounting view hidden after the panel closes", async () => {
    await browserService.createTab("https://example.com/docs");
    browserService.attached = browserService.visible = true;
    const addChildView = vi.fn();
    browserService.host = { isDestroyed: () => false, contentView: { children: [], addChildView } } as unknown as typeof browserService.host;
    const view = { setVisible: vi.fn() };
    let ready!: (value: Awaited<ReturnType<typeof browserService._ensureTabView>>) => void;
    const ensure = vi.spyOn(browserService, "_ensureTabView").mockReturnValue(new Promise((resolve) => { ready = resolve; }));
    try {
      const mounting = browserService._mountActiveView();
      browserService.detach();
      ready(view as unknown as Awaited<ReturnType<typeof browserService._ensureTabView>>);
      await mounting;
      expect(addChildView).not.toHaveBeenCalled();
      expect(view.setVisible).toHaveBeenCalledWith(false);
    } finally { ensure.mockRestore(); }
  });

  it("restores the last active tab and URL for each chat after a restart", async () => {
    await browserService.setContext("chat-a");
    await browserService.createTab("https://example.com/a");
    const chosenTabId = browserService.getState().activeTabId;
    await browserService.createTab("https://example.com/a-other");
    await browserService.activateTab(chosenTabId);
    await browserService.setContext("chat-b");
    await browserService.createTab("https://example.com/b");

    await browserService.setContext("chat-a");
    expect(browserService.getState().activeTabId).toBe(chosenTabId);
    expect(browserService.getState().tabs.find((tab) => tab.tabId === browserService.getState().activeTabId)?.url)
      .toBe("https://example.com/a");
    browserService._persistNow();
    resetInMemory();

    await browserService.setContext("chat-b");
    const state = browserService.getState();
    expect(state.ownerKey).toBe("chat-b");
    expect(state.tabs.find((tab) => tab.tabId === state.activeTabId)?.url)
      .toBe("https://example.com/b");
    expect(state.tabs.some((tab) => tab.url === "https://example.com/a")).toBe(false);
  });

  it("restores a local HTML preview tab without a file URL", async () => {
    const htmlPath = join(harness.userData, "palette.html");
    writeFileSync(htmlPath, "<!doctype html><title>Palette</title>");
    await browserService.setContext("chat-a");
    await browserService.createHtmlPreviewTab(htmlPath);
    const first = browserService.getState().tabs[0];
    expect(first.url).toBe(`mains-preview://${first.tabId}/`);
    expect(browserService.getHtmlPreviewPath(first.tabId)).toBe(htmlPath);
    browserService._persistNow();
    resetInMemory();

    await browserService.setContext("chat-a");
    const restored = browserService.getState().tabs[0];
    expect(restored.url).toBe(`mains-preview://${first.tabId}/`);
    expect(browserService.getHtmlPreviewPath(first.tabId)).toBe(htmlPath);
  });

  it("moves a pre-run draft's tabs to the created chat", async () => {
    await browserService.setContext("draft-a");
    await browserService.createTab("https://example.com/docs");
    browserService.reassignTabs("draft-a", "run-a");
    await browserService.setContext("another-chat");
    await browserService.setContext("run-a");
    const state = browserService.getState();
    expect(state.tabs.find((tab) => tab.tabId === state.activeTabId)?.url)
      .toBe("https://example.com/docs");
  });

  it("forgets a deleted chat's tabs without creating a replacement", async () => {
    const deletedOwner = runOwnerKey("local", "run-a");
    const keptOwner = runOwnerKey("local", "run-b");
    await browserService.setContext(deletedOwner);
    await browserService.createTab("https://example.com/deleted");
    await browserService.setContext(keptOwner);
    await browserService.createTab("https://example.com/kept");
    await browserService.setContext(deletedOwner);

    await browserService.forgetContext({ backendId: "local", kind: "run", id: "run-a" });

    expect(browserService.listOwnerKeys()).toEqual([keptOwner]);
    expect(browserService.tabs.size).toBe(1);
    const saved = JSON.parse(readFileSync(join(harness.userData, "browser-tabs.json"), "utf8"));
    expect(saved.tabs.map((tab: { ownerKey: string }) => tab.ownerKey)).toEqual([keptOwner]);
    expect(saved.activeTabIdsByOwner[deletedOwner]).toBeUndefined();
    await browserService.setContext(deletedOwner);
    expect(browserService.getState().tabs).toEqual([]);
  });

  it("forgets only unsent drafts for a deleted workspace", async () => {
    const draftA = JSON.stringify(["remote-1", "draft", "space", "codex", "developer", "ws-a", null]);
    const draftCollection = JSON.stringify(["remote-1", "draft", "space", "codex", "developer", "ws-a", "c1"]);
    const keptDraft = JSON.stringify(["remote-1", "draft", "space", "codex", "developer", "ws-b", null]);
    const keptRun = runOwnerKey("remote-1", "run-a");
    for (const owner of [draftA, draftCollection, keptDraft, keptRun]) {
      await browserService.setContext(owner);
      await browserService.createTab(`https://example.com/${browserService.tabs.size}`);
    }

    await browserService.forgetContext({ backendId: "remote-1", kind: "workspace", id: "ws-a" });

    expect(browserService.listOwnerKeys().sort()).toEqual([keptDraft, keptRun].sort());
    const saved = JSON.parse(readFileSync(join(harness.userData, "browser-tabs.json"), "utf8"));
    expect(saved.tabs).toHaveLength(2);
    expect(saved.tabs.map((tab: { ownerKey: string }) => tab.ownerKey).sort())
      .toEqual([keptDraft, keptRun].sort());
  });

  it("assigns version-one global tabs to the first opened chat", async () => {
    writeFileSync(join(harness.userData, "browser-tabs.json"), JSON.stringify({
      version: 1,
      activeTabId: "old-tab",
      tabs: [{
        id: "old-tab", url: "https://example.com/legacy", title: "Legacy",
        faviconUrl: null, zoomFactor: 1, history: null,
      }],
    }));
    await browserService.setContext("chat-a");
    expect(browserService.getState().tabs[0].url).toBe("https://example.com/legacy");
    browserService._persistNow();
    expect(JSON.parse(readFileSync(join(harness.userData, "browser-tabs.json"), "utf8")).version)
      .toBe(2);
  });

  it("clears open-tab navigation history as well as the history list", async () => {
    await browserService.setContext("chat-a");
    await browserService.createTab("https://example.com/current");
    const tab = browserService.tabs.get(browserService.getState().activeTabId)!;
    tab.history = {
      entries: [
        { url: "https://example.com/previous", title: "Previous" },
        { url: "https://example.com/current", title: "Current" },
      ],
      index: 1,
    };
    tab.canGoBack = true;
    browserService.historyLoaded = true;
    browserService.historyEntries = [{
      id: "visit-1",
      url: "https://example.com/previous",
      title: "Previous",
      faviconUrl: null,
      visitedAt: "2026-09-23T10:00:00.000Z",
      visitCount: 1,
    }];

    await browserService.clearHistory();

    const saved = JSON.parse(readFileSync(join(harness.userData, "browser-tabs.json"), "utf8"));
    const savedHistory = JSON.parse(readFileSync(join(harness.userData, "browser-history.json"), "utf8"));
    expect(saved.tabs[0].url).toBe("https://example.com/current");
    expect(saved.tabs[0].history).toBeNull();
    expect(savedHistory.entries).toEqual([]);
    expect(tab.canGoBack).toBe(false);
  });

  it("clears live back-forward state so the next save cannot restore old URLs", async () => {
    await browserService.setContext("chat-a");
    await browserService.createTab("https://example.com/current");
    const tab = browserService.tabs.get(browserService.getState().activeTabId)!;
    let entries = [
      { url: "https://example.com/previous", title: "Previous" },
      { url: "https://example.com/current", title: "Current" },
    ];
    const clear = vi.fn(() => { entries = entries.slice(-1); });
    tab.view = {
      webContents: {
        isDestroyed: () => false,
        getURL: () => "https://example.com/current",
        getTitle: () => "Current",
        isLoading: () => false,
        getZoomFactor: () => 1,
        navigationHistory: {
          clear,
          canGoBack: () => entries.length > 1,
          canGoForward: () => false,
          getAllEntries: () => entries,
          getActiveIndex: () => entries.length - 1,
        },
      },
    } as unknown as typeof tab.view;

    await browserService.clearBrowsingData({
      timeRange: "last-hour",
      history: true,
      cookiesAndSiteData: false,
      cache: false,
      downloads: false,
    });
    browserService._persistNow();

    const saved = JSON.parse(readFileSync(join(harness.userData, "browser-tabs.json"), "utf8"));
    expect(clear).toHaveBeenCalledOnce();
    expect(saved.tabs[0].history?.entries.map((entry: { url: string }) => entry.url))
      .toEqual(["https://example.com/current"]);
    expect(tab.canGoBack).toBe(false);
  });
});
