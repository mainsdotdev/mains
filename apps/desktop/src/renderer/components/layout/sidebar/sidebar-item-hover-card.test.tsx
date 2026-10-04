// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarItemHoverCard } from "./sidebar-item-hover-card";

let frames: FrameRequestCallback[];
const anchorRect = {
  left: 100,
  right: 300,
  top: 80,
  bottom: 110,
  width: 200,
  height: 30,
};

beforeEach(() => {
  vi.useFakeTimers();
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({
      ...anchorRect,
      x: anchorRect.left,
      y: anchorRect.top,
      toJSON() {},
    }),
  );
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    () => [anchorRect] as unknown as DOMRectList,
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(112);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function advance(ms: number) {
  act(() => vi.advanceTimersByTime(ms));
}

function flushFrames() {
  act(() => {
    const pending = frames;
    frames = [];
    pending.forEach((callback) => callback(0));
  });
}

function setup(
  disabled = false,
  withControls = false,
  updatedAt?: string | number | Date,
) {
  const onPin = vi.fn();
  const onOpen = vi.fn();
  const onSelectRow = vi.fn();
  const props = {
    title: "A long workspace title",
    description: "feature/sidebar\n/projects/mains",
    disabled,
    updatedAt,
    actions: [
      { label: "Pin workspace", icon: <span>Pin</span>, onSelect: onPin },
      { label: "Open workspace", icon: <span>Open</span>, onSelect: onOpen },
    ],
  };
  const children = (
    <div role="button" tabIndex={0} onClick={onSelectRow}>
      Sidebar row
      {withControls && <button aria-label="Row options">Options</button>}
    </div>
  );
  const result = render(
    <>
      <SidebarItemHoverCard {...props}>{children}</SidebarItemHoverCard>
      <button>Next row</button>
    </>,
  );
  const row = screen.getByRole("button", { name: /^Sidebar row/ });
  const anchor = row.parentElement!;
  return {
    ...result,
    row,
    anchor,
    props,
    children,
    onPin,
    onOpen,
    onSelectRow,
  };
}

function openByHover(anchor: HTMLElement) {
  fireEvent.mouseEnter(anchor);
  advance(450);
  return screen.getByRole("dialog", { name: "A long workspace title" });
}

describe("SidebarItemHoverCard", () => {
  it("refreshes the update age while open, stops its clock when closed, and reopens with the current age", () => {
    vi.setSystemTime(new Date("2026-10-02T09:00:00Z"));
    const { anchor } = setup(false, false, new Date(Date.now() - 7 * 60_000));
    openByHover(anchor);
    expect(screen.getByLabelText("Last updated 7m")).toBeTruthy();
    advance(60_000);
    expect(screen.getByLabelText("Last updated 8m")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.mouseLeave(anchor);
    advance(120_000);
    openByHover(anchor);
    expect(screen.getByLabelText("Last updated 10m")).toBeTruthy();
  });

  it("waits for a deliberate hover and cancels when the pointer passes through", () => {
    const { anchor } = setup();
    fireEvent.mouseEnter(anchor);
    advance(400);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.mouseLeave(anchor);
    advance(600);
    expect(screen.queryByRole("dialog")).toBeNull();
    const card = openByHover(anchor);
    expect(within(card).getByText(/feature\/sidebar/).textContent).toContain(
      "/projects/mains",
    );
  });

  it("bridges the pointer gap in both directions and invokes an action without selecting the row", () => {
    const { anchor, onPin, onSelectRow } = setup();
    const card = openByHover(anchor);
    fireEvent.mouseLeave(anchor);
    advance(70);
    fireEvent.mouseEnter(card);
    advance(300);
    expect(screen.getByRole("dialog")).toBe(card);

    fireEvent.mouseLeave(card);
    advance(70);
    fireEvent.mouseEnter(anchor);
    advance(300);
    expect(screen.getByRole("dialog")).toBe(card);

    fireEvent.click(
      within(card).getByRole("button", { name: "Pin workspace" }),
    );
    flushFrames();
    advance(600);
    expect(onPin).toHaveBeenCalledOnce();
    expect(onSelectRow).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the card open while crossing the row's inline controls to reach it", () => {
    const { anchor, onPin } = setup(false, true);
    const card = openByHover(anchor);
    fireEvent.mouseMove(screen.getByRole("button", { name: "Row options" }));
    expect(screen.getByRole("dialog")).toBe(card);
    fireEvent.mouseLeave(anchor);
    advance(70);
    fireEvent.mouseEnter(card);
    fireEvent.click(
      within(card).getByRole("button", { name: "Pin workspace" }),
    );
    expect(onPin).toHaveBeenCalledOnce();
  });

  it("stays open during a slow crossing of the empty gap in either direction", () => {
    const { anchor } = setup();
    const card = openByHover(anchor);
    // Without a hit area the gap belongs to the page, which used to let the
    // closing timer expire before a slow pointer reached the card.
    const gap = card.querySelector("[data-hover-bridge]") ?? document.body;
    fireEvent.mouseLeave(anchor, { relatedTarget: gap });
    fireEvent.mouseEnter(gap, { relatedTarget: anchor });
    advance(600);
    expect(screen.getByRole("dialog")).toBe(card);
    fireEvent.mouseEnter(card, { relatedTarget: gap });
    fireEvent.mouseLeave(card, { relatedTarget: gap });
    fireEvent.mouseEnter(gap, { relatedTarget: card });
    advance(600);
    expect(screen.getByRole("dialog")).toBe(card);
    fireEvent.mouseLeave(gap, { relatedTarget: anchor });
    fireEvent.mouseEnter(anchor, { relatedTarget: gap });
    advance(600);
    expect(screen.getByRole("dialog")).toBe(card);
    fireEvent.mouseLeave(anchor, { relatedTarget: document.body });
    advance(200);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens with ArrowRight, supports Tab, and returns to the row on Escape", () => {
    const { row } = setup();
    act(() => row.focus());
    fireEvent.keyDown(row, { key: "ArrowRight" });
    flushFrames();
    const card = screen.getByRole("dialog");
    const first = within(card).getByRole("button", { name: "Pin workspace" });
    const last = within(card).getByRole("button", { name: "Open workspace" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab" });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(row);
    advance(1000);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("continues sidebar tab order when leaving the last card action", () => {
    const { row } = setup();
    act(() => row.focus());
    fireEvent.keyDown(row, { key: "ArrowRight" });
    flushFrames();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    flushFrames();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Next row" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not reopen after a menu/editor disables the card", () => {
    const { anchor, props, children, rerender } = setup();
    openByHover(anchor);
    rerender(
      <SidebarItemHoverCard {...props} disabled>
        {children}
      </SidebarItemHoverCard>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(
      <SidebarItemHoverCard {...props}>{children}</SidebarItemHoverCard>,
    );
    advance(1000);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cancels pending previews on pointer press so sorting/clicking cannot open one", () => {
    const { anchor, row } = setup();
    fireEvent.mouseEnter(anchor);
    advance(300);
    fireEvent.pointerDown(row);
    advance(1000);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("flips and clamps the card to the viewport and dismisses it when the list scrolls", () => {
    vi.stubGlobal("innerWidth", 420);
    vi.stubGlobal("innerHeight", 160);
    const { anchor } = setup();
    const card = openByHover(anchor);
    expect(card.style.left).toBe("8px");
    expect(card.style.top).toBe("40px");
    fireEvent.scroll(card);
    expect(screen.getByRole("dialog")).toBe(card);
    fireEvent.scroll(anchor);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([true, false])(
    "suppresses the native browser only if the card overlaps it (%s)",
    (overlaps) => {
      const setSuppressed = vi.fn<(lease: string, suppressed: boolean) => void>();
      const setVisible = vi.fn();
      vi.stubGlobal("api", { browser: { setSuppressed, setVisible } });
      const { anchor } = setup();
      const browser = document.createElement("div");
      browser.dataset.browserContent = "";
      document.body.appendChild(browser);
      Object.defineProperty(browser, "getBoundingClientRect", {
        value: () => ({
          left: overlaps ? 400 : 700,
          right: 1000,
          top: 0,
          bottom: 600,
        }),
      });
      try {
        openByHover(anchor);
        if (overlaps) expect(setSuppressed).toHaveBeenCalledExactlyOnceWith(expect.any(String), true);
        else expect(setSuppressed).not.toHaveBeenCalled();
        const lease = setSuppressed.mock.calls[0]?.[0];
        fireEvent.pointerDown(document.body);
        if (overlaps) expect(setSuppressed.mock.calls).toEqual([[lease, true], [lease, false]]);
        else expect(setSuppressed).not.toHaveBeenCalled();
        expect(setVisible).not.toHaveBeenCalled();
      } finally {
        browser.remove();
      }
    },
  );

  it("shows only one card when moving directly between rows", () => {
    const { anchor, props } = setup();
    render(
      <SidebarItemHoverCard {...props} title="Other workspace">
        <div role="button" tabIndex={0}>
          Other row
        </div>
      </SidebarItemHoverCard>,
    );
    openByHover(anchor);
    const other = screen.getByRole("button", { name: "Other row" });
    fireEvent.mouseEnter(other.parentElement!);
    advance(450);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(
      screen.getByRole("dialog", { name: "Other workspace" }),
    ).toBeTruthy();
  });

  it("cleans up pending timers on unmount", () => {
    const { anchor, unmount } = setup();
    fireEvent.mouseEnter(anchor);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
