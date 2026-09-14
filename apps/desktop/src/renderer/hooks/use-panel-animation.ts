import { useEffect, useLayoutEffect, useReducer } from "react";
import { LAYOUT_PANEL_ANIM_MS } from "@/lib/layout";

type AnimationState = "closed" | "opening" | "open" | "closing";

export interface PanelAnimation {
  /** Mount the panel — true through the whole close transition. */
  isVisible: boolean;
  /** Drive the open styles (transform / opacity) off this. */
  isAnimatedIn: boolean;
}

/**
 * Mount/unmount timing for a sliding panel.
 *
 * A panel can't animate out of a tree it has already left, so `isVisible`
 * outlives `isOpen` by one transition; `isAnimatedIn` flips a frame *after*
 * mount so the browser has an initial style to transition from.
 */
export function usePanelAnimation(isOpen: boolean): PanelAnimation {
  const [animationState, dispatch] = useReducer(
    (state: AnimationState, next: AnimationState) => {
      if (next === "opening") {
        return state === "open" || state === "opening" ? state : "opening";
      }
      if (next === "closing") {
        return state === "closed" || state === "closing" ? state : "closing";
      }
      return next;
    },
    isOpen ? "open" : ("closed" as AnimationState),
  );

  useLayoutEffect(() => {
    dispatch(isOpen ? "opening" : "closing");
  }, [isOpen]);

  useEffect(() => {
    if (animationState === "opening") {
      const frameId = requestAnimationFrame(() => dispatch("open"));
      return () => cancelAnimationFrame(frameId);
    }
    if (animationState === "closing") {
      const timer = setTimeout(() => dispatch("closed"), LAYOUT_PANEL_ANIM_MS);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [animationState]);

  return {
    isVisible: animationState !== "closed",
    isAnimatedIn: animationState === "open",
  };
}
