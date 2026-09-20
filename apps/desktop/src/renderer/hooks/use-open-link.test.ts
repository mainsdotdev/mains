// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  isWeb: false,
  openBrowserUrl: vi.fn(),
  openExternal: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/use-browser-panel", () => ({
  useBrowserPanel: () => ({ openUrl: harness.openBrowserUrl }),
}));

vi.mock("@/lib/platform", () => ({
  get isWeb() {
    return harness.isWeb;
  },
}));

vi.mock("@/components/ui", () => ({
  toast: { error: harness.toastError },
}));

import { isInAppBrowserUrl, useOpenLink } from "./use-open-link";

describe("isInAppBrowserUrl", () => {
  it.each([
    ["https://example.com/docs", true],
    ["http://localhost:5173", true],
    ["mailto:hello@example.com", false],
    ["file:///tmp/report.html", false],
    ["not a url", false],
  ] as const)("classifies %s", (url, expected) => {
    expect(isInAppBrowserUrl(url)).toBe(expected);
  });
});

describe("useOpenLink", () => {
  beforeEach(() => {
    harness.isWeb = false;
    vi.clearAllMocks();
    harness.openBrowserUrl.mockResolvedValue(undefined);
    harness.openExternal.mockResolvedValue(undefined);
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { shell: { openExternal: harness.openExternal } },
    });
  });

  it("opens HTTP URLs in the desktop browser panel", async () => {
    const { result } = renderHook(() => useOpenLink());
    const url = "https://example.com/docs";

    await act(async () => result.current(url));

    expect(harness.openBrowserUrl).toHaveBeenCalledWith(url);
    expect(harness.openExternal).not.toHaveBeenCalled();
  });

  it("keeps unsupported schemes in the external shell", async () => {
    const { result } = renderHook(() => useOpenLink());
    const url = "mailto:hello@example.com";

    await act(async () => result.current(url));

    expect(harness.openExternal).toHaveBeenCalledWith(url);
    expect(harness.openBrowserUrl).not.toHaveBeenCalled();
  });

  it("uses the external-tab fallback in web mode", async () => {
    harness.isWeb = true;
    const { result } = renderHook(() => useOpenLink());
    const url = "https://example.com/docs";

    await act(async () => result.current(url));

    expect(harness.openExternal).toHaveBeenCalledWith(url);
    expect(harness.openBrowserUrl).not.toHaveBeenCalled();
  });

  it("surfaces browser-panel failures without opening externally", async () => {
    harness.openBrowserUrl.mockRejectedValueOnce(new Error("Browser unavailable"));
    const { result } = renderHook(() => useOpenLink());

    await act(async () => result.current("https://example.com/docs"));

    expect(harness.toastError).toHaveBeenCalledWith("Browser unavailable");
    expect(harness.openExternal).not.toHaveBeenCalled();
  });
});
