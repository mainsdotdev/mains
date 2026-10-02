// @vitest-environment jsdom

import { createElement, Fragment, useMemo, type ComponentProps } from "react";
import { readFileSync } from "node:fs";
import { parse } from "postcss";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MainHeaderProvider, useSetMainHeader } from "@/hooks/use-main-header";
import { MainContent } from "@/components/layout/main/main-content";
import { ChatHeader } from "./chat-header";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  closePanel: vi.fn(),
  toggleExpanded: vi.fn(),
  setChatVisible: vi.fn(),
  setChatMode: vi.fn(),
  setChatHost: vi.fn(),
  expanded: false,
  chatVisible: true,
  chatMode: "input",
  sidebarCollapsed: false,
}));

vi.mock("@/hooks/use-browser-panel", () => ({
  useBrowserPanel: () => ({
    isOpen: true,
    isExpanded: mocks.expanded,
    chatMode: mocks.chatMode,
    setChatMode: mocks.setChatMode,
    chatVisible: mocks.chatVisible,
    setChatVisible: mocks.setChatVisible,
    setChatHost: mocks.setChatHost,
    toggleExpanded: mocks.toggleExpanded,
    close: mocks.closePanel,
  }),
}));

vi.mock("@/lib/redux/hooks", () => ({
  useAppDispatch: () => mocks.dispatch,
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({ appSettings: { browserPanelWidth: 520, sidebarCollapsed: mocks.sidebarCollapsed } }),
}));

vi.mock("@/lib/redux/api", () => ({
  useGetRunByIdQuery: (runId: string) => ({ currentData: { id: runId, title: runId, goal: null } }),
}));
vi.mock("./chat-actions-menu", () => ({
  ChatActionsMenu: () => createElement("button", null, "Chat options"),
}));

import { BrowserPanel } from "./browser-panel";

function ConversationBrowser({ title, enabled }: { title: string | null; enabled: boolean }) {
  const header = useMemo(() => enabled
    ? title ? createElement(ChatHeader, { runId: title, variant: "codex" }) : null
    : createElement("div", null, "Code workspace tabs"), [title, enabled]);
  useSetMainHeader(header, enabled && !mocks.expanded);
  const browserTabsInHeader = enabled && mocks.expanded;
  const mainProps: Omit<ComponentProps<typeof MainContent>, "children"> = {
    marginLeft: "22rem",
    marginRight: browserTabsInHeader ? "0.375rem" : "38rem",
    browserOpen: true,
    browserTabsInHeader,
    sidebarCollapsed: mocks.sidebarCollapsed,
    headerHidden: mocks.expanded && !enabled,
  };
  return createElement(Fragment, null,
    createElement(MainContent, mainProps as ComponentProps<typeof MainContent>,
      createElement("div", { "data-workspace-route": "" }, "Chat transcript")),
    createElement(BrowserPanel, { tabsInMainHeader: browserTabsInHeader }),
  );
}

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

const blankTab = {
  tabId: "blank-tab",
  url: "about:blank",
  title: "New tab",
  faviconUrl: null,
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  isCrashed: false,
  zoomFactor: 1,
  deviceEmulation: {
    enabled: false,
    presetId: "responsive",
    width: 393,
    height: 852,
    deviceScaleFactor: 2,
    scale: 1,
  },
};

function createBrowserApi() {
  const unsubscribe = () => undefined;
  return {
    attach: vi.fn().mockResolvedValue({
      success: true,
      data: { activeTabId: blankTab.tabId, tabs: [blankTab] },
    }),
    detach: vi.fn().mockResolvedValue({ success: true, data: null }),
    setBounds: vi.fn().mockResolvedValue({ success: true, data: null }),
    setVisible: vi.fn().mockResolvedValue({ success: true, data: null }),
    createTab: vi.fn().mockResolvedValue({ success: true, data: null }),
    activateTab: vi.fn().mockResolvedValue({ success: true, data: null }),
    navigate: vi.fn().mockResolvedValue({ success: true, data: null }),
    getState: vi.fn().mockResolvedValue({
      success: true,
      data: { activeTabId: blankTab.tabId, tabs: [blankTab] },
    }),
    getDownloads: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getHistory: vi.fn().mockResolvedValue({ success: true, data: [] }),
    captureScreenshot: vi.fn().mockResolvedValue({
      success: false,
      error: "No browser tab",
    }),
    deleteCapture: vi.fn().mockResolvedValue({ success: true, data: null }),
    setSelectMode: vi.fn().mockResolvedValue({ success: true, data: { enabled: false } }),
    onStateChanged: vi.fn((_listener: (state: { activeTabId: string; tabs: typeof blankTab[] }) => void) => unsubscribe),
    onSelectModeChanged: vi.fn((_listener: (state: { enabled: boolean }) => void) => unsubscribe),
    onSelection: vi.fn(() => unsubscribe),
    onFindResult: vi.fn(() => unsubscribe),
    onShortcut: vi.fn(() => unsubscribe),
    onDownloadsChanged: vi.fn(() => unsubscribe),
    onHistoryChanged: vi.fn((_listener: (entries: unknown[]) => void) => unsubscribe),
  };
}

describe("BrowserPanel browser menu", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    mocks.expanded = false;
    mocks.chatVisible = true;
    mocks.chatMode = "input";
    mocks.sidebarCollapsed = false;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    delete (window as unknown as { api?: unknown }).api;
  });

  it("exits annotation mode with Escape while the toolbar is focused and no items are selected", async () => {
    const api = createBrowserApi();
    const loadedTab = { ...blankTab, url: "https://mains.dev/", title: "Mains" };
    const state = { success: true, data: { activeTabId: loadedTab.tabId, tabs: [loadedTab] } };
    api.getState.mockResolvedValue(state);
    api.attach.mockResolvedValue(state);
    Object.defineProperty(window, "api", { configurable: true, value: { browser: api } });
    render(createElement(BrowserPanel));
    await screen.findByRole("tab", { name: "Mains" });
    const modeChanged = api.onSelectModeChanged.mock.calls[0][0];
    act(() => modeChanged({ enabled: true }));
    const annotate = screen.getByRole("button", { name: "Exit annotation mode" });
    annotate.focus();
    fireEvent.keyDown(annotate, { key: "Escape" });
    expect(api.setSelectMode).toHaveBeenCalledExactlyOnceWith(false);
    act(() => modeChanged({ enabled: false }));
    fireEvent.keyDown(annotate, { key: "Escape" });
    expect(api.setSelectMode).toHaveBeenCalledOnce();
  });

  it("places expand beside close and fills the workspace on expansion", async () => {
    const api = createBrowserApi();
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { browser: api },
    });

    const { unmount } = render(createElement(BrowserPanel));
    await screen.findByRole("tab", { name: "New tab" });
    const expand = screen.getByRole("button", { name: "Expand browser" });
    const close = screen.getByRole("button", { name: "Close browser" });
    expect(expand.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(expand);
    expect(mocks.toggleExpanded).toHaveBeenCalledOnce();

    unmount();
    mocks.expanded = true;
    const { rerender } = render(createElement(BrowserPanel));
    await screen.findByRole("tab", { name: "New tab" });
    expect(screen.getByRole("complementary", { name: "Embedded browser" }).getAttribute("style"))
      .toContain("calc(100% - var(--content-left)");
    expect(screen.getByRole("button", { name: "Restore browser panel" })).toBeTruthy();
    expect(screen.getByLabelText("Browser chat")).toBeTruthy();
    expect(screen.getByLabelText("Browser chat").className).toContain("absolute inset-0");
    mocks.chatMode = "details";
    rerender(createElement(BrowserPanel));
    fireEvent.click(screen.getByRole("button", { name: "Collapse chat to input" }));
    expect(mocks.setChatMode).toHaveBeenCalledWith("input");
    mocks.chatMode = "input";
    rerender(createElement(BrowserPanel));
    expect(screen.getByRole("button", { name: "Interact with browser page" })).toBeTruthy();
    await waitFor(() => expect(api.setVisible).toHaveBeenCalledWith(false), { timeout: 2000 });
    fireEvent.click(screen.getByRole("button", { name: "Interact with browser page" }));
    expect(mocks.setChatVisible).toHaveBeenCalledWith(false);
    api.setVisible.mockClear();
    mocks.chatVisible = false;
    rerender(createElement(BrowserPanel));
    expect(screen.queryByLabelText("Browser chat")).toBeNull();
    await waitFor(() => expect(api.setVisible).toHaveBeenCalledWith(true));
    expect(screen.queryByLabelText("Resize browser panel")).toBeNull();
  });

  it("keeps the floating chat open while navigating and changing browser tabs", async () => {
    mocks.expanded = true;
    const secondTab = { ...blankTab, tabId: "second", title: "Second tab" };
    const api = createBrowserApi();
    api.getState.mockResolvedValue({
      success: true,
      data: { activeTabId: blankTab.tabId, tabs: [blankTab, secondTab] },
    });
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { browser: api },
    });

    render(createElement(BrowserPanel));
    fireEvent.click(await screen.findByRole("tab", { name: "Second tab" }));
    const address = screen.getByRole("combobox", { name: "Search or enter address" });
    fireEvent.change(address, { target: { value: "https://mains.dev" } });
    fireEvent.keyDown(address, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "New browser tab" }));

    expect(api.activateTab).toHaveBeenCalledWith("second");
    expect(api.navigate).toHaveBeenCalledWith("https://mains.dev");
    expect(api.createTab).toHaveBeenCalled();
    expect(mocks.setChatVisible).not.toHaveBeenCalled();
  });

  it("keeps one chat tab with its options beside the browser tabs while floating chat stays mounted", async () => {
    mocks.expanded = true;
    const api = createBrowserApi();
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { browser: api, app: { onFullscreenChange: () => () => {} } },
    });
    const content = (title: string, enabled = true) => createElement(
      MainHeaderProvider,
      null,
      createElement(ConversationBrowser, { title, enabled }),
    );
    const view = render(content("First chat"));
    const tabs = await screen.findByRole("tablist", { name: "Browser tabs" });
    const chatStage = screen.getByLabelText("Browser chat");
    for (const title of ["First chat", "Second chat"]) {
      view.rerender(content(title));
      const chatTab = screen.getByRole("tab", { name: title });
      const actions = screen.getByRole("button", { name: "Chat options" });
      const panel = screen.getByRole("complementary", { name: "Embedded browser" });
      expect(chatTab.closest("main")).toBeTruthy();
      expect(chatTab.getAttribute("aria-selected")).toBe("false");
      expect(chatTab.contains(actions)).toBe(true);
      expect(screen.getAllByRole("tablist", { name: "Chat tabs" })).toHaveLength(1);
      expect(screen.getByRole("tab", { name: "New tab" }).getAttribute("aria-selected")).toBe("true");
      expect(tabs.closest("main")).toBe(chatTab.closest("main"));
      expect(panel.contains(chatTab)).toBe(false);
      expect(panel.contains(tabs)).toBe(false);
      expect(panel.style.top).toBe("var(--shell-header-height)");
      expect(chatTab.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(actions.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.getByLabelText("Browser chat")).toBe(chatStage);
    }
    fireEvent.click(screen.getByRole("button", { name: "Chat options" }));
    expect(mocks.toggleExpanded).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Second chat" }));
    expect(mocks.toggleExpanded).toHaveBeenCalledTimes(1);

    // Code keeps its existing browser-only toolbar, including floating chat.
    view.rerender(content("Second chat", false));
    expect(screen.queryByRole("tab", { name: "Second chat" })).toBeNull();
    expect(screen.getByRole("tablist", { name: "Browser tabs" }).closest("[data-browser-panel]")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Chat options" })).toBeNull();
    expect(screen.getByLabelText("Browser chat")).toBe(chatStage);

    // Docked panels leave the single conversation tab in the main header.
    mocks.expanded = false;
    view.rerender(content("Second chat"));
    const restoredChatTab = screen.getByRole("tab", { name: "Second chat" });
    expect(restoredChatTab.closest("main")).toBeTruthy();
    expect(restoredChatTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tablist", { name: "Browser tabs" }).closest("[data-browser-panel]")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Chat options" }).closest("main")).toBeTruthy();
    expect(mocks.setChatVisible).not.toHaveBeenCalled();
  });

  it("joins the first browser tab to the content on the Work/Chat new chat screen, including hover", async () => {
    // Exercise the real corner rules with the tabs portaled away from the panel.
    const stylesheet = parse(readFileSync("src/renderer/index.css", "utf8"));
    const styles = document.createElement("style");
    styles.textContent = "[data-browser-content], [data-main-content-surface], [data-workspace-route] { border-top-left-radius: 16px; }";
    stylesheet.walkRules((rule) => {
      if (rule.selector.includes("[data-browser-content]")) styles.textContent += rule.toString();
    });
    document.head.append(styles);

    try {
      const api = createBrowserApi();
      const secondTab = { ...blankTab, tabId: "second", title: "Second tab" };
      const tabs = [blankTab, secondTab];
      const state = { activeTabId: blankTab.tabId, tabs };
      api.attach.mockResolvedValue({ success: true, data: state });
      api.getState.mockResolvedValue({ success: true, data: state });
      Object.defineProperty(window, "api", {
        configurable: true,
        value: { browser: api, app: { onFullscreenChange: () => () => {} } },
      });
      const content = (title: string | null = null, enabled = true) => createElement(
        MainHeaderProvider,
        null,
        createElement("div", { className: "app-root" }, createElement(ConversationBrowser, { title, enabled })),
      );
      const view = render(content());
      await screen.findByRole("tab", { name: "New tab" });
      mocks.expanded = true;
      view.rerender(content());
      const firstTab = await screen.findByRole("tab", { name: "New tab" });
      const panel = screen.getByRole("complementary", { name: "Embedded browser" });
      const surface = panel.querySelector("[data-browser-content]")!;
      const mainSurface = firstTab.closest("main")!.querySelector("[data-main-content-surface]")!;
      const workspaceSurface = screen.getByText("Chat transcript");
      expect(panel.contains(firstTab)).toBe(false);
      expect(getComputedStyle(surface).borderTopLeftRadius).toBe("0px");
      // The underlying surfaces must join immediately, while the panel's
      // width transition is still travelling toward the header's left edge.
      expect(getComputedStyle(mainSurface).borderTopLeftRadius).toBe("0px");
      expect(getComputedStyle(workspaceSurface).borderTopLeftRadius).toBe("0px");
      fireEvent.mouseEnter(firstTab);
      expect(getComputedStyle(surface).borderTopLeftRadius).toBe("0px");
      expect(firstTab.closest("main")!.classList.contains("overflow-visible")).toBe(true);

      const onStateChanged = api.onStateChanged.mock.calls[0][0];
      act(() => onStateChanged({ activeTabId: secondTab.tabId, tabs }));
      expect(getComputedStyle(surface).borderTopLeftRadius).toBe("16px");
      expect(getComputedStyle(mainSurface).borderTopLeftRadius).toBe("16px");
      expect(getComputedStyle(workspaceSurface).borderTopLeftRadius).toBe("16px");
      act(() => onStateChanged(state));
      expect(getComputedStyle(surface).borderTopLeftRadius).toBe("0px");

      mocks.sidebarCollapsed = true;
      view.rerender(content());
      expect(getComputedStyle(surface).borderTopLeftRadius).toBe("16px");
      mocks.sidebarCollapsed = false;
      view.rerender(content("Existing chat"));
      expect(getComputedStyle(surface).borderTopLeftRadius).toBe("16px");

      // Code and docked browsers retain their existing edge connection.
      view.rerender(content(null, false));
      expect(panel.contains(screen.getByRole("tab", { name: "New tab" }))).toBe(true);
      expect(getComputedStyle(surface).borderTopLeftRadius).toBe("0px");
      mocks.expanded = false;
      view.rerender(content());
      expect(getComputedStyle(surface).borderTopLeftRadius).toBe("0px");
    } finally {
      styles.remove();
    }
  });

  it("compacts the floating chat when the browser toolbar is used", async () => {
    mocks.expanded = true;
    mocks.chatMode = "details";
    const api = createBrowserApi();
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { browser: api },
    });

    render(createElement(BrowserPanel));
    const newTab = await screen.findByRole("button", { name: "New browser tab" });
    fireEvent.pointerDown(newTab);
    expect(mocks.setChatMode).toHaveBeenCalledWith("input");
  });

  it("opens on a blank tab, keeps global sections available, and disables page actions", async () => {
    const api = createBrowserApi();
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { browser: api },
    });

    render(createElement(BrowserPanel));
    await screen.findByRole("tab", { name: "New tab" });

    fireEvent.click(screen.getByRole("button", { name: "Open browser menu" }));

    const menu = await screen.findByRole("menu", { name: "Browser menu" });
    expect(menu).toBeTruthy();
    expect(api.captureScreenshot).not.toHaveBeenCalled();
    expect(api.setVisible).toHaveBeenCalledWith(false);

    for (const name of [
      "Find in page",
      "Print…",
      "Show device toolbar",
      "Take a screenshot",
      "Capture full page",
    ]) {
      expect(
        (
          screen
            .getByText(name, { exact: true })
            .closest("button") as HTMLButtonElement
        ).disabled,
      ).toBe(true);
    }

    for (const name of ["Zoom out", "Zoom in", "Reset zoom"]) {
      expect(
        (screen.getByRole("menuitem", { name }) as HTMLButtonElement).disabled,
      ).toBe(true);
    }

    for (const name of ["Downloads", "History", "Clear browsing data"]) {
      expect(
        (screen.getByRole("menuitem", { name }) as HTMLButtonElement).disabled,
      ).toBe(false);
    }

    fireEvent.click(screen.getByRole("menuitem", { name: "History" }));
    await waitFor(() => {
      expect(screen.getByText("No history yet")).toBeTruthy();
    });
  });

  it("lets a history suggestion receive a click on a blank tab", async () => {
    const user = userEvent.setup();
    const api = createBrowserApi();
    api.getHistory.mockResolvedValue({
      success: true,
      data: [
        {
          id: "mains",
          url: "https://mains.dev/",
          title: "Mains",
          faviconUrl: null,
          visitedAt: "2026-09-23T15:00:00.000Z",
          visitCount: 1,
        },
      ],
    });
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { browser: api },
    });

    render(createElement(BrowserPanel));
    const input = await screen.findByRole("combobox", {
      name: "Search or enter address",
    });
    await screen.findByRole("tab", { name: "New tab" });
    await waitFor(() => expect(api.getHistory).toHaveBeenCalled());

    await user.click(input);
    const suggestion = await screen.findByRole("option", { name: /Mains/ });
    await waitFor(() => {
      expect(api.setVisible).toHaveBeenCalledWith(false);
    });
    expect(api.captureScreenshot).not.toHaveBeenCalled();

    await user.click(suggestion.querySelector("button") as HTMLButtonElement);
    expect(api.navigate).toHaveBeenCalledWith("https://mains.dev/");
  });

  it("opens recent pages in the blank tab and updates them when history changes", async () => {
    const user = userEvent.setup();
    const api = createBrowserApi();
    const recent = {
      id: "mains-recent",
      url: "https://mains.dev/",
      title: "Mains",
      faviconUrl: null,
      visitedAt: "2026-09-30T15:00:00.000Z",
      visitCount: 1,
    };
    api.getHistory.mockResolvedValue({
      success: true,
      data: [recent, { ...recent, id: "mains-older" }],
    });
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { browser: api },
    });

    render(createElement(BrowserPanel));
    const section = await screen.findByRole("region", { name: "Recent tabs" });
    expect(section.querySelectorAll("button")).toHaveLength(1);
    expect(screen.queryByText("A fresh tab, ready when you are.")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Mains" }));
    expect(api.navigate).toHaveBeenCalledWith(recent.url);
    expect(api.createTab).not.toHaveBeenCalled();

    const historyChanged = api.onHistoryChanged.mock.calls[0][0];
    act(() => historyChanged([]));
    await screen.findByText("A fresh tab, ready when you are.");
    expect(screen.queryByRole("region", { name: "Recent tabs" })).toBeNull();
  });

  it("hides a loaded page after a failed preview so a suggestion can be clicked", async () => {
    const user = userEvent.setup();
    const api = createBrowserApi();
    const loadedTab = {
      ...blankTab,
      url: "https://mains.dev/",
      title: "Mains",
    };
    api.getState.mockResolvedValue({
      success: true,
      data: { activeTabId: loadedTab.tabId, tabs: [loadedTab] },
    });
    api.attach.mockResolvedValue({
      success: true,
      data: { activeTabId: loadedTab.tabId, tabs: [loadedTab] },
    });
    api.getHistory.mockResolvedValue({
      success: true,
      data: [
        {
          id: "okan",
          url: "https://okanbilal.com/",
          title: "Okan Bilal",
          faviconUrl: null,
          visitedAt: "2026-09-23T15:00:00.000Z",
          visitCount: 1,
        },
      ],
    });
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { browser: api },
    });

    render(createElement(BrowserPanel));
    const input = await screen.findByRole("combobox", {
      name: "Search or enter address",
    });
    await waitFor(() => expect(api.getHistory).toHaveBeenCalled());

    await user.click(input);
    await user.clear(input);
    await user.type(input, "okan");
    const suggestion = await screen.findByRole("option", {
      name: /Okan Bilal/,
    });
    await waitFor(() => {
      expect(api.captureScreenshot).toHaveBeenCalledWith("viewport");
      expect(api.setVisible).toHaveBeenCalledWith(false);
    });

    await user.click(suggestion.querySelector("button") as HTMLButtonElement);
    expect(api.navigate).toHaveBeenCalledWith("https://okanbilal.com/");
  });

  it.each(["mouse", "keyboard"])("clears the address with the %s, keeps input focus and refreshes suggestions without navigating", async (interaction) => {
    const user = userEvent.setup();
    const api = createBrowserApi();
    const loadedTab = { ...blankTab, url: "https://mains.dev/", title: "Mains" };
    const state = { success: true, data: { activeTabId: loadedTab.tabId, tabs: [loadedTab] } };
    api.getState.mockResolvedValue(state);
    api.attach.mockResolvedValue(state);
    api.getHistory.mockResolvedValue({
      success: true,
      data: [
        { id: "mains", url: "https://mains.dev/", title: "Mains", faviconUrl: null, visitedAt: "2026-10-02T01:00:00.000Z", visitCount: 1 },
        { id: "docs", url: "https://docs.mains.dev/", title: "Docs", faviconUrl: null, visitedAt: "2026-10-02T00:00:00.000Z", visitCount: 1 },
      ],
    });
    Object.defineProperty(window, "api", { configurable: true, value: { browser: api } });
    render(createElement(BrowserPanel));
    await screen.findByRole("tab", { name: "Mains" });
    const input = screen.getByRole("combobox", { name: "Search or enter address" }) as HTMLInputElement;
    await user.click(input);
    await user.clear(input);
    await user.type(input, "docs");
    await screen.findByRole("option", { name: /Docs/ });
    expect(screen.queryByRole("option", { name: /^Mains/ })).toBeNull();
    const clear = screen.getByRole("button", { name: "Clear address" });
    if (interaction === "keyboard") {
      await user.tab();
      expect(document.activeElement).toBe(clear);
      await user.keyboard("{Enter}");
    } else {
      await user.click(clear);
    }
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole("button", { name: "Clear address" })).toBeNull();
    await screen.findByRole("option", { name: /^Mains/ });
    expect(api.navigate).not.toHaveBeenCalled();
    await user.type(input, "new search");
    await user.keyboard("{Enter}");
    expect(api.navigate).toHaveBeenCalledWith("new search");
  });

  it("shows suggestions only after the native page has been hidden", async () => {
    const user = userEvent.setup();
    const api = createBrowserApi();
    const loadedTab = {
      ...blankTab,
      url: "https://mains.dev/",
      title: "Mains",
    };
    api.getState.mockResolvedValue({
      success: true,
      data: { activeTabId: loadedTab.tabId, tabs: [loadedTab] },
    });
    let resolveCapture!: (value: { success: false; error: string }) => void;
    api.captureScreenshot.mockReturnValue(
      new Promise((resolve) => {
        resolveCapture = resolve;
      }),
    );
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { browser: api },
    });

    render(createElement(BrowserPanel));
    await screen.findByRole("tab", { name: "Mains" });
    await user.click(
      screen.getByRole("combobox", { name: "Search or enter address" }),
    );
    await waitFor(() => expect(api.captureScreenshot).toHaveBeenCalled());
    expect(screen.queryByRole("listbox", { name: "Address suggestions" })).toBeNull();
    expect(api.setVisible).not.toHaveBeenCalledWith(false);

    resolveCapture({ success: false, error: "Failed to capture page" });
    await screen.findByRole("listbox", { name: "Address suggestions" });
    expect(api.setVisible).toHaveBeenCalledWith(false);
  });
});
