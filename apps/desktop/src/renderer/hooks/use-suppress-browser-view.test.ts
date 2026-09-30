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
    const setVisible = vi.fn();
    vi.stubGlobal("api", {
      browserChat: { setOverlayInteractive },
      browser: { setVisible },
    });

    const first = render(createElement(Preview));
    const second = render(createElement(Preview));
    expect(setOverlayInteractive).toHaveBeenCalledOnce();
    expect(setOverlayInteractive).toHaveBeenCalledWith(true);
    expect(setVisible).toHaveBeenCalledOnce();
    expect(setVisible).toHaveBeenCalledWith(false);

    first.unmount();
    expect(setOverlayInteractive).toHaveBeenCalledOnce();
    second.unmount();
    expect(setOverlayInteractive).toHaveBeenLastCalledWith(false);
    expect(setVisible).toHaveBeenLastCalledWith(true);
  });
});
