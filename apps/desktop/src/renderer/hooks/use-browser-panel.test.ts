// @vitest-environment jsdom

import { createElement } from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  dispatch: vi.fn(),
  createTab: vi.fn(),
  setContext: vi.fn(),
  pathname: "/workspace/run-1",
  browserPanelOpen: false,
}));

vi.mock("@/lib/redux/hooks", () => ({
  useAppDispatch: () => harness.dispatch,
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({
      appSettings: { browserPanelOpen: harness.browserPanelOpen },
      workspace: { composerContextKey: "chat-1", composerContextReady: true },
    }),
}));

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: harness.pathname }),
}));

vi.mock("@/lib/layout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/layout")>()),
  shouldHideRightPanel: (pathname: string) => pathname === "/settings",
}));

import {
  BrowserPanelProvider,
  useBrowserPanel,
} from "./use-browser-panel";

describe("BrowserPanelProvider", () => {
  let panel: ReturnType<typeof useBrowserPanel> | null = null;

  function Consumer() {
    panel = useBrowserPanel();
    return null;
  }

  beforeEach(() => {
    panel = null;
    vi.clearAllMocks();
    harness.pathname = "/workspace/run-1";
    harness.browserPanelOpen = false;
    harness.createTab.mockResolvedValue({ success: true, data: {} });
    harness.setContext.mockResolvedValue({ success: true, data: {} });
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { browser: { createTab: harness.createTab, setContext: harness.setContext } },
    });
  });

  it("opens an external URL in a new in-app browser tab", async () => {
    render(
      createElement(
        BrowserPanelProvider,
        null,
        createElement(Consumer),
      ),
    );

    await act(async () => {
      await panel!.openUrl("https://www.skyscanner.com/transport/flights");
    });

    expect(harness.createTab).toHaveBeenCalledWith(
      "https://www.skyscanner.com/transport/flights",
      "chat-1",
    );
    expect(harness.setContext).toHaveBeenCalledWith("chat-1");
    expect(harness.setContext.mock.invocationCallOrder[0])
      .toBeLessThan(harness.createTab.mock.invocationCallOrder[0]);
    expect(harness.dispatch.mock.calls.map(([action]) => action.type)).toEqual([
      "appSettings/setRightPanelOpen",
      "appSettings/setSessionPanelOpen",
      "appSettings/setDocumentViewerOpen",
      "appSettings/setDocumentViewerDoc",
      "appSettings/setBrowserPanelOpen",
    ]);
  });

  it("hides on Settings without clearing the chat's open browser", () => {
    harness.pathname = "/settings";
    harness.browserPanelOpen = true;
    render(createElement(BrowserPanelProvider, null, createElement(Consumer)));
    expect(panel?.isOpen).toBe(false);
    expect(harness.dispatch).not.toHaveBeenCalled();
  });
});
