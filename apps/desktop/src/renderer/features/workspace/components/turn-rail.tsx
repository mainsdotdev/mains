import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Button, Text } from "@/components/ui";
import type { TurnMarker } from "../lib/turn-markers";

/**
 * Below this the rail is noise: with a couple of exchanges the whole
 * conversation is a scroll away, and a two-tick navigator says nothing the
 * transcript doesn't.
 */
export const TURN_RAIL_MIN_MARKERS = 4;

interface HoveredTurn {
  marker: TurnMarker;
  /** Centre of the hovered tick, relative to the rail — where the card points. */
  offsetY: number;
}

export interface TurnMarkerPosition {
  groupId: string;
  top: number;
}

/** A turn owns the transcript span from its prompt to the next prompt. */
export function visibleTurnMarkerGroupIds(
  positions: TurnMarkerPosition[],
  viewportTop: number,
  viewportBottom: number,
  contentBottom: number,
): Set<string> {
  const visible = new Set<string>();
  for (let index = 0; index < positions.length; index++) {
    const position = positions[index];
    const end = positions[index + 1]?.top ?? contentBottom;
    if (end > viewportTop && position.top < viewportBottom) {
      visible.add(position.groupId);
    }
  }
  return visible;
}

function sameIds(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/**
 * A tick per user message down the left edge of the transcript — the shape of
 * the conversation, and a way back into it.
 *
 * Hovering a tick previews that exchange: what was asked, and the opening of
 * the answer. Clicking scrolls the transcript to it. The rail itself doesn't
 * scroll with the content; it is a map of the whole run, not part of it.
 */
export function TurnRail({
  markers,
  onSelect,
  transcriptRef,
}: {
  markers: TurnMarker[];
  onSelect: (marker: TurnMarker) => void;
  transcriptRef: RefObject<HTMLDivElement | null>;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<HoveredTurn | null>(null);
  const [visibleGroupIds, setVisibleGroupIds] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript || markers.length < TURN_RAIL_MIN_MARKERS) return;

    let frame: number | null = null;
    const updateVisibleTurns = () => {
      frame = null;
      const transcriptBounds = transcript.getBoundingClientRect();
      const positions = markers.flatMap<TurnMarkerPosition>((marker) => {
        const target = transcript.querySelector<HTMLElement>(
          `[data-group-index="${marker.index}"]`,
        );
        if (!target) return [];
        return [
          {
            groupId: marker.groupId,
            top:
              target.getBoundingClientRect().top -
              transcriptBounds.top +
              transcript.scrollTop,
          },
        ];
      });
      const next = visibleTurnMarkerGroupIds(
        positions,
        transcript.scrollTop,
        transcript.scrollTop + transcript.clientHeight,
        transcript.scrollHeight,
      );
      setVisibleGroupIds((current) =>
        sameIds(current, next) ? current : next,
      );
    };
    const scheduleUpdate = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(updateVisibleTurns);
    };

    transcript.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleUpdate);
    resizeObserver?.observe(transcript);
    if (transcript.firstElementChild) {
      resizeObserver?.observe(transcript.firstElementChild);
    }
    scheduleUpdate();

    return () => {
      transcript.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      resizeObserver?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [markers, transcriptRef]);

  // The card lives outside the tick column, so it needs the tick's position.
  // Measured on enter rather than tracked: it only has to be right while the
  // pointer is on that tick.
  const handleEnter = useCallback(
    (marker: TurnMarker, element: HTMLElement) => {
      const rail = railRef.current;
      if (!rail) return;
      const tick = element.getBoundingClientRect();
      const bounds = rail.getBoundingClientRect();
      setHovered({
        marker,
        offsetY: tick.top - bounds.top + tick.height / 2,
      });
    },
    [],
  );

  if (markers.length < TURN_RAIL_MIN_MARKERS) return null;

  const hoveredMarkerIndex = hovered
    ? markers.findIndex((marker) => marker.index === hovered.marker.index)
    : -1;

  return (
    <div
      ref={railRef}
      className="absolute left-3 top-1/2 z-10 -translate-y-1/2"
      aria-label="Conversation turns"
      onMouseLeave={() => setHovered(null)}
    >
      {/* Only the ticks scroll. The card cannot live in here: a scroll box
          clips on both axes, and the card hangs off the right edge. */}
      <div className="flex max-h-[70vh] flex-col overflow-y-auto noscrollbar py-2">
        {markers.map((marker, index) => {
          const isHovered = hovered?.marker.index === marker.index;
          const isHoverNeighbor =
            hoveredMarkerIndex >= 0 &&
            Math.abs(index - hoveredMarkerIndex) === 1;
          const isVisible = visibleGroupIds.has(marker.groupId);
          const widthClass = isHovered
            ? "w-7"
            : isHoverNeighbor
              ? "w-4"
              : isVisible
                ? "w-3"
                : "w-2";
          const colorClass = isHovered
            ? "bg-primary-900 opacity-100 dark:bg-primary-100"
            : isVisible
              ? "bg-primary-700 opacity-90 dark:bg-primary-300"
              : "bg-primary-400 opacity-35 dark:bg-primary-600";
          return (
            <Button
              key={marker.groupId}
              onClick={() => onSelect(marker)}
              onMouseEnter={(e) => handleEnter(marker, e.currentTarget)}
              onFocus={(e) => handleEnter(marker, e.currentTarget)}
              onBlur={() => setHovered(null)}
              aria-label={marker.prompt || "Jump to message"}
              aria-current={isVisible ? "location" : undefined}
              // Padded well past the 1px line so the pointer can actually land
              // on it; the hit area is the row, the mark is the hairline.
              className="flex h-3 w-9 shrink-0 items-center"
            >
              <span
                className={`h-0.5 rounded-full transition-[width,background-color,opacity] duration-150 ease-out motion-reduce:transition-none ${widthClass} ${colorClass}`}
              />
            </Button>
          );
        })}
      </div>

      {hovered && (
        <div
          className="pointer-events-none absolute left-full ml-1 w-64 -translate-y-1/2 rounded-2xl glass-surface px-3.5 py-2.5"
          style={{ top: hovered.offsetY }}
          role="tooltip"
        >
          <Text
            as="p"
            size="xs"
            tone="secondary"
            weight="medium"
            className="line-clamp-2"
          >
            {hovered.marker.prompt}
          </Text>
          {hovered.marker.reply && (
            <Text as="p" size="xs" tone="subtle" className="mt-1 line-clamp-3">
              {hovered.marker.reply}
            </Text>
          )}
        </div>
      )}
    </div>
  );
}
