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
import { runOwnerKey } from "../../../shared/ui-state-keys";

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
  browserService.visible = false;
  browserService.host = null;
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
