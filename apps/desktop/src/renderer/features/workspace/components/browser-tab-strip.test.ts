// @vitest-environment jsdom

import { createElement } from "react";
import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({
  useCapabilities: () => ({ windowChrome: true }),
}));

import { BrowserTabStrip } from "./browser-tab-strip";

describe("BrowserTabStrip", () => {
  it("clears the traffic lights only while the browser is expanded beside a collapsed sidebar", () => {
    let onFullscreenChange: ((fullscreen: boolean) => void) | undefined;
    Object.defineProperty(window, "api", {
      configurable: true,
      value: {
        app: {
          onFullscreenChange: (callback: (fullscreen: boolean) => void) => {
            onFullscreenChange = callback;
            return () => undefined;
          },
        },
      },
    });
    const props = {
      tabs: [],
      activeTabId: "",
      onActivate: vi.fn(),
      onClose: vi.fn(),
      onCreate: vi.fn(),
      onClosePanel: vi.fn(),
      isExpanded: true,
      sidebarCollapsed: true,
      onToggleExpanded: vi.fn(),
    };
    const { container, rerender, unmount } = render(createElement(BrowserTabStrip, props));

    expect(container.firstElementChild?.className).toContain("pl-16");
    rerender(createElement(BrowserTabStrip, { ...props, sidebarCollapsed: false }));
    expect(container.firstElementChild?.className).toContain("pl-2");
    rerender(createElement(BrowserTabStrip, props));
    act(() => onFullscreenChange?.(true));
    expect(container.firstElementChild?.className).toContain("pl-2");
    unmount();
    delete (window as unknown as { api?: unknown }).api;
  });
});
