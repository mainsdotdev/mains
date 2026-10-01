// @vitest-environment jsdom
import { createElement, StrictMode, type ReactNode } from "react";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ windowChrome: true, setOnboardingWindow: vi.fn() }));
vi.mock("@/lib/platform", () => ({ useCapabilities: () => ({ windowChrome: mocks.windowChrome }) }));
import { useOnboardingWindow } from "./use-onboarding-window";

beforeEach(() => {
  mocks.windowChrome = true;
  mocks.setOnboardingWindow.mockReset().mockResolvedValue({ success: true, data: null });
  vi.stubGlobal("api", { app: { setOnboardingWindow: mocks.setOnboardingWindow } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("onboarding window synchronization", () => {
  it("restores workspace mode only when the onboarding flag changes", () => {
    const { rerender } = renderHook(({ onboarding }) => useOnboardingWindow(onboarding), {
      initialProps: { onboarding: true },
    });
    expect(mocks.setOnboardingWindow).toHaveBeenLastCalledWith(true);
    rerender({ onboarding: true });
    expect(mocks.setOnboardingWindow).toHaveBeenCalledTimes(1);
    rerender({ onboarding: false });
    expect(mocks.setOnboardingWindow).toHaveBeenLastCalledWith(false);
  });

  it("keeps onboarding compact through StrictMode cleanup and unmount", () => {
    const { unmount } = renderHook(() => useOnboardingWindow(true), {
      wrapper: ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children),
    });
    unmount();
    expect(mocks.setOnboardingWindow).toHaveBeenCalled();
    expect(mocks.setOnboardingWindow.mock.calls.every(([value]) => value === true)).toBe(true);
  });

  it("never sends native window requests from a web client", () => {
    mocks.windowChrome = false;
    renderHook(() => useOnboardingWindow(true));
    expect(mocks.setOnboardingWindow).not.toHaveBeenCalled();
  });

  it("waits for the rendered screen before announcing its native presentation", () => {
    const { rerender } = renderHook(({ enabled }) => useOnboardingWindow(true, enabled), {
      initialProps: { enabled: false },
    });
    expect(mocks.setOnboardingWindow).not.toHaveBeenCalled();
    rerender({ enabled: true });
    expect(mocks.setOnboardingWindow).toHaveBeenCalledWith(true);
  });
});
