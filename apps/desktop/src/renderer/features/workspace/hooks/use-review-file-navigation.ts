import { useCallback, useImperativeHandle, useRef, type Ref } from "react";
import { flushSync } from "react-dom";
import type { useVirtualizer } from "@pierre/diffs/react";

export interface ReviewFileTarget {
  element: HTMLElement;
  expand: () => void;
  focus: () => void;
}
export interface ReviewFileNavigation {
  jumpToFile: (path: string) => void;
}

/** Use the virtualizer's logical scroll position instead of scrolling the window. */
export function useReviewFileNavigation(virtualizer: ReturnType<typeof useVirtualizer>, navigationRef: Ref<ReviewFileNavigation>) {
  const targets = useRef(new Map<string, ReviewFileTarget>());
  const registerFile = useCallback((path: string, target: ReviewFileTarget) => {
    targets.current.set(path, target);
    return () => { if (targets.current.get(path) === target) targets.current.delete(path); };
  }, []);
  const jumpToFile = useCallback((path: string) => {
    const target = targets.current.get(path);
    if (!target || !virtualizer) return;
    // Expansion changes the scroll range. Commit it and invalidate cached
    // dimensions before Pierre clamps the destination to that range.
    flushSync(() => target.expand());
    virtualizer.markDOMDirty();
    // Height reconciliation issues instant anchor corrections, which interrupt
    // native smooth scrolling as intermediate files enter the viewport.
    virtualizer.scrollTo({ top: Math.max(0, virtualizer.getOffsetInScrollContainer(target.element)), behavior: "instant" });
    target.focus();
  }, [virtualizer]);
  useImperativeHandle(navigationRef, () => ({ jumpToFile }), [jumpToFile]);
  return registerFile;
}
