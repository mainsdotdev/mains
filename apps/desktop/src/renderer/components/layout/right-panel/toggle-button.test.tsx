// @vitest-environment jsdom

import { createElement, StrictMode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToggleButton } from "./toggle-button";

vi.mock("@/lib/redux/hooks", () => ({
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({ workspace: { activeWorkspaceId: "workspace-1" } }),
}));
vi.mock("@/lib/platform", () => ({
  useCapabilities: () => ({ embeddedBrowser: true }),
}));
vi.mock("@/hooks/use-mode-config", () => ({
  useModeConfig: () => ({ showSources: true, showGitActions: false, showRightPanel: true }),
}));
vi.mock("@/providers/keyboard-shortcuts-provider", () => ({
  useKeyboardShortcutBinding: () => undefined,
}));
vi.mock("@/features/workspace/components/session-panel", () => ({
  SessionPanelTrigger: () => createElement("button", null, "Session details"),
}));
vi.mock("@/features/workspace/components/chat-actions-menu", () => ({
  ChatActionsMenu: () => null,
}));

const onToggle = vi.fn();
function controls(browserOpen: boolean, terminalOpen = false, browserExpanded = false) {
  return createElement(StrictMode, null, createElement(ToggleButton, {
    isOpen: false,
    onClick: onToggle,
    onTerminalToggle: onToggle,
    terminalOpen,
    browserOpen,
    browserExpanded,
    onBrowserToggle: onToggle,
    onBrowserExpandToggle: onToggle,
    showChatActions: false,
    sessionPanelRight: browserOpen && !browserExpanded ? "calc(38rem + 0.75rem)" : undefined,
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("session trigger during browser entry", () => {
  it("stays hidden throughout entry, then appears without remounting the controls", () => {
    const view = render(controls(false));
    const session = screen.getByRole("button", { name: "Session details" });
    const terminal = screen.getByRole("button", { name: "Open terminal" });
    const browser = screen.getByRole("button", { name: "Open browser" });
    const sidebar = screen.getByRole("button", { name: "Open right panel" });

    view.rerender(controls(true));
    expect(screen.queryByRole("button", { name: "Session details" })).toBeNull();
    expect(screen.getByText("Session details")).toBe(session);
    expect(getComputedStyle(session.parentElement!).opacity).toBe("0");
    expect(screen.getByRole("button", { name: "Open terminal" })).toBe(terminal);
    expect(screen.getByRole("button", { name: "Close browser" })).toBe(browser);
    expect(screen.getByRole("button", { name: "Open right panel" })).toBe(sidebar);

    act(() => vi.advanceTimersByTime(350));
    expect(screen.queryByRole("button", { name: "Session details" })).toBeNull();
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByRole("button", { name: "Session details" })).toBe(session);
    expect(getComputedStyle(session.parentElement!).opacity).toBe("1");
  });

  it("cancels the previous reveal when the browser closes and quickly reopens", () => {
    const view = render(controls(true));
    act(() => vi.advanceTimersByTime(200));
    view.rerender(controls(false));
    expect(screen.getByRole("button", { name: "Session details" })).toBeTruthy();

    view.rerender(controls(true));
    act(() => vi.advanceTimersByTime(250));
    expect(screen.queryByRole("button", { name: "Session details" })).toBeNull();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole("button", { name: "Session details" })).toBeTruthy();
  });

  it("hides immediately on a fresh open after an earlier reveal", () => {
    const view = render(controls(true));
    act(() => vi.advanceTimersByTime(450));
    view.rerender(controls(false));
    view.rerender(controls(true));
    expect(screen.queryByRole("button", { name: "Session details" })).toBeNull();

    act(() => vi.advanceTimersByTime(450));
    expect(screen.getByRole("button", { name: "Session details" })).toBeTruthy();
    view.rerender(controls(true, true));
    expect(screen.getByRole("button", { name: "Session details" })).toBeTruthy();
  });

  it("hides session and terminal controls in the expanded browser and restores them when docked", () => {
    const view = render(controls(true));
    act(() => vi.advanceTimersByTime(450));
    const browser = screen.getByRole("button", { name: "Close browser" });
    const sidebar = screen.getByRole("button", { name: "Open right panel" });

    view.rerender(controls(true, false, true));
    expect(screen.queryByText("Session details")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open terminal" })).toBeNull();
    expect(screen.getByRole("button", { name: "Restore browser panel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close browser" })).toBe(browser);
    expect(screen.getByRole("button", { name: "Open right panel" })).toBe(sidebar);

    view.rerender(controls(true));
    expect(screen.getByRole("button", { name: "Open terminal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Expand browser" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Session details" })).toBeNull();
    act(() => vi.advanceTimersByTime(450));
    expect(screen.getByRole("button", { name: "Session details" })).toBeTruthy();
  });
});
