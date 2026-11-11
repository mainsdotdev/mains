// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { installOverlayFrameClock } from "@/lib/overlay-test-fixtures";
import { LAYOUT_PANEL_ANIM_MS } from "@/lib/layout";
import { usePanelAnimation } from "./use-panel-animation";
import { StrictMode, type ReactNode } from "react";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("ignores an opening frame already queued before the panel began closing", () => {
  vi.useFakeTimers(); const frames = installOverlayFrameClock();
  const view = renderHook(({ open }) => usePanelAnimation(open), { initialProps: { open: false } });
  view.rerender({ open: true }); const queued = frames.take(); expect(queued.length).toBeGreaterThan(0);
  view.rerender({ open: false });
  act(() => { for (const callback of queued) callback(0); });
  act(() => vi.advanceTimersByTime(LAYOUT_PANEL_ANIM_MS));
  expect(view.result.current).toEqual({ isVisible: false, isAnimatedIn: false });
});

it("keeps the panel mounted for its complete exit and starts an initially open panel settled", () => {
  vi.useFakeTimers(); const frames = installOverlayFrameClock();
  const view = renderHook(({ open }) => usePanelAnimation(open), { initialProps: { open: true } });
  expect(view.result.current).toEqual({ isVisible: true, isAnimatedIn: true }); expect(frames.count()).toBe(0);
  view.rerender({ open: false }); expect(view.result.current).toEqual({ isVisible: true, isAnimatedIn: false });
  act(() => vi.advanceTimersByTime(LAYOUT_PANEL_ANIM_MS - 1)); expect(view.result.current.isVisible).toBe(true);
  act(() => vi.advanceTimersByTime(1)); expect(view.result.current.isVisible).toBe(false); expect(vi.getTimerCount()).toBe(0);
});

it("reverses an exit immediately and ignores its already queued unmount callback", () => {
  vi.useFakeTimers(); installOverlayFrameClock(); const scheduled = vi.spyOn(globalThis, "setTimeout");
  const view = renderHook(({ open }) => usePanelAnimation(open), { initialProps: { open: true } });
  view.rerender({ open: false });
  const queued = [...scheduled.mock.calls].reverse().find((call) => call[1] === LAYOUT_PANEL_ANIM_MS)?.[0];
  expect(typeof queued).toBe("function"); view.rerender({ open: true });
  act(() => { if (typeof queued === "function") queued(); });
  expect(view.result.current).toEqual({ isVisible: true, isAnimatedIn: true }); expect(vi.getTimerCount()).toBe(0);
});

it("retires frames and exit timers on unmount after Strict Mode setup replay", () => {
  vi.useFakeTimers(); const frames = installOverlayFrameClock();
  const view = renderHook(({ open }) => usePanelAnimation(open), { initialProps: { open: false }, wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode> });
  view.rerender({ open: true }); const queued = frames.take();
  view.rerender({ open: false }); expect(vi.getTimerCount()).toBe(1); view.unmount();
  act(() => { for (const callback of queued) callback(0); });
  expect(frames.count()).toBe(0); expect(vi.getTimerCount()).toBe(0);
});
