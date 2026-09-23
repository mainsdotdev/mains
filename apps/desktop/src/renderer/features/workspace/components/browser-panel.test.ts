// @vitest-environment jsdom

import { createElement } from "react";
import {
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
}));

vi.mock("@/hooks/use-browser-panel", () => ({
  useBrowserPanel: () => ({
    isOpen: true,
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
    onHistoryChanged: vi.fn(() => unsubscribe),
  };
}

describe("BrowserPanel browser menu", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    delete (window as unknown as { api?: unknown }).api;
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
