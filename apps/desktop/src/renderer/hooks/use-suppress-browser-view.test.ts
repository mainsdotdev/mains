// @vitest-environment jsdom

import { createElement } from "react";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSuppressBrowserView } from "./use-suppress-browser-view";

function Preview() {
  useSuppressBrowserView(true);
  return null;
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
});

describe("browser view suppression", () => {
  it("captures the full floating-chat window for a preview and releases it on close", () => {
    window.history.replaceState({}, "", "/?browserChatOverlay=1");
    const setOverlayInteractive = vi.fn();
    const setSuppressed = vi.fn();
    vi.stubGlobal("api", {
      browserChat: { setOverlayInteractive },
      browser: { setSuppressed },
    });

    const first = render(createElement(Preview));
    const second = render(createElement(Preview));
    expect(setOverlayInteractive).toHaveBeenCalledOnce();
    expect(setOverlayInteractive).toHaveBeenCalledWith(true);
    expect(setSuppressed).toHaveBeenCalledTimes(2);
    const firstLease = setSuppressed.mock.calls[0][0];
    const secondLease = setSuppressed.mock.calls[1][0];
    expect(firstLease).not.toBe(secondLease);
    expect(setSuppressed).toHaveBeenCalledWith(firstLease, true);
    expect(setSuppressed).toHaveBeenCalledWith(secondLease, true);

    first.unmount();
    expect(setSuppressed).toHaveBeenLastCalledWith(firstLease, false);
    expect(setOverlayInteractive).toHaveBeenCalledOnce();
    second.unmount();
    expect(setOverlayInteractive).toHaveBeenLastCalledWith(false);
    expect(setSuppressed).toHaveBeenLastCalledWith(secondLease, false);
  });
});
