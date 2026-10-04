// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { createRef } from "react";
import type { useVirtualizer } from "@pierre/diffs/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReviewFileNavigation, type ReviewFileNavigation } from "./use-review-file-navigation";

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("motion/react", () => ({ useReducedMotion: () => motion.reduced }));
afterEach(() => { cleanup(); motion.reduced = false; });

function setup() {
  const getOffsetInScrollContainer = vi.fn(() => 12000);
  const scrollTo = vi.fn();
  const virtualizer = { getOffsetInScrollContainer, scrollTo } as unknown as ReturnType<typeof useVirtualizer>;
  const navigation = createRef<ReviewFileNavigation>();
  const hook = renderHook(() => useReviewFileNavigation(virtualizer, navigation));
  const target = { element: document.createElement("section"), expand: vi.fn(), focus: vi.fn() };
  return { ...hook, navigation, target, getOffsetInScrollContainer, scrollTo };
}

describe("review file navigation", () => {
  it("opens and focuses the selected file, using its logical virtualized scroll offset", () => {
    const { result, navigation, target, getOffsetInScrollContainer, scrollTo } = setup();
    act(() => { result.current("last.ts", target); navigation.current!.jumpToFile("last.ts"); });
    expect(target.expand).toHaveBeenCalledOnce();
    expect(target.focus).toHaveBeenCalledOnce();
    expect(getOffsetInScrollContainer).toHaveBeenCalledWith(target.element);
    expect(scrollTo).toHaveBeenCalledWith({ top: 12000, behavior: "smooth" });
  });

  it("keeps a replacement target when an old registration cleans up, and ignores removed files", () => {
    const { result, navigation, target, scrollTo } = setup();
    const oldCleanup = result.current("a.ts", { ...target, expand: vi.fn() });
    const currentCleanup = result.current("a.ts", target);
    oldCleanup();
    navigation.current!.jumpToFile("a.ts");
    expect(target.expand).toHaveBeenCalledOnce();
    currentCleanup();
    navigation.current!.jumpToFile("a.ts");
    navigation.current!.jumpToFile("missing.ts");
    expect(scrollTo).toHaveBeenCalledOnce();
  });

  it("uses an immediate jump for reduced motion and clamps offsets above the scroll root", () => {
    motion.reduced = true;
    const { result, navigation, target, getOffsetInScrollContainer, scrollTo } = setup();
    getOffsetInScrollContainer.mockReturnValue(-4);
    result.current("a.ts", target);
    navigation.current!.jumpToFile("a.ts");
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
  });
});
