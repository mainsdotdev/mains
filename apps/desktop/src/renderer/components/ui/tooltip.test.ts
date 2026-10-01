// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
});
