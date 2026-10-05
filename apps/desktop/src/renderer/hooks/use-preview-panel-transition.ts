import { useEffect, useReducer } from "react";

type AnimationState = "closed" | "opening" | "open" | "closing";

/** Keep the surface present until its slide finishes, including rapid reopen. */
export function usePreviewPanelTransition(isOpen: boolean) {
  const [state, transition] = useReducer(
    (_: AnimationState, next: AnimationState) => next,
    isOpen ? "opening" : "closed",
  );
  useEffect(() => {
    transition(isOpen ? "opening" : "closing");
  }, [isOpen]);
  useEffect(() => {
    if (state !== "opening" && state !== "closing") return;
    const timer = setTimeout(() => transition(state === "opening" ? "open" : "closed"), state === "opening" ? 50 : 300);
    return () => clearTimeout(timer);
  }, [state]);
  return { isVisible: state !== "closed", isAnimatedIn: state === "open" };
}
