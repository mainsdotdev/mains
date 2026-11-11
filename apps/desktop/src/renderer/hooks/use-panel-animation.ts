import { LAYOUT_PANEL_ANIM_MS } from "@/lib/layout";
import { useOverlayAnimation } from "./use-overlay-lifecycle";

export interface PanelAnimation {
  /** Mount the panel — true through the whole close transition. */
  isVisible: boolean;
  /** Drive the open styles (transform / opacity) off this. */
  isAnimatedIn: boolean;
}

/** Preserve mounting through exit; reopening reverses the current CSS transition. */
export function usePanelAnimation(isOpen: boolean): PanelAnimation {
  const { isVisible, isAnimatedIn } = useOverlayAnimation(isOpen, { exitMs: LAYOUT_PANEL_ANIM_MS });
  return { isVisible, isAnimatedIn };
}
