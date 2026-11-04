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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Tooltip", () => {
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
