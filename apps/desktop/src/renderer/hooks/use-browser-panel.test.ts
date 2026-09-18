// @vitest-environment jsdom

import { createElement } from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  dispatch: vi.fn(),
  createTab: vi.fn(),
}));

vi.mock("@/lib/redux/hooks", () => ({
  useAppDispatch: () => harness.dispatch,
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({ appSettings: { browserPanelOpen: false } }),
}));

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/workspace/run-1" }),
}));

vi.mock("@/lib/layout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/layout")>()),
  shouldHideRightPanel: () => false,
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
    harness.createTab.mockResolvedValue({ success: true, data: {} });
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { browser: { createTab: harness.createTab } },
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
    );
    expect(harness.dispatch.mock.calls.map(([action]) => action.type)).toEqual([
      "appSettings/setRightPanelOpen",
      "appSettings/setSessionPanelOpen",
      "appSettings/setDocumentViewerOpen",
      "appSettings/setDocumentViewerDoc",
      "appSettings/setBrowserPanelOpen",
    ]);
  });
});
