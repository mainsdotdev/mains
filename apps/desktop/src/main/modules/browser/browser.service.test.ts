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

function resetInMemory() {
  if (browserService.persistTimer) clearTimeout(browserService.persistTimer);
  browserService.persistTimer = null;
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
});
