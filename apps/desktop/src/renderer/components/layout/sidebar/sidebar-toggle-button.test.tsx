// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarToggleButton } from "./sidebar-toggle-button";
import { MainContent } from "../main/main-content";

const native = vi.hoisted(() => ({
  fullscreen: false,
  listeners: new Set<(fullscreen: boolean) => void>(),
}));
vi.mock("@/lib/platform", () => ({ useCapabilities: () => ({ windowChrome: true }) }));
vi.mock("@/providers/keyboard-shortcuts-provider", () => ({ useKeyboardShortcutBinding: () => null }));
vi.mock("@/components/ui", () => ({ Button: ({ children, onClick, "aria-label": label }: {
  children: ReactNode; onClick: () => void; "aria-label": string;
}) => <button onClick={onClick} aria-label={label}>{children}</button> }));

beforeEach(() => {
  native.listeners.clear();
  native.fullscreen = false;
  // The preload subscription delivers a snapshot followed by native changes.
  vi.stubGlobal("api", { app: { onFullscreenChange: (callback: (fullscreen: boolean) => void) => {
    native.listeners.add(callback);
    void Promise.resolve().then(() => { if (native.listeners.has(callback)) callback(native.fullscreen); });
    return () => native.listeners.delete(callback);
  } } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Shell() {
  return <><SidebarToggleButton isOpen onClick={() => {}} />
    <MainContent sidebarCollapsed marginLeft="4rem" marginRight="0"><div>Content</div></MainContent></>;
}
function expectPosition(fullscreen: boolean) {
  const toggle = screen.getByRole("button", { name: "Close sidebar" }).parentElement!.parentElement!;
  expect(toggle.style.left).toBe(fullscreen ? "0.75rem" : "5.25rem");
  expect(screen.getByRole("main").style.getPropertyValue("--shell-header-inset-left")).toBe(fullscreen ? "3rem" : "4.5rem");
}
function changeFullscreen(value: boolean) {
  native.fullscreen = value;
  for (const listener of native.listeners) listener(value);
}

describe("native fullscreen titlebar placement", () => {
  it("clears the traffic-light gap when mounting inside an already fullscreen window", async () => {
    native.fullscreen = true;
    render(<Shell />);
    await waitFor(() => expectPosition(true));
  });

  it("retains fullscreen placement after the shell remounts without another native event", async () => {
    const view = render(<Shell />);
    act(() => changeFullscreen(true));
    expectPosition(true);
    view.unmount();
    expect(native.listeners.size).toBe(0);
    render(<Shell />);
    await waitFor(() => expectPosition(true));
  });

  it("tracks repeated enter and leave events for the toggle and collapsed header together", async () => {
    render(<Shell />);
    await act(async () => {});
    expectPosition(false);
    for (const fullscreen of [true, false, true, false]) {
      act(() => changeFullscreen(fullscreen));
      expectPosition(fullscreen);
    }
  });

});
