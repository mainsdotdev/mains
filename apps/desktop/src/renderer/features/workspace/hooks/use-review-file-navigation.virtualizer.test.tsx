// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { createRef, useState } from "react";
import { clearRenderQueue, Virtualizer } from "@pierre/diffs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReviewFileNavigation, type ReviewFileNavigation } from "./use-review-file-navigation";

const frames = new Map<number, FrameRequestCallback>();
const virtualizers: Virtualizer[] = [];
let frameId = 0;
let intersect: IntersectionObserverCallback;

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback; }
    observe() {} unobserve() {} disconnect() {}
  });
});
afterEach(() => {
  cleanup();
  for (const virtualizer of virtualizers) virtualizer.cleanUp();
  virtualizers.length = 0;
  clearRenderQueue();
  frames.clear();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function flushFrames() {
  for (let pass = 0; frames.size && pass < 20; pass++) {
    const current = [...frames.values()];
    frames.clear();
    for (const frame of current) frame(pass * 16);
  }
  expect(frames.size).toBe(0);
}

/** Real Pierre anchoring, with browser layout/animation modeled at the DOM seam. */
function setup({ collapsed = false, measureWrappedRows = false } = {}) {
  const root = document.createElement("div");
  const content = root.appendChild(document.createElement("div"));
  const precedingFile = content.appendChild(document.createElement("div"));
  const target = content.appendChild(document.createElement("section"));
  document.body.append(root);
  const line = precedingFile.attachShadow({ mode: "open" }).appendChild(document.createElement("div"));
  line.dataset.line = "";
  line.dataset.lineIndex = "50";
  let growth = 0;
  let isCollapsed = collapsed;
  let pendingSmooth: number | undefined;
  let shouldMeasure = false;
  const targetTop = () => 12000 + growth;
  const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 400, width: 400, x: 0, y: top, toJSON() {} });
  root.getBoundingClientRect = () => rect(0, 500);
  precedingFile.getBoundingClientRect = () => rect(-root.scrollTop, targetTop());
  target.getBoundingClientRect = () => rect(targetTop() - root.scrollTop, isCollapsed ? 40 : 5000);
  line.getBoundingClientRect = () => rect(1000 + growth - root.scrollTop, 20);
  Object.defineProperty(precedingFile, "offsetHeight", { get: targetTop });
  Object.defineProperty(target, "offsetHeight", { get: () => isCollapsed ? 40 : 5000 });
  Object.defineProperty(root, "scrollHeight", { get: () => targetTop() + target.offsetHeight + 224 });

  const notify = () => {
    root.dispatchEvent(new Event("scroll"));
    intersect([precedingFile, target].map((element) => {
      const boundingClientRect = element.getBoundingClientRect();
      const isIntersecting = boundingClientRect.bottom > 0 && boundingClientRect.top < 500;
      return {
        target: element, boundingClientRect, isIntersecting, time: 0,
        intersectionRect: boundingClientRect, intersectionRatio: isIntersecting ? 1 : 0,
        rootBounds: root.getBoundingClientRect(),
      };
    }), {} as IntersectionObserver);
  };
  root.scrollTo = vi.fn((position?: ScrollToOptions | number, y?: number) => {
    const options = typeof position === "number" ? { top: y } : position ?? {};
    const top = Math.max(0, Math.min(options.top ?? 0, root.scrollHeight - 500));
    if (options.behavior === "smooth") {
      pendingSmooth = top;
      root.scrollTop = Math.min(top, 1000); // First browser animation frame.
    } else {
      pendingSmooth = undefined; // Native instant corrections cancel smooth scroll.
      root.scrollTop = top;
    }
    notify();
  });
  const virtualizer = new Virtualizer();
  virtualizers.push(virtualizer);
  virtualizer.setup(root, content);
  virtualizer.connect(precedingFile, {
    setVisibility() {}, reconcileHeights: () => false,
    onRender() {
      if (!shouldMeasure) return false;
      shouldMeasure = false;
      growth = 240; // Newly rendered wrapped rows are taller than their estimates.
      return true;
    },
  });
  virtualizer.connect(target, { setVisibility() {}, onRender: () => false, reconcileHeights: () => false });
  notify();
  flushFrames();

  const navigation = createRef<ReviewFileNavigation>();
  const focus = vi.fn();
  const hook = renderHook(() => {
    const [closed, setClosed] = useState(collapsed);
    isCollapsed = closed;
    const register = useReviewFileNavigation(virtualizer, navigation);
    return { register, expand: () => setClosed(false) };
  });
  hook.result.current.register("last.ts", { element: target, expand: hook.result.current.expand, focus });
  shouldMeasure = measureWrappedRows;
  return {
    root, target, focus,
    jump() {
      act(() => { navigation.current!.jumpToFile("last.ts"); });
      flushFrames();
      if (pendingSmooth !== undefined) {
        root.scrollTop = pendingSmooth;
        pendingSmooth = undefined;
        notify();
        flushFrames();
      }
    },
  };
}

describe("review navigation with Pierre's virtualizer", () => {
  it("reaches the last file despite wrapped-row measurements interrupting native smooth scroll", () => {
    const { jump, target, focus } = setup({ measureWrappedRows: true });
    jump();
    expect(target.getBoundingClientRect().top).toBe(0);
    expect(focus).toHaveBeenCalledOnce();
  });

  it("expands the last file before scrolling so its old collapsed height does not clamp the jump", () => {
    const { jump, target } = setup({ collapsed: true });
    jump();
    expect(target.offsetHeight).toBe(5000);
    expect(target.getBoundingClientRect().top).toBe(0);
  });
});
