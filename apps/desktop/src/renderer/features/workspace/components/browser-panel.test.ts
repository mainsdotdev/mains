// @vitest-environment jsdom

import { createElement } from "react";
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
    selector({ appSettings: { browserPanelWidth: 520 } }),
}));

import { BrowserPanel } from "./browser-panel";

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
    onStateChanged: vi.fn(() => unsubscribe),
    onSelectModeChanged: vi.fn(() => unsubscribe),
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
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    delete (window as unknown as { api?: unknown }).api;
  });

  it("places expand beside close and fills the workspace on expansion", async () => {
    const api = createBrowserApi();
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { browser: api },
    });

    const { unmount } = render(createElement(BrowserPanel));
    await screen.findByRole("button", { name: "Open New tab" });
    const expand = screen.getByRole("button", { name: "Expand browser" });
    const close = screen.getByRole("button", { name: "Close browser" });
    expect(expand.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(expand);
    expect(mocks.toggleExpanded).toHaveBeenCalledOnce();

    unmount();
    mocks.expanded = true;
    const { rerender } = render(createElement(BrowserPanel));
    await screen.findByRole("button", { name: "Open New tab" });
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
    fireEvent.click(await screen.findByRole("button", { name: "Open Second tab" }));
    const address = screen.getByRole("combobox", { name: "Search or enter address" });
    fireEvent.change(address, { target: { value: "https://mains.dev" } });
    fireEvent.keyDown(address, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "New browser tab" }));

    expect(api.activateTab).toHaveBeenCalledWith("second");
    expect(api.navigate).toHaveBeenCalledWith("https://mains.dev");
    expect(api.createTab).toHaveBeenCalled();
    expect(mocks.setChatVisible).not.toHaveBeenCalled();
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
    await screen.findByRole("button", { name: "Open New tab" });

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
    await screen.findByRole("button", { name: "Open New tab" });
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
    await screen.findByRole("button", { name: "Open Mains" });
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
