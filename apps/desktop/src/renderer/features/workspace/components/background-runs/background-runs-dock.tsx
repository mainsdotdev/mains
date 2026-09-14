import { useCallback, useEffect, useRef, useState } from "react";
import { useBackgroundRuns } from "../../hooks/use-background-runs";
import { BackgroundRunCard } from "./background-run-card";

/** How long the stack stays open after the pointer leaves it entirely. */
const COLLAPSE_DELAY_MS = 2000;
/** Vertical sliver each card behind the front one pokes out by. */
const STACK_PEEK_PX = 5;
/** Horizontal inset per layer, so the deck narrows toward the back. */
const STACK_INSET_PX = 5;
/** Edges drawn behind the front card, however many runs there are. */
const MAX_STACK_LAYERS = 2;

/**
 * Runs still working somewhere the user isn't looking, above the sidebar
 * footer — the app's answer to "I started this in Codex, then switched to
 * Claude". Renders nothing when everything live is already on screen.
 *
 * Collapsed, they read as a deck: the newest run face-up, the rest as edges
 * peeking above it. Hovering fans the deck upward; leaving it re-stacks after a
 * pause, so crossing the sidebar on the way somewhere else doesn't snap the
 * list shut mid-read. The face-up card keeps its screen position in both
 * states — expanding grows upward from it, so nothing moves under the pointer.
 */
export function BackgroundRunsDock() {
  const { runs, activityByRunId, jumpToRun, stopRun, stoppingRunIds } =
    useBackgroundRuns();
  const [isOpen, setIsOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const collapseTimerRef = useRef<number | null>(null);

  const cancelCollapse = useCallback(() => {
    if (collapseTimerRef.current !== null) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
  }, []);

  const open = useCallback(() => {
    cancelCollapse();
    setIsOpen(true);
  }, [cancelCollapse]);

  // Deliberately not immediate: the pointer leaves on the way to a card's stop
  // button, or on a stray cross of the sidebar, and both should be forgiving.
  const scheduleCollapse = useCallback(() => {
    cancelCollapse();
    collapseTimerRef.current = window.setTimeout(() => {
      collapseTimerRef.current = null;
      setIsOpen(false);
    }, COLLAPSE_DELAY_MS);
  }, [cancelCollapse]);

  useEffect(() => cancelCollapse, [cancelCollapse]);

  // One shared clock for every elapsed label, ticking only while cards exist.
  const hasRuns = runs.length > 0;
  useEffect(() => {
    if (!hasRuns) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasRuns]);

  if (!hasRuns) return null;

  // Derived, not reset: a stack that drops to one run must not stay "open" and
  // then reopen the next time a second run starts.
  const isStackable = runs.length > 1;
  const isFanned = isOpen && isStackable;
  const layers = Math.min(runs.length - 1, MAX_STACK_LAYERS);

  // Oldest first, so the newest run is last — the bottom of the fan and the
  // face of the deck, at the same y in both states.
  const faceRun = runs[runs.length - 1];
  const behindRuns = runs.slice(0, -1);

  const renderCard = (run: (typeof runs)[number]) => (
    <BackgroundRunCard
      key={run.id}
      run={run}
      activity={activityByRunId[run.id]}
      nowMs={nowMs}
      isStopping={stoppingRunIds.includes(run.id)}
      onOpen={() => void jumpToRun(run)}
      onStop={() => void stopRun(run)}
    />
  );

  return (
    <div
      className="px-2 pb-1"
      role="region"
      aria-label="Runs working in the background"
      onMouseEnter={open}
      onMouseLeave={scheduleCollapse}
      // Focus events bubble in React, so tabbing into any card fans the deck
      // and keeps the keyboard path equivalent to the pointer one.
      onFocus={open}
      onBlur={scheduleCollapse}
    >
      {/* One tree for both states — the stacked cards are hidden, not unmounted.
          Swapping trees would remount the face card and drop keyboard focus the
          instant tabbing into it fans the deck. */}
      <div
        className="relative max-h-[45vh] overflow-y-auto transition-[padding] duration-200 ease-out"
        style={{ paddingTop: isFanned ? 0 : layers * STACK_PEEK_PX }}
        title={
          isFanned || !isStackable
            ? undefined
            : `${runs.length} runs working in the background`
        }
      >
        {/* The deck behind the face card: edges only, no content — the cards
            they stand for are one hover away. Drawn back-to-front so the
            furthest layer sits highest and narrowest, and faded out rather than
            unmounted so opening and closing are the same move in reverse. */}
        {Array.from({ length: layers }, (_, index) => {
          const depth = layers - index;
          return (
            <div
              key={`edge-${depth}`}
              aria-hidden
              className="absolute h-10 rounded-2xl glass-outline bg-primary-100 dark:bg-primary-900 transition-opacity duration-200 ease-out"
              style={{
                top: (layers - depth) * STACK_PEEK_PX,
                left: depth * STACK_INSET_PX,
                right: depth * STACK_INSET_PX,
                opacity: isFanned ? 0 : 1 - depth * 0.25,
              }}
            />
          );
        })}

        {/* Each stacked card is a collapsing grid row (0fr ⇄ 1fr): height,
            fade, and the dock's own height all animate off one transition, in
            both directions, and reverse mid-flight if the pointer comes back.
            A keyframe animation could only play the opening half — the closing
            half would need the element to survive its own unmount.
            `inert` keeps the collapsed cards out of the tab order and the
            accessibility tree while they stay mounted. */}
        {behindRuns.map((run) => (
          <div
            key={run.id}
            inert={!isFanned}
            className="grid transition-[grid-template-rows,opacity] duration-200 ease-out"
            style={{
              gridTemplateRows: isFanned ? "1fr" : "0fr",
              opacity: isFanned ? 1 : 0,
            }}
          >
            {/* The gap lives inside the clipped box, not on it: `min-height: 0`
                zeroes a grid item's content, but its padding would still hold
                the row open (6px per card). `space-y` on the parent has the
                same problem — the gaps outlive the rows they separate. */}
            <div className="min-h-0 overflow-hidden">
              <div className="pb-1.5">{renderCard(run)}</div>
            </div>
          </div>
        ))}
        <div className="relative">{renderCard(faceRun)}</div>
      </div>
    </div>
  );
}
