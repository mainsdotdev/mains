import { useCallback, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setSessionPanelOpen } from "@/lib/redux/slices/appSettingsSlice";
import { usePanelAnimation } from "@/hooks/use-panel-animation";
import { useIsMobile } from "@/lib/platform";
import { LAYOUT_PANEL_ANIM_MS, SESSION_PANEL_GUTTER } from "@/lib/layout";
import { Text } from "@/components/ui";
import { useModeConfig } from "@/hooks/use-mode-config";
import { GitActionsSection } from "./git-actions";
import { SessionResourcesSection } from "./session-resources-section";

/** Overshoots slightly past full size — the "pop" as the box inflates. */
const POP_EASE = "cubic-bezier(0.34, 1.56, 0.64, 1)";
/** No overshoot on the way out; it just deflates back into the corner. */
const COLLAPSE_EASE = "cubic-bezier(0.4, 0, 1, 1)";

interface SessionPanelProps {
  providerId?: string;
  /** The run whose sources and deliverables the panel describes. */
  runId: string | null;
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
 * The session box: the active workspace's environment plus the sources and
 * deliverables belonging to the open run. Sections are mode-driven: Code gets
 * Environment + Sources; Work gets Sources + Deliverables.
 *
 * A standalone box pinned to the top-right corner. It always sits *over* the
 * content surface rather than taking a column out of it — shrinking the content
 * would cut a hole in its opaque surface and expose the translucent window
 * behind it. Normally the app shell pads the content on the right to match, so
 * the centered chat column slides left to clear the box; when another panel has
 * already claimed the right edge there is nothing left to give, and the box
 * overlaps the chat instead (`floating`).
 *
 * The PR editor keeps this component mounted while the panel itself is hidden,
 * preserving its draft until the editor returns or the PR is created.
 */
export function SessionPanel({
  providerId,
  runId,
  laneOffset,
  floating,
}: SessionPanelProps) {
  const dispatch = useAppDispatch();
  const isMobile = useIsMobile();
  const activeWorkspaceId = useAppSelector(
    (state) => state.workspace.activeWorkspaceId,
  );
  const isOpen = useAppSelector((state) => state.appSettings.sessionPanelOpen);
  const [prEditorOpen, setPrEditorOpen] = useState(false);
  const [prTransitioning, setPrTransitioning] = useState(false);
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const { showGitActions, showSources, showDeliverables } = useModeConfig();
  const showEnvironment = showGitActions && !!activeWorkspaceId;
  const showRunResources = showSources && !!runId;
  const hasContent = showEnvironment || showRunResources;

  const { isVisible, isAnimatedIn } = usePanelAnimation(
    (isOpen || prEditorOpen) && hasContent,
  );

  const close = useCallback(
    () => {
      setPrEditorOpen(false);
      setPrTransitioning(false);
      dispatch(setSessionPanelOpen(false));
    },
    [dispatch],
  );

  const onPrEditorOpenChange = useCallback(
    (open: boolean, transitioning: boolean) => {
      setPrEditorOpen(open);
      setPrTransitioning(transitioning);
      dispatch(setSessionPanelOpen(!open));
    },
    [dispatch],
  );
  const onPrEditorTransitionEnd = useCallback(() => setPrTransitioning(false), []);

  if (!isVisible || !hasContent) return null;

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
        transform: reducedMotion
          ? "scale(1)"
          : prEditorOpen
            ? "translateX(0.5rem) scale(0.98)"
            : isAnimatedIn
              ? "scale(1)"
              : "scale(0.86)",
        opacity: prEditorOpen ? 0 : isAnimatedIn ? 1 : 0,
        pointerEvents: prEditorOpen ? "none" : undefined,
        transition: prTransitioning
          ? "none"
          : reducedMotion
            ? "opacity 120ms ease-out"
            : [
              `transform ${LAYOUT_PANEL_ANIM_MS}ms ${isAnimatedIn ? POP_EASE : COLLAPSE_EASE}`,
              `opacity ${isAnimatedIn ? LAYOUT_PANEL_ANIM_MS : LAYOUT_PANEL_ANIM_MS * 0.6}ms ease-out`,
              `right ${LAYOUT_PANEL_ANIM_MS}ms ease-out`,
              ].join(", "),
      }}
      role="complementary"
      aria-label="Session panel"
      aria-hidden={prEditorOpen || undefined}
      inert={prEditorOpen}
    >
      {/* Rows open their forms in place, so the box grows with its content —
          capped short of the viewport so it never runs off the bottom. */}
      <div className="max-h-[calc(100vh-5rem)] overflow-y-auto noscrollbar p-1.5">
        {showEnvironment && (
          <section aria-labelledby="session-environment-heading">
            <Text
              id="session-environment-heading"
              as="h2"
              size="xs"
              tone="subtle"
              weight="medium"
              className="px-2 pb-1 pt-2"
            >
              Environment
            </Text>
            <GitActionsSection
              providerId={providerId}
              onClose={close}
              onPrEditorOpenChange={onPrEditorOpenChange}
              onPrEditorTransitionEnd={onPrEditorTransitionEnd}
            />
          </section>
        )}
        {showRunResources && runId && (
          <SessionResourcesSection
            key={runId}
            runId={runId}
            showDeliverables={showDeliverables}
            hideWhenEmpty={showGitActions}
            separated={showEnvironment}
          />
        )}
      </div>
    </div>
  );
}
