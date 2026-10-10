// @vitest-environment jsdom

import { createElement, StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/components/ui";
import { LAYOUT_TOGGLE_WIDTH_VAR } from "@/lib/layout";
import { ToggleButton } from "./toggle-button";

const ui = vi.hoisted(() => ({ workspaceId: "workspace-1" as string | null, width: 88, resize: () => {} }));
vi.mock("@/lib/redux/hooks", () => ({
  useAppSelector: (selector: (state: unknown) => unknown) => selector({ workspace: { activeWorkspaceId: ui.workspaceId } }),
}));
vi.mock("@/lib/platform", () => ({ useCapabilities: () => ({ embeddedBrowser: true }) }));
vi.mock("@/hooks/use-mode-config", () => ({ useModeConfig: () => ({ showRightPanel: true }) }));
vi.mock("@/providers/keyboard-shortcuts-provider", () => ({ useKeyboardShortcutBinding: () => undefined }));
vi.mock("@/features/workspace/components/chat-actions-menu", () => ({ ChatActionsMenu: () => null }));

const onToggle = vi.fn();
function controls(browserOpen = false, hideTerminalControls = false, terminalOpen = false) {
  return createElement(StrictMode, null, createElement(ToggleButton, {
    isOpen: false, onClick: onToggle, onTerminalToggle: onToggle, terminalOpen,
    onBrowserToggle: onToggle, browserOpen, showChatActions: false, hideTerminalControls,
  }));
}

beforeEach(() => {
  onToggle.mockClear();
  ui.workspaceId = "workspace-1";
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
  it("keeps terminal, browser and right-panel toggles in order and mounted across browser changes", () => {
    const view = render(controls());
    const terminal = screen.getByRole("button", { name: "Open terminal" });
    const browser = screen.getByRole("button", { name: "Open browser" });
    const panel = screen.getByRole("button", { name: "Open right panel" });
    expect(screen.getAllByRole("button")).toEqual([terminal, browser, panel]);
    view.rerender(controls(true));
    expect(screen.getAllByRole("button")).toEqual([terminal, browser, panel]);
    expect(screen.getByRole("button", { name: "Close browser" })).toBe(browser);
    fireEvent.click(browser);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("retains the fixed controls while an expanded preview hides the terminal", () => {
    const view = render(controls(true));
    const browser = screen.getByRole("button", { name: "Close browser" });
    const panel = screen.getByRole("button", { name: "Open right panel" });
    view.rerender(controls(true, true));
    expect(screen.queryByRole("button", { name: "Open terminal" })).toBeNull();
    expect(screen.getAllByRole("button")).toEqual([browser, panel]);
  });

  it("publishes the measured group width and clears it when the controls leave", () => {
    const view = render(controls());
    expect(document.documentElement.style.getPropertyValue(LAYOUT_TOGGLE_WIDTH_VAR)).toBe("88px");
    ui.width = 60;
    view.rerender(controls(true, true));
    act(() => ui.resize());
    expect(document.documentElement.style.getPropertyValue(LAYOUT_TOGGLE_WIDTH_VAR)).toBe("60px");
    view.unmount();
    expect(document.documentElement.style.getPropertyValue(LAYOUT_TOGGLE_WIDTH_VAR)).toBe("");
  });

  it("requires a workspace to open a terminal but lets an existing terminal close", () => {
    ui.workspaceId = null;
    const error = vi.spyOn(toast, "error").mockImplementation(() => "toast");
    const view = render(controls());
    fireEvent.click(screen.getByRole("button", { name: "Open terminal" }));
    expect(onToggle).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("Select a workspace first to use the terminal");
    view.rerender(controls(false, false, true));
    fireEvent.click(screen.getByRole("button", { name: "Close terminal" }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("offers only the browser toggle for Atlas", () => {
    render(createElement(ToggleButton, { isOpen: false, onClick: onToggle,
      showRightPanelToggle: false, showChatActions: false, onBrowserToggle: onToggle }));
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Open browser" }));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
