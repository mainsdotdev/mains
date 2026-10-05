import { useCallback, useImperativeHandle, useRef, type Ref } from "react";
import { useReducedMotion } from "motion/react";
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
  const reducedMotion = useReducedMotion();
  const registerFile = useCallback((path: string, target: ReviewFileTarget) => {
    targets.current.set(path, target);
    return () => { if (targets.current.get(path) === target) targets.current.delete(path); };
  }, []);
  const jumpToFile = useCallback((path: string) => {
    const target = targets.current.get(path);
    if (!target || !virtualizer) return;
    target.expand();
    virtualizer.scrollTo({ top: Math.max(0, virtualizer.getOffsetInScrollContainer(target.element)), behavior: reducedMotion ? "auto" : "smooth" });
    target.focus();
  }, [virtualizer, reducedMotion]);
  useImperativeHandle(navigationRef, () => ({ jumpToFile }), [jumpToFile]);
  return registerFile;
}
