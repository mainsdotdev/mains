// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Tooltip, { type TooltipProps } from "./tooltip";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Tooltip", () => {
  it("cancels a pending hide when it unmounts", () => {
    vi.useFakeTimers();
    const { unmount } = render(
      createElement(Tooltip, { content: "Hint" } as TooltipProps, createElement("button", null, "Trigger")),
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
      createElement(Tooltip, { content: "Hint" } as TooltipProps, createElement("button", null, "Trigger")),
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
    render(createElement(Tooltip, { content: "Hint" } as TooltipProps, createElement("button", null, "Trigger")));
    const trigger = screen.getByRole("presentation");
    fireEvent.mouseEnter(trigger);
    act(() => vi.advanceTimersByTime(50));
    fireEvent.mouseLeave(trigger);
    fireEvent.mouseEnter(trigger);
    act(() => vi.advanceTimersByTime(200));

    expect(screen.queryByText("Hint")).not.toBeNull();
  });
});
