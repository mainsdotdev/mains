// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSmoothText } from "./use-smooth-text";

const preference = vi.hoisted(() => ({ reduced: false }));
vi.mock("@/hooks/use-prefers-reduced-motion", () => ({
  usePrefersReducedMotion: () => preference.reduced,
}));

let now = 0;
let nextId = 0;
const frames = new Map<number, FrameRequestCallback>();
const requestFrame = vi.fn((callback: FrameRequestCallback) => {
  frames.set(++nextId, callback);
  return nextId;
});
const cancelFrame = vi.fn((id: number) => frames.delete(id));

beforeEach(() => {
  now = 0;
  nextId = 0;
  preference.reduced = false;
  frames.clear();
  vi.clearAllMocks();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", requestFrame);
  vi.stubGlobal("cancelAnimationFrame", cancelFrame);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function frame(elapsed: number) {
  now += elapsed;
  const callbacks = [...frames.values()];
  frames.clear();
  act(() => callbacks.forEach((callback) => callback(now)));
}

function stream() {
  return renderHook(({ text, enabled }) => useSmoothText(text, enabled), {
    initialProps: { text: "", enabled: true },
  });
}

describe("stream text pacing", () => {
  it("has the same reveal speed at 60 Hz and 120 Hz", () => {
    const revealed: string[] = [];
    for (const hz of [60, 120]) {
      const view = stream();
      view.rerender({ text: "a".repeat(200), enabled: true });
      for (let index = 0; index < hz / 2; index++) frame(1000 / hz);
      revealed.push(view.result.current);
      view.unmount();
    }
    expect(Math.abs(revealed[0].length - revealed[1].length)).toBeLessThanOrEqual(2);
    expect(revealed[0].length).toBeGreaterThan(15);
    expect(revealed[0].length).toBeLessThan(80);
  });

  it("keeps the animation running when several chunks arrive before a frame", () => {
    const view = stream();
    for (let length = 20; length <= 100; length += 20) {
      now += 2;
      view.rerender({ text: "a".repeat(length), enabled: true });
    }
    expect(requestFrame).toHaveBeenCalledOnce();
    expect(cancelFrame).not.toHaveBeenCalled();
    frame(1000 / 60);
    frame(160);
    expect(view.result.current.length).toBeGreaterThan(0);
    expect(view.result.current.length).toBeLessThan(100);
  });

  it("drains the final buffer at the current pace instead of snapping to the full answer", () => {
    const view = stream();
    const text = "a".repeat(200);
    view.rerender({ text, enabled: true });
    for (let index = 0; index < 20; index++) frame(1000 / 60);
    expect(view.result.current.length).toBeLessThan(text.length);
    const beforeCompletion = view.result.current;
    view.rerender({ text, enabled: false });
    expect(view.result.current).toBe(beforeCompletion);
    frame(1000 / 60);
    expect(view.result.current.length - beforeCompletion.length).toBeLessThan(5);
    for (let index = 0; index < 240 && frames.size; index++) frame(1000 / 60);
    expect(view.result.current).toBe(text);
    expect(frames.size).toBe(0);

    view.rerender({ text: text + " next", enabled: true });
    expect(view.result.current).toBe(text);
    frame(1000 / 60);
    expect(view.result.current.startsWith(text)).toBe(true);
  });

  it("buffers the first live chunk but shows settled history immediately", () => {
    const view = renderHook(({ enabled }) => useSmoothText("New answer", enabled), {
      initialProps: { enabled: true },
    });
    expect(view.result.current).toBe("");
    for (let index = 0; index < 30; index++) frame(1000 / 60);
    expect(view.result.current).toBe("New answer");
    view.unmount();

    const history = renderHook(() => useSmoothText("Historical answer", false));
    expect(history.result.current).toBe("Historical answer");
  });

  it("settles immediately when reduced motion is enabled and cancels work on unmount", () => {
    const view = stream();
    view.rerender({ text: "a".repeat(200), enabled: true });
    preference.reduced = true;
    view.rerender({ text: "a".repeat(200), enabled: true });
    expect(view.result.current).toHaveLength(200);
    expect(frames.size).toBe(0);

    preference.reduced = false;
    view.rerender({ text: "a".repeat(300), enabled: true });
    expect(frames.size).toBe(1);
    view.unmount();
    expect(frames.size).toBe(0);
  });
});
