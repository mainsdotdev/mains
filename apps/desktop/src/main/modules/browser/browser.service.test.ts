import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { EventEmitter } from "node:events";

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
import { runOwnerKey, workspaceBrowserExpansionKey } from "../../../shared/ui-state-keys";
import type { BrowserSelectionPayload } from "./browser.dto";

function resetInMemory() {
  browserService.presentationLifecycle.retire();
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

  function liveView(record: NonNullable<ReturnType<typeof browserService.tabs.get>>, options: { audible?: boolean; dirty?: boolean } = {}) {
    const contents = Object.assign(new EventEmitter(), {
      isDestroyed: vi.fn(() => false), isCurrentlyAudible: () => !!options.audible,
      executeJavaScript: vi.fn(async (): Promise<unknown> => ({ url: record.url, x: 0, y: 500, fields: [{ selector: "#draft", value: "unsent-draft" }] })),
      isLoading: () => false, getURL: () => record.url, getTitle: () => "Page", getZoomFactor: () => 1,
      navigationHistory: { canGoBack: () => false, canGoForward: () => false, getActiveIndex: () => 0,
        getAllEntries: () => [{ url: record.url, title: "Page", pageState: "opaque-form-and-scroll-state" }] },
      close: vi.fn((_options: unknown) => {
        if (options.dirty) contents.emit("will-prevent-unload", {});
        else { contents.isDestroyed.mockReturnValue(true); contents.emit("destroyed"); }
      }),
    });
    record.view = { webContents: contents, setVisible: vi.fn() } as unknown as typeof record.view;
    return contents;
  }

  it("does not let a slower tab activation replace the user's newer selection", async () => {
    await browserService.createTab("https://example.com/a");
    const first = browserService.activeTabId!;
    await browserService.createTab("https://example.com/b");
    const second = browserService.activeTabId!;
    await browserService.createTab("https://example.com/c");
    const third = browserService.activeTabId!;
    browserService.activeTabId = first;
    const contents = liveView(browserService.tabs.get(first)!);
    let release!: (value: unknown) => void;
    contents.executeJavaScript.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    browserService.selectMode = true;
    const older = browserService.activateTab(second);
    await browserService.activateTab(third);
    release(undefined);
    await older;
    expect(browserService.getState().activeTabId).toBe(third);
  });

  it("retires pending activation across a conversation switch away and back", async () => {
    await browserService.setContext("chat-a");
    await browserService.createTab("https://example.com/a");
    const first = browserService.activeTabId!;
    await browserService.createTab("https://example.com/b");
    const second = browserService.activeTabId!;
    browserService.activeTabId = first;
    const contents = liveView(browserService.tabs.get(first)!);
    let release!: (value: unknown) => void;
    contents.executeJavaScript.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    browserService.selectMode = true;
    const activating = browserService.activateTab(second);
    await browserService.setContext("chat-b");
    await browserService.setContext("chat-a");
    release(undefined); await activating;
    expect(browserService.getState().activeTabId).toBe(first);
  });

  it("does not report activation of a tab that has already closed or moved to another conversation", async () => {
    await browserService.createTab("https://example.com/keep");
    const keep = browserService.activeTabId!;
    await browserService.createTab("https://example.com/closing");
    const closingId = browserService.activeTabId!;
    await browserService.closeTab(closingId);
    await expect(browserService.activateTab(closingId)).resolves.toMatchObject({ activeTabId: keep });
    await expect(browserService.closeTab(closingId)).resolves.toMatchObject({ activeTabId: keep, tabs: [{ tabId: keep }] });

    await browserService.setContext("chat-a");
    await browserService.createTab("https://example.com/a");
    const leftBehind = browserService.activeTabId!;
    await browserService.setContext("chat-b");
    await browserService.createTab("https://example.com/b");
    const current = browserService.activeTabId!;
    await expect(browserService.activateTab(leftBehind)).resolves.toMatchObject({
      activeTabId: current,
      ownerKey: "chat-b",
    });
  });

  it("does not let a closing target retire another valid pending activation", async () => {
    await browserService.createTab("https://example.com/current");
    const current = browserService.activeTabId!;
    await browserService.createTab("https://example.com/next");
    const next = browserService.activeTabId!;
    await browserService.createTab("https://example.com/closing");
    const closingId = browserService.activeTabId!;
    browserService.activeTabId = current;
    const contents = liveView(browserService.tabs.get(current)!);
    const closingContents = liveView(browserService.tabs.get(closingId)!);
    closingContents.close.mockImplementation(() => {});
    const closing = browserService.closeTab(closingId);
    let ready!: (value: unknown) => void;
    contents.executeJavaScript.mockImplementationOnce(() => new Promise((resolve) => { ready = resolve; }));
    browserService.selectMode = true;
    const activating = browserService.activateTab(next);
    try {
      await browserService.activateTab(closingId);
      ready(undefined); await activating;
      expect(browserService.getState().activeTabId).toBe(next);
    } finally {
      closingContents.isDestroyed.mockReturnValue(true); closingContents.emit("destroyed"); await closing;
    }
  });

  it("hibernates the oldest inactive page over the live-tab budget and keeps form state only in memory", async () => {
    const records = [];
    for (let i = 0; i < 4; i++) {
      await browserService.createTab(`https://example.com/${i}`);
      const record = browserService.tabs.get(browserService.activeTabId!)!;
      record.lastUsedAt = i;
      records.push(record);
      liveView(record);
    }
    browserService.visible = true;
    await browserService._trimLiveViews();
    expect(records[0].view).toBeNull();
    expect(records[0].suspendedHistory?.entries[0].pageState).toBe("opaque-form-and-scroll-state");
    expect(records[0].suspendedPageState?.fields[0].value).toBe("unsent-draft");
    expect(records.slice(1).every((record) => record.view)).toBe(true);
    browserService._persistNow();
    expect(readFileSync(join(harness.userData, "browser-tabs.json"), "utf8")).not.toContain("opaque-form");
    expect(readFileSync(join(harness.userData, "browser-tabs.json"), "utf8")).not.toContain("unsent-draft");
  });

  it("does not force pages with unsaved work or audio to unload", async () => {
    await browserService.createTab("https://example.com/draft");
    const record = browserService.tabs.get(browserService.activeTabId!)!;
    const dirty = liveView(record, { dirty: true });
    expect(await browserService._hibernateTab(record)).toBe(false);
    expect(dirty.close).toHaveBeenCalledWith({ waitForBeforeUnload: true });
    expect(record.view).not.toBeNull();
    expect(record.suspendedHistory).toBeNull();
    const audio = liveView(record, { audible: true });
    expect(await browserService._hibernateTab(record)).toBe(false);
    expect(audio.close).not.toHaveBeenCalled();
  });

  it("keeps the tab, active view and attachment when a page vetoes explicit close", async () => {
    await browserService.createTab("https://example.com/unsaved");
    const id = browserService.activeTabId!;
    const record = browserService.tabs.get(id)!;
    const contents = liveView(record, { dirty: true });
    browserService.attached = true;
    browserService.visible = true;
    const state = await browserService.closeTab(id);
    expect(state.activeTabId).toBe(id);
    expect(state.tabs.map((tab) => tab.tabId)).toEqual([id]);
    expect(browserService.tabs.get(id)).toBe(record);
    expect(record.view?.webContents).toBe(contents);
    expect(record.isClosing).toBe(false);
    expect(browserService.attached).toBe(true);
    expect(browserService.visible).toBe(true);
    expect(contents.close).toHaveBeenCalledExactlyOnceWith({ waitForBeforeUnload: true });
  });

  it("joins repeated closes until native destruction is confirmed", async () => {
    await browserService.createTab("https://example.com/page");
    const id = browserService.activeTabId!;
    const contents = liveView(browserService.tabs.get(id)!);
    contents.close.mockImplementation(() => {});
    const first = browserService.closeTab(id), second = browserService.closeTab(id);
    expect(contents.close).toHaveBeenCalledOnce();
    expect(browserService.tabs.has(id)).toBe(true);
    contents.isDestroyed.mockReturnValue(true); contents.emit("destroyed");
    expect((await first).tabs).toEqual([]);
    expect((await second).tabs).toEqual([]);
    expect(contents.close).toHaveBeenCalledOnce();
  });
  it("shares native close when explicit close overlaps an idle suspension", async () => {
    await browserService.createTab("https://example.com/draft");
    const id = browserService.activeTabId!, record = browserService.tabs.get(id)!;
    const contents = liveView(record);
    contents.close.mockImplementation(() => {});
    const suspending = browserService._hibernateTab(record);
    await vi.waitFor(() => expect(contents.close).toHaveBeenCalledOnce());
    const closing = browserService.closeTab(id);
    expect(contents.close).toHaveBeenCalledOnce();
    expect(browserService.tabs.has(id)).toBe(true);
    contents.isDestroyed.mockReturnValue(true); contents.emit("destroyed");
    expect(await suspending).toBe(true);
    expect((await closing).tabs).toEqual([]);
    expect(contents.close).toHaveBeenCalledOnce();
  });
  it("retains a replacement view when an old native close finishes", async () => {
    await browserService.createTab("https://example.com/page");
    const id = browserService.activeTabId!, record = browserService.tabs.get(id)!;
    const old = liveView(record);
    old.close.mockImplementation(() => {});
    const closing = browserService.closeTab(id);
    const replacement = liveView(record);
    old.isDestroyed.mockReturnValue(true); old.emit("destroyed");
    expect((await closing).activeTabId).toBe(id);
    expect(record.view?.webContents).toBe(replacement);
    expect(replacement.close).not.toHaveBeenCalled();
    expect((await browserService.closeTab(id)).tabs).toEqual([]);
  });

  it("retains an unconfirmed close on timeout and allows a later retry", async () => {
    vi.useFakeTimers();
    try {
      await browserService.createTab("https://example.com/page");
      const id = browserService.activeTabId!, record = browserService.tabs.get(id)!;
      const contents = liveView(record);
      contents.close.mockImplementationOnce(() => {});
      const closing = browserService.closeTab(id);
      await vi.advanceTimersByTimeAsync(2_000);
      expect((await closing).activeTabId).toBe(id);
      expect(record.isClosing).toBe(false);
      expect(record.view?.webContents).toBe(contents);
      expect((await browserService.closeTab(id)).tabs).toEqual([]);
      expect(contents.close).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it("does not detach the new conversation when the old conversation's last tab finishes closing", async () => {
    await browserService.setContext("chat-a");
    await browserService.createTab("https://example.com/page");
    const id = browserService.activeTabId!;
    const contents = liveView(browserService.tabs.get(id)!);
    contents.close.mockImplementation(() => {});
    browserService.attached = true; browserService.visible = true;
    const closing = browserService.closeTab(id);
    await browserService.setContext("chat-b");
    await browserService.createTab("https://example.com/new-conversation");
    browserService.attached = true; browserService.visible = true;
    const nextId = browserService.activeTabId;
    contents.isDestroyed.mockReturnValue(true); contents.emit("destroyed");
    const state = await closing;
    expect(state.ownerKey).toBe("chat-b");
    expect(state.activeTabId).toBe(nextId);
    expect(browserService.attached).toBe(true);
    expect(browserService.visible).toBe(true);
    expect(browserService.tabs.has(id)).toBe(false);
  });

  it.each(["view", "navigation"])("discards a pending hibernation capture after its %s changes", async (change) => {
    await browserService.createTab("https://example.com/draft");
    const record = browserService.tabs.get(browserService.activeTabId!)!;
    const contents = liveView(record);
    let captured!: (value: unknown) => void;
    contents.executeJavaScript.mockImplementationOnce(() => new Promise((resolve) => { captured = resolve as typeof captured; }));
    const sleeping = browserService._hibernateTab(record);
    if (change === "view") liveView(record);
    else vi.spyOn(contents, "getURL").mockReturnValue("https://example.com/next");
    captured({ url: "https://example.com/draft", x: 0, y: 0, fields: [] });
    expect(await sleeping).toBe(false);
    expect(contents.close).not.toHaveBeenCalled();
    expect(record.suspendedPageState).toBeNull();
  });

  it("ignores callbacks from a replaced native view", async () => {
    await browserService.createTab("https://example.com/page");
    const record = browserService.tabs.get(browserService.activeTabId!)!;
    const old = liveView(record);
    Object.assign(old, { setWindowOpenHandler: vi.fn() });
    browserService._wireView(record, record.view!);
    const current = liveView(record);
    const reset = vi.spyOn(record.deviceEmulationQueue, "reset");
    old.emit("render-process-gone"); old.emit("destroyed");
    old.emit("page-favicon-updated", {}, ["https://example.com/old.ico"]);
    expect(record.view?.webContents).toBe(current);
    expect(record.isCrashed).toBe(false);
    expect(record.faviconUrl).toBeNull();
    expect(reset).not.toHaveBeenCalled();
  });

  it("keeps an oversized draft alive and cancels sleep if its tab reactivates during capture", async () => {
    await browserService.createTab("https://example.com/draft");
    const record = browserService.tabs.get(browserService.activeTabId!)!;
    const contents = liveView(record);
    contents.executeJavaScript.mockResolvedValueOnce({ overflow: true } as never);
    expect(await browserService._hibernateTab(record)).toBe(false);
    expect(contents.close).not.toHaveBeenCalled();
    let captured!: (state: unknown) => void;
    contents.executeJavaScript.mockImplementationOnce(() => new Promise((resolve) => { captured = resolve as typeof captured; }));
    const sleeping = browserService._hibernateTab(record);
    browserService.visible = true;
    captured({ url: record.url, x: 0, y: 0, fields: [] });
    expect(await sleeping).toBe(false);
    expect(contents.close).not.toHaveBeenCalled();
  });

  it("retains the live view and its draft backup when beforeunload times out", async () => {
    vi.useFakeTimers();
    try {
      await browserService.createTab("https://example.com/draft");
      const record = browserService.tabs.get(browserService.activeTabId!)!;
      const contents = liveView(record);
      contents.close.mockImplementation(() => {});
      const pending = browserService._hibernateTab(record);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await pending).toBe(false);
      expect(record.view).not.toBeNull();
      expect(record.suspendedPageState?.fields[0].value).toBe("unsent-draft");
    } finally { vi.useRealTimers(); }
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

  it("detaches the browser after closing the final tab without creating a replacement", async () => {
    await browserService.setContext("chat-a");
    await browserService.createTab("https://example.com/final");
    const tabId = browserService.getState().activeTabId;
    const contents = liveView(browserService.tabs.get(tabId)!);
    browserService.attached = true;
    browserService.visible = true;

    const state = await browserService.closeTab(tabId);

    expect(state).toEqual({ ownerKey: "chat-a", activeTabId: "", tabs: [] });
    expect(contents.close).toHaveBeenCalledOnce();
    expect(browserService.attached).toBe(false);
    expect(browserService.visible).toBe(false);
    expect(browserService.activeTabIdsByOwner["chat-a"]).toBeUndefined();
    browserService.setBounds({ x: 0, y: 0, width: 500, height: 600 });
    browserService.setVisible(true);
    expect(browserService.getState().tabs).toEqual([]);
    browserService._persistNow();
    expect(JSON.parse(readFileSync(join(harness.userData, "browser-tabs.json"), "utf8")).tabs)
      .toEqual([]);
  });

  it("keeps the browser attached when closing one of multiple tabs", async () => {
    await browserService.createTab("https://example.com/first");
    const firstTabId = browserService.getState().activeTabId;
    await browserService.createTab("https://example.com/second");
    const secondTabId = browserService.getState().activeTabId;
    browserService.attached = true;
    browserService.visible = true;

    const state = await browserService.closeTab(secondTabId);

    expect(state.activeTabId).toBe(firstTabId);
    expect(state.tabs.map((tab) => tab.tabId)).toEqual([firstTabId]);
    expect(browserService.attached).toBe(true);
    expect(browserService.visible).toBe(true);
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
    record.view = view;
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

  it.each(["cancel", "replacement", "conversation"])("discards a pending annotation and its screenshot after %s retirement", async (retirement) => {
    await browserService.setContext("chat-a");
    await browserService.createTab("https://example.com/docs");
    const record = browserService.tabs.get(browserService.activeTabId!)!;
    let finish!: (value: unknown) => void;
    const contents = liveView(record);
    contents.executeJavaScript.mockResolvedValue("ok");
    Object.assign(contents, { focus: vi.fn(), capturePage: vi.fn(() => new Promise((resolve) => { finish = resolve; })) });
    browserService.selectMode = true;
    const send = vi.spyOn(browserService, "_sendToRenderer").mockImplementation(() => {});
    const element = { selector: "h1", tagName: "h1", text: "Docs", styles: {},
      rect: { x: 0, y: 0, width: 10, height: 10 }, pageRect: { x: 0, y: 0, width: 10, height: 10 },
      scroll: { x: 0, y: 0 }, viewport: { width: 100, height: 100 }, devicePixelRatio: 1 };
    try {
      const capturing = browserService._handleSelection({ ...element, type: "browser_selection", url: record.url,
        title: "Docs", elements: [element], timestamp: "2026-11-09T12:00:00Z" }, record);
      if (retirement === "cancel") await browserService.setSelectMode(false);
      else if (retirement === "replacement") liveView(record);
      else {
        await browserService.setContext("chat-b"); await browserService.setContext("chat-a");
        await browserService.setSelectMode(true);
      }
      finish({ isEmpty: () => false, toPNG: () => Buffer.from("obsolete annotation") });
      await capturing;
      expect(send).not.toHaveBeenCalledWith(CHANNELS.browser.selection, expect.anything());
      expect(readdirSync(join(harness.userData, "browser-captures"))).toEqual([]);
    } finally { send.mockRestore(); }
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
    record.view = view;
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

  it("delivers only the retry when an older screenshot finishes after the newer capture", async () => {
    await browserService.createTab("https://example.com/docs");
    const record = browserService.tabs.get(browserService.activeTabId!)!;
    const contents = liveView(record);
    let finish!: (value: unknown) => void;
    const image = { isEmpty: () => false, toPNG: () => Buffer.from("annotation") };
    Object.assign(contents, { capturePage: vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue(image) });
    contents.executeJavaScript.mockResolvedValue("ok");
    browserService.selectMode = true;
    const element = { selector: "h1", tagName: "h1", text: "Docs", styles: {},
      rect: { x: 0, y: 0, width: 10, height: 10 }, pageRect: { x: 0, y: 0, width: 10, height: 10 },
      scroll: { x: 0, y: 0 }, viewport: { width: 100, height: 100 }, devicePixelRatio: 1 };
    const payload: Omit<BrowserSelectionPayload, "id"> = { ...element, type: "browser_selection", url: record.url,
      title: "Docs", elements: [element], timestamp: "2026-11-09T12:00:00Z" };
    const send = vi.spyOn(browserService, "_sendToRenderer").mockImplementation(() => {});
    try {
      const old = browserService._handleSelection({ ...payload, comment: "Old draft" }, record, "old");
      await browserService._handleSelection({ ...payload, comment: "Retry draft" }, record, "retry");
      finish(image); await old;
      const selections = send.mock.calls.filter(([channel]) => channel === CHANNELS.browser.selection);
      expect(selections).toHaveLength(1);
      expect(selections[0][1]).toMatchObject({ comment: "Retry draft" });
      expect(contents.executeJavaScript).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('"retry"'));
      expect(readdirSync(join(harness.userData, "browser-captures"))).toHaveLength(1);
    } finally { send.mockRestore(); }
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

  it("ignores a late inspector-enable receipt after selection mode was disabled", async () => {
    await browserService.createTab("https://example.com/docs");
    const record = browserService.tabs.get(browserService.activeTabId!)!;
    let finish!: (value: string) => void;
    const contents = { isDestroyed: () => false, focus: vi.fn(), executeJavaScript: vi.fn()
      .mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }))
      .mockResolvedValue("ok") };
    record.view = { webContents: contents } as unknown as typeof record.view;
    const enabling = browserService.setSelectMode(true);
    await browserService.setSelectMode(false);
    finish("installed"); await enabling;
    expect(browserService.selectMode).toBe(false);
    expect(contents.focus).not.toHaveBeenCalled();
  });

  it.each(["navigation", "escape"])("retires an inspector installation still awaiting its receipt on %s", async (retirement) => {
    await browserService.createTab("https://example.com/docs");
    const record = browserService.tabs.get(browserService.activeTabId!)!;
    let finish!: (value: string) => void;
    const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false, focus: vi.fn(), setWindowOpenHandler: vi.fn(),
      executeJavaScript: vi.fn().mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; })).mockResolvedValue("ok") });
    const view = { webContents: contents } as any;
    record.view = view;
    browserService._wireView(record, view);
    const enabling = browserService.setSelectMode(true);
    if (retirement === "navigation") contents.emit("did-start-navigation", {}, "https://example.com/next", false, true);
    else contents.emit("console-message", { message: '[[MAINS_BROWSER_SELECTION_V1]]{"cancel":true}' });
    finish("installed"); await enabling;
    expect(browserService.selectMode).toBe(false);
    expect(contents.focus).not.toHaveBeenCalled();
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

  it("consumes a visibility-triggered native acquisition failure and permits a later retry", async () => {
    await browserService.createTab("https://example.com/docs");
    browserService.attached = true;
    browserService.host = { isDestroyed: () => false, contentView: { children: [] } } as any;
    const ensure = vi.spyOn(browserService, "_ensureTabView").mockRejectedValue(new Error("Native view unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      browserService.setVisible(true);
      await new Promise((resolve) => setImmediate(resolve));
      expect(warn).toHaveBeenCalledWith("[browser] failed to present view:", expect.any(Error));
      browserService.setVisible(true);
      await new Promise((resolve) => setImmediate(resolve));
      expect(ensure).toHaveBeenCalledTimes(2);
    } finally { ensure.mockRestore(); warn.mockRestore(); }
  });

  it.each([false, true])("keeps obsolete mounting receipts from changing the presented view (reuse=%s)", async (reuse) => {
    await browserService.createTab("https://example.com/docs");
    const record = browserService.tabs.get(browserService.activeTabId!)!;
    browserService.attached = browserService.visible = true;
    const children: unknown[] = [];
    const addChildView = vi.fn((view) => { children.push(view); });
    browserService.host = { isDestroyed: () => false, contentView: { children, addChildView } } as unknown as typeof browserService.host;
    const old = { setVisible: vi.fn(), setBounds: vi.fn(), webContents: { isDestroyed: () => false, isLoading: () => true } };
    const replacement = reuse ? old : { setVisible: vi.fn(), setBounds: vi.fn(), webContents: { isDestroyed: () => false, isLoading: () => true } };
    let ready!: (value: unknown) => void;
    const ensure = vi.spyOn(browserService, "_ensureTabView").mockImplementationOnce(() => new Promise((resolve) => { ready = resolve as typeof ready; }))
      .mockResolvedValue(replacement as any);
    try {
      const mounting = browserService._mountActiveView();
      record.view = replacement as any;
      await browserService._mountActiveView();
      ready(old); await mounting;
      expect(children).toEqual([replacement]);
      if (!reuse) expect(old.setVisible).not.toHaveBeenCalledWith(true);
      expect(replacement.setVisible).toHaveBeenLastCalledWith(true);
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

  it("retains workspace browser pages after chat deletion and removes them with the workspace", async () => {
    const owner = workspaceBrowserExpansionKey("local", "ws-a");
    const other = workspaceBrowserExpansionKey("remote", "ws-a");
    await browserService.setContext(owner); await browserService.createTab("https://example.com/one");
    await browserService.createTab("https://example.com/two");
    await browserService.setContext(other); await browserService.createTab("https://example.com/remote");
    await browserService.forgetContext({ backendId: "local", kind: "run", id: "old-chat" });
    await browserService.setContext(owner);
    expect(browserService.getState().tabs).toHaveLength(2);
    await browserService.forgetContext({ backendId: "local", kind: "workspace", id: "ws-a" });
    expect(browserService.listOwnerKeys()).toEqual([other]);
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
