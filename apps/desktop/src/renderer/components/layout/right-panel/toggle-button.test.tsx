// @vitest-environment jsdom

import { createElement, StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LAYOUT_TOGGLE_WIDTH_VAR } from "@/lib/layout";
import { ToggleButton } from "./toggle-button";

const ui = vi.hoisted(() => ({ width: 88, resize: () => {} }));
vi.mock("@/lib/platform", () => ({ useCapabilities: () => ({ embeddedBrowser: true }) }));
vi.mock("@/hooks/use-mode-config", () => ({ useModeConfig: () => ({ showRightPanel: true }) }));
vi.mock("@/providers/keyboard-shortcuts-provider", () => ({ useKeyboardShortcutBinding: () => undefined }));
vi.mock("@/features/workspace/components/chat-actions-menu", () => ({ ChatActionsMenu: () => null }));

const onToggle = vi.fn();
function controls(browserOpen = false) {
  return createElement(StrictMode, null, createElement(ToggleButton, {
    isOpen: false, onClick: onToggle,
    onBrowserToggle: onToggle, browserOpen, showChatActions: false,
  }));
}

beforeEach(() => {
  onToggle.mockClear();
  ui.width = 88;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { width: this.hasAttribute("data-layout-toggle") ? ui.width : 0 } as DOMRect;
  });
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { ui.resize = callback; }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("fixed window controls", () => {
  it("keeps browser and right-panel toggles in order and mounted across preview changes", () => {
    const view = render(controls());
    const browser = screen.getByRole("button", { name: "Open browser" });
    const panel = screen.getByRole("button", { name: "Open right panel" });
    expect(screen.getAllByRole("button")).toEqual([browser, panel]);
    view.rerender(controls(true));
    expect(screen.getAllByRole("button")).toEqual([browser, panel]);
    expect(screen.getByRole("button", { name: "Close browser" })).toBe(browser);
    fireEvent.click(browser);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("places the shared new-tab launcher immediately left of RightPanel", () => {
    render(createElement(ToggleButton, { isOpen: false, onClick: onToggle,
      showChatActions: false, newTabAction: createElement("button", { "aria-label": "New preview tab" }, "+") }));
    expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label")))
      .toEqual(["New preview tab", "Open right panel"]);
  });

  it("publishes the measured group width and clears it when the controls leave", () => {
    const view = render(controls());
    expect(document.documentElement.style.getPropertyValue(LAYOUT_TOGGLE_WIDTH_VAR)).toBe("88px");
    ui.width = 60;
    view.rerender(controls(true));
    act(() => ui.resize());
    expect(document.documentElement.style.getPropertyValue(LAYOUT_TOGGLE_WIDTH_VAR)).toBe("60px");
    view.unmount();
    expect(document.documentElement.style.getPropertyValue(LAYOUT_TOGGLE_WIDTH_VAR)).toBe("");
  });

  it("offers only the browser toggle for Atlas", () => {
    render(createElement(ToggleButton, { isOpen: false, onClick: onToggle,
      showRightPanelToggle: false, showChatActions: false, onBrowserToggle: onToggle }));
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Open browser" }));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
