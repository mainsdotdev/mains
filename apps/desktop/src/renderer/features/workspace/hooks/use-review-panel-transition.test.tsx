// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Input } from "@/components/ui";
import { useReviewPanelTransition } from "./use-review-panel-transition";

const motion = vi.hoisted(() => ({
  reduced: false,
  frames: [] as Array<{ onUpdate: (progress: number) => void; onComplete: () => void; stop: ReturnType<typeof vi.fn> }>,
}));
vi.mock("motion/react", async (importOriginal) => ({
  ...await importOriginal<typeof import("motion/react")>(),
  useReducedMotion: () => motion.reduced,
  animate: (_from: number, _to: number, options: { onUpdate: (progress: number) => void; onComplete: () => void }) => {
    const frame = { ...options, stop: vi.fn() };
    motion.frames.push(frame);
    return frame;
  },
}));

let presentation: ReturnType<typeof useReviewPanelTransition>;
let anchorWidth = 500;
function Harness({ expanded }: { expanded: boolean }) {
  const transition = useReviewPanelTransition(expanded);
  const { anchorRef, expandedBoundsRef } = transition;
  useLayoutEffect(() => { presentation = transition; });
  return <div ref={anchorRef} data-anchor="">
    <div ref={expandedBoundsRef} data-bounds="" style={{ paddingTop: 5, minHeight: 40, scrollMarginLeft: 72 }} />
    <Input aria-label="Draft comment" defaultValue="Keep this draft" />
  </div>;
}
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  motion.reduced = false;
  motion.frames.length = 0;
  anchorWidth = 500;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return (this.hasAttribute("data-bounds")
      ? { left: 100, top: 0, width: 1000, height: 900 }
      : { left: 200, top: 50, width: anchorWidth, height: 600 }) as DOMRect;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("review panel transition", () => {
  it("initializes without an entrance animation and preserves the editor while expanding and collapsing", () => {
    const { rerender } = render(<Harness expanded={false} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Unsaved feedback" } });
    expect(presentation.panelStyle.width.get()).toBe(500);
    expect(motion.frames).toHaveLength(0);
    rerender(<Harness expanded />);
    expect(presentation.panelStyle.width.get()).toBe(500);
    act(() => motion.frames[0].onUpdate(0.5));
    expect(presentation.panelStyle.width.get()).toBe(750);
    expect(presentation.headerStyle.marginLeft.get()).toBe(36);
    act(() => { motion.frames[0].onUpdate(1); motion.frames[0].onComplete(); });
    rerender(<Harness expanded={false} />);
    expect(presentation.panelStyle.zIndex.get()).toBe(9999);
    act(() => { motion.frames[1].onUpdate(1); motion.frames[1].onComplete(); });
    expect(presentation.panelStyle.width.get()).toBe(500);
    expect(presentation.panelStyle.zIndex.get()).toBe(0);
    expect(screen.getByRole("textbox")).toBe(input);
    expect((input as HTMLInputElement).value).toBe("Unsaved feedback");
  });

  it("reverses from the currently displayed size when clicked before the animation finishes", () => {
    const { rerender } = render(<Harness expanded={false} />);
    rerender(<Harness expanded />);
    act(() => motion.frames[0].onUpdate(0.4));
    expect(presentation.panelStyle.width.get()).toBe(700);
    rerender(<Harness expanded={false} />);
    expect(motion.frames[0].stop).toHaveBeenCalledOnce();
    expect(presentation.panelStyle.width.get()).toBe(700);
    act(() => motion.frames[1].onUpdate(0.5));
    expect(presentation.panelStyle.width.get()).toBe(600);
    rerender(<Harness expanded />);
    expect(presentation.panelStyle.width.get()).toBe(600);
    act(() => motion.frames[2].onUpdate(0.5));
    expect(presentation.panelStyle.width.get()).toBe(800);
  });

  it("settles immediately when reduced motion is enabled during a transition", () => {
    const { rerender } = render(<Harness expanded={false} />);
    rerender(<Harness expanded />);
    act(() => motion.frames[0].onUpdate(0.4));
    motion.reduced = true;
    rerender(<Harness expanded />);
    expect(motion.frames[0].stop).toHaveBeenCalledOnce();
    expect(presentation.panelStyle.width.get()).toBe(1000);
    rerender(<Harness expanded={false} />);
    expect(presentation.panelStyle.width.get()).toBe(500);
    expect(motion.frames).toHaveLength(1);
  });

  it("follows docked layout changes without starting another mode transition", () => {
    render(<Harness expanded={false} />);
    anchorWidth = 450;
    fireEvent(window, new Event("resize"));
    expect(presentation.panelStyle.width.get()).toBe(450);
    expect(motion.frames).toHaveLength(0);
  });
});
