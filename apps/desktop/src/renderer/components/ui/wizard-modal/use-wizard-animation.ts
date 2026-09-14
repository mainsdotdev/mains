import { useLayoutEffect, useRef } from "react";
import type { WizardAction } from "./wizard-reducer";

export function useWizardAnimation<TData>(
  stepIndex: number,
  shouldAnimate: boolean,
  animationDuration: number,
  innerRef: React.RefObject<HTMLDivElement | null>,
  dispatch: React.Dispatch<WizardAction<TData>>,
) {
  const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const prevHeightRef = useRef<number>(0);

  useLayoutEffect(() => {
    if (!shouldAnimate || !innerRef.current) return;

    const newHeight = innerRef.current.offsetHeight;
    const prevHeight = prevHeightRef.current;

    // First render or no change - just store and skip
    if (prevHeight === 0 || Math.abs(newHeight - prevHeight) < 2) {
      prevHeightRef.current = newHeight;
      return;
    }

    // Clear any pending animation
    if (animationTimeoutRef.current) {
      clearTimeout(animationTimeoutRef.current);
    }

    // Lock to previous height immediately (before paint)
    dispatch({
      type: "SET_ANIM",
      animState: { height: prevHeight, active: true },
    });

    // After paint, animate to new height
    requestAnimationFrame(() => {
      dispatch({
        type: "SET_ANIM",
        animState: { height: newHeight, active: true },
      });
      prevHeightRef.current = newHeight;

      animationTimeoutRef.current = setTimeout(() => {
        dispatch({
          type: "SET_ANIM",
          animState: { height: "auto", active: false },
        });
      }, animationDuration);
    });

    return () => {
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
    };
  }, [stepIndex, shouldAnimate, animationDuration, innerRef, dispatch]);

  return prevHeightRef;
}
