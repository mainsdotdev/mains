import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setSessionPanelOpen } from "@/lib/redux/slices/appSettingsSlice";
import { usePanelAnimation } from "@/hooks/use-panel-animation";
import { useIsMobile } from "@/lib/platform";
import { LAYOUT_PANEL_ANIM_MS, SESSION_PANEL_GUTTER } from "@/lib/layout";
import { GitActionsSection } from "./git-actions";

/** Overshoots slightly past full size — the "pop" as the box inflates. */
const POP_EASE = "cubic-bezier(0.34, 1.56, 0.64, 1)";
/** No overshoot on the way out; it just deflates back into the corner. */
const COLLAPSE_EASE = "cubic-bezier(0.4, 0, 1, 1)";

interface SessionPanelProps {
  providerId?: string;
  /**
   * Width of whatever else occupies the right lane (browser, document viewer,
   * right panel), as a CSS length. The box aligns just inside it.
   */
  laneOffset: string;
  /**
   * True when another panel already owns the right edge: there is no room to
   * share, so the box lies over the chat instead of pushing it aside. Purely
   * derived — closing that panel drops the box back into the layout on its own.
   */
  floating: boolean;
}

/**
 * The session box: the active workspace's working tree, the git actions on it,
 * and the subagents the open run has spawned.
 *
 * A standalone box pinned to the top-right corner. It always sits *over* the
 * content surface rather than taking a column out of it — shrinking the content
 * would cut a hole in its opaque surface and expose the translucent window
 * behind it. Normally the app shell pads the content on the right to match, so
 * the centered chat column slides left to clear the box; when another panel has
 * already claimed the right edge there is nothing left to give, and the box
 * overlaps the chat instead (`floating`).
 *
 * Everything inside mounts only while it is open, so form state resets and the
 * git status refetches on each open.
 */
export function SessionPanel({
  providerId,
  laneOffset,
  floating,
}: SessionPanelProps) {
  const dispatch = useAppDispatch();
  const isMobile = useIsMobile();
  const activeWorkspaceId = useAppSelector(
    (state) => state.workspace.activeWorkspaceId,
  );
  const isOpen = useAppSelector((state) => state.appSettings.sessionPanelOpen);

  const { isVisible, isAnimatedIn } = usePanelAnimation(
    isOpen && !!activeWorkspaceId,
  );

  const close = useCallback(
    () => dispatch(setSessionPanelOpen(false)),
    [dispatch],
  );

  if (!isVisible || !activeWorkspaceId) return null;

  return (
    <div
      className={`fixed z-(--z-panel-toggle) w-(--session-panel-width) max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl glass-outline dark:bg-primary-950 bg-primary will-change-transform ${
        // Lying on top of the transcript, it needs the lift to read as a
        // separate surface; sharing the layout, it doesn't overlap anything.
        floating ? "shadow-2xl" : ""
      }`}
      style={{
        // Tucked under the top-right toolbar, aligned to the same edge — inside
        // whatever panel already owns it.
        top: "calc(3.225rem + env(safe-area-inset-top))",
        right: isMobile
          ? "0.8125rem"
          : `calc(${laneOffset} + ${SESSION_PANEL_GUTTER})`,
        // Grows out of the top-right corner — leftward and downward — with a
        // small overshoot on the way open, so it reads as inflating from the
        // button rather than sliding in from somewhere off-screen.
        transformOrigin: "top right",
        transform: isAnimatedIn ? "scale(1)" : "scale(0.86)",
        opacity: isAnimatedIn ? 1 : 0,
        transition: [
          `transform ${LAYOUT_PANEL_ANIM_MS}ms ${isAnimatedIn ? POP_EASE : COLLAPSE_EASE}`,
          `opacity ${isAnimatedIn ? LAYOUT_PANEL_ANIM_MS : LAYOUT_PANEL_ANIM_MS * 0.6}ms ease-out`,
          `right ${LAYOUT_PANEL_ANIM_MS}ms ease-out`,
        ].join(", "),
      }}
      role="complementary"
      aria-label="Session panel"
    >
      {/* Rows open their forms in place, so the box grows with its content —
          capped short of the viewport so it never runs off the bottom. */}
      <div className="max-h-[calc(100vh-5rem)] overflow-y-auto noscrollbar">
        <GitActionsSection providerId={providerId} onClose={close} />
      </div>
    </div>
  );
}
