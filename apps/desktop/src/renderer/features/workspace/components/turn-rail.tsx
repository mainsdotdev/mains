import { useCallback, useRef, useState } from "react";
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
}: {
  markers: TurnMarker[];
  onSelect: (marker: TurnMarker) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<HoveredTurn | null>(null);

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
        {markers.map((marker) => {
          const isHovered = hovered?.marker.index === marker.index;
          return (
            <Button
              key={marker.groupId}
              onClick={() => onSelect(marker)}
              onMouseEnter={(e) => handleEnter(marker, e.currentTarget)}
              onFocus={(e) => handleEnter(marker, e.currentTarget)}
              onBlur={() => setHovered(null)}
              aria-label={marker.prompt || "Jump to message"}
              // Padded well past the 1px line so the pointer can actually land
              // on it; the hit area is the row, the mark is the hairline.
              className="flex h-3 w-8 shrink-0 items-center"
            >
              <span
                className={`h-px rounded-full transition-all duration-200 ${
                  isHovered
                    ? "w-6 bg-primary-700 dark:bg-primary-200"
                    : "w-3 bg-primary-300 dark:bg-primary-600"
                }`}
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
          <Text as="p" size="xs" tone="secondary" weight="medium" className="line-clamp-2">
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
