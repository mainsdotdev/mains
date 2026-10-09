// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  isWeb: false,
  openBrowserUrl: vi.fn(),
  openExternal: vi.fn(),
  toastError: vi.fn(),
  navigate: vi.fn(),
  pathname: "/code",
  account: { id: "account" } as { id: string } | undefined,
  backendId: "remote" as string | null,
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => harness.navigate,
  useLocation: () => ({ pathname: harness.pathname }),
}));

vi.mock("@/lib/redux/api/accountApi", () => ({
  useGetAccountQuery: () => ({ currentData: harness.account }),
}));

vi.mock("@/lib/redux/hooks", () => ({
  useAppSelector: (select: (state: unknown) => unknown) => select({
    backends: { activeBackendId: harness.backendId },
  }),
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
import { subscribeAtlasPageRequests } from "@/features/atlas/lib/page-actions";

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
    harness.pathname = "/code";
    harness.account = { id: "account" };
    harness.backendId = "remote";
    vi.clearAllMocks();
    harness.openBrowserUrl.mockResolvedValue(undefined);
    harness.openExternal.mockResolvedValue(undefined);
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { shell: { openExternal: harness.openExternal } },
    });
  });

  it.each([
    "/atlas/5397da91-5c14-4c15-b17a-2107448c3372",
    "#/atlas/5397da91-5c14-4c15-b17a-2107448c3372",
    "http://localhost:5173/#/atlas/5397da91-5c14-4c15-b17a-2107448c3372",
  ])("opens Page reference %s in the app editor", async (url) => {
    const { result } = renderHook(() => useOpenLink());

    await act(async () => result.current(url));

    expect(harness.navigate).toHaveBeenCalledWith("/atlas/5397da91-5c14-4c15-b17a-2107448c3372");
    expect(harness.openBrowserUrl).not.toHaveBeenCalled();
    expect(harness.openExternal).not.toHaveBeenCalled();
  });

  it("asks the Atlas route to save before switching Pages", async () => {
    harness.pathname = "/atlas/current-page";
    const request = vi.fn();
    const unsubscribe = subscribeAtlasPageRequests(request);
    const { result } = renderHook(() => useOpenLink());
    try {
      await act(async () => result.current("/atlas/another-page"));

      expect(request).toHaveBeenCalledWith({
        ownerKey: JSON.stringify(["remote", "account"]), id: "another-page",
      });
      expect(harness.navigate).not.toHaveBeenCalled();
      expect(harness.openBrowserUrl).not.toHaveBeenCalled();
      expect(harness.openExternal).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
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
