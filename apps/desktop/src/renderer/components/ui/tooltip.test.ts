// @vitest-environment jsdom

import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Tooltip, { type TooltipProps } from "./tooltip";
import { installOverlayFrameClock } from "@/lib/overlay-test-fixtures";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Tooltip", () => {
  it("keeps a focused hint open after the pointer leaves, then closes on blur", () => {
    vi.useFakeTimers();
    render(createElement(Tooltip, { content: "Focused hint", delay: 0 }, createElement("button", null, "Trigger")));
    const trigger = screen.getByRole("presentation");
    fireEvent.mouseEnter(trigger); fireEvent.focus(trigger); act(() => vi.advanceTimersByTime(50));
    fireEvent.mouseLeave(trigger); act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole("tooltip")).not.toBeNull();
    fireEvent.blur(trigger); act(() => vi.advanceTimersByTime(100)); expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it.each(["waiting", "open"])("retires a %s hint when disabled and does not resurrect it on re-enable", (phase) => {
    vi.useFakeTimers();
    const props = { content: "Retired hint", delay: 50 };
    const view = render(createElement(Tooltip, props, createElement("button", null, "Trigger")));
    fireEvent.mouseEnter(screen.getByRole("presentation"));
    if (phase === "open") act(() => vi.advanceTimersByTime(100));
    view.rerender(createElement(Tooltip, { ...props, disabled: true }, createElement("button", null, "Trigger")));
    act(() => vi.advanceTimersByTime(200));
    view.rerender(createElement(Tooltip, props, createElement("button", null, "Trigger")));
    expect(screen.queryByRole("tooltip")).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });

  it("retires the old external trigger and its captured native listener on replacement", () => {
    vi.useFakeTimers();
    const first = document.createElement("button"), next = document.createElement("button"); document.body.append(first, next);
    const subscriptions = vi.spyOn(first, "addEventListener");
    const view = render(createElement(Tooltip, { content: "External hint", target: first, delay: 0 }));
    const listener = subscriptions.mock.calls.find((call) => call[0] === "mouseenter")?.[1]; expect(typeof listener).toBe("function");
    fireEvent.mouseEnter(first); act(() => vi.advanceTimersByTime(50)); expect(screen.queryByRole("tooltip")).not.toBeNull();
    view.rerender(createElement(Tooltip, { content: "External hint", target: next, delay: 0 })); expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => { if (typeof listener === "function") listener(new MouseEvent("mouseenter")); vi.advanceTimersByTime(200); });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseEnter(next); act(() => vi.advanceTimersByTime(50)); expect(screen.queryByRole("tooltip")).not.toBeNull();
    view.unmount(); first.remove(); next.remove(); expect(vi.getTimerCount()).toBe(0);
  });

  it("retires a show frame already queued when the tooltip unmounts", () => {
    vi.useFakeTimers(); const frames = installOverlayFrameClock();
    const view = render(createElement(Tooltip, { content: "Hint", delay: 0 }, createElement("button", null, "Trigger")));
    fireEvent.mouseEnter(screen.getByRole("presentation")); act(() => vi.advanceTimersByTime(0));
    const queued = frames.take(); expect(queued.length).toBe(1); view.unmount();
    act(() => { for (const callback of queued) callback(0); });
    expect(frames.count()).toBe(0); expect(vi.getTimerCount()).toBe(0); expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("fits a usage card inside the viewport and repositions after async content grows", () => {
    vi.useFakeTimers();
    let resize!: () => void;
    let height = 100;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(280);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      () => height,
    );
    render(
      createElement(
        Tooltip,
        {
          content: "Usage",
          position: "right",
          delay: 0,
          constrainToViewport: true,
        } as TooltipProps,
        createElement("button", null, "Trigger"),
      ),
    );
    vi.spyOn(
      screen.getByRole("button"),
      "getBoundingClientRect",
    ).mockReturnValue({
      top: window.innerHeight - 100,
      right: 40,
      height: 32,
    } as DOMRect);
    fireEvent.mouseEnter(screen.getByRole("presentation"));
    act(() => vi.advanceTimersByTime(50));
    const tooltip = screen.getByRole("tooltip");
    height = 400;
    act(() => resize());
    expect(tooltip.style.top).toBe(`${window.innerHeight - 208}px`);
    expect(tooltip.style.left).toBe("48px");
  });

  it("keeps an interactive card open while reading or scrolling it", () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    render(
      createElement(
        Tooltip,
        {
          content: "Usage",
          delay: 0,
          interactive: true,
          constrainToViewport: true,
        } as TooltipProps,
        createElement("button", null, "Trigger"),
      ),
    );
    const trigger = screen.getByRole("presentation");
    fireEvent.mouseEnter(trigger);
    act(() => vi.advanceTimersByTime(50));
    const card = screen.getByRole("tooltip");
    fireEvent.mouseLeave(trigger);
    fireEvent.mouseEnter(card);
    fireEvent.scroll(card);
    act(() => vi.advanceTimersByTime(150));
    expect(screen.getByRole("tooltip")).toBe(card);
    fireEvent.mouseLeave(card);
    act(() => vi.advanceTimersByTime(150));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("cancels a pending hide when it unmounts", () => {
    vi.useFakeTimers();
    const { unmount } = render(
      createElement(
        Tooltip,
        { content: "Hint" } as TooltipProps,
        createElement("button", null, "Trigger"),
      ),
    );
    fireEvent.mouseEnter(screen.getByRole("presentation"));
    act(() => vi.advanceTimersByTime(50));
    fireEvent.mouseLeave(screen.getByRole("presentation"));
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    // A hide timer left running would set state after the test environment
    // is gone — the "window is not defined" CI failure.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a single show timer when hover and focus both open it", () => {
    vi.useFakeTimers();
    const { unmount } = render(
      createElement(
        Tooltip,
        { content: "Hint" } as TooltipProps,
        createElement("button", null, "Trigger"),
      ),
    );
    const trigger = screen.getByRole("presentation");
    fireEvent.mouseEnter(trigger);
    fireEvent.focus(trigger);
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("stays open when the pointer comes back while it is fading out", () => {
    vi.useFakeTimers();
    render(
      createElement(
        Tooltip,
        { content: "Hint" } as TooltipProps,
        createElement("button", null, "Trigger"),
      ),
    );
    const trigger = screen.getByRole("presentation");
    fireEvent.mouseEnter(trigger);
    act(() => vi.advanceTimersByTime(50));
    fireEvent.mouseLeave(trigger);
    fireEvent.mouseEnter(trigger);
    act(() => vi.advanceTimersByTime(200));

    expect(screen.queryByText("Hint")).not.toBeNull();
  });

  it("hides after the configured time and opens again on the next hover", () => {
    vi.useFakeTimers();
    render(
      createElement(
        Tooltip,
        { content: "Hint", delay: 0, autoHideAfter: 3000 } as TooltipProps,
        createElement("button", null, "Trigger"),
      ),
    );
    const trigger = screen.getByRole("presentation");
    fireEvent.mouseEnter(trigger);
    act(() => vi.advanceTimersByTime(0));
    expect(screen.queryByRole("tooltip")).not.toBeNull();

    act(() => vi.advanceTimersByTime(3000));
    act(() => vi.advanceTimersByTime(100));
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.mouseLeave(trigger);
    fireEvent.mouseEnter(trigger);
    act(() => vi.advanceTimersByTime(0));
    expect(screen.queryByRole("tooltip")).not.toBeNull();
  });

  it("can attach to an existing DOM button", () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    const button = document.createElement("button");
    host.attachShadow({ mode: "open" }).appendChild(button);
    document.body.appendChild(host);
    const { unmount } = render(
      createElement(Tooltip, {
        content: "External hint",
        target: button,
        delay: 0,
        autoHideAfter: 3000,
        hideOnClick: true,
      } as TooltipProps),
    );

    fireEvent.mouseEnter(button);
    act(() => vi.advanceTimersByTime(0));
    expect(screen.queryByText("External hint")).not.toBeNull();
    fireEvent.click(button);
    act(() => vi.advanceTimersByTime(100));
    expect(screen.queryByText("External hint")).toBeNull();

    unmount();
    host.remove();
    expect(vi.getTimerCount()).toBe(0);
  });
});
