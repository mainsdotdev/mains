import { type CSSProperties } from "react";

/** Dots placed around the ring. */
const DOTS = 8;
/** Cycle length — must match the `circleDotPulse` animation in `index.css`. */
const DUR_MS = 900;
/** Ring radius as a % of the box — with 24% dots the ring just fills it. */
const RADIUS = 38;

/**
 * Per-dot position + phase, computed once. Delays are negative so every dot is
 * already mid-cycle on first paint; each dot peaks `1/DOTS` of a cycle after
 * its neighbour, so the highlight chases clockwise (angle 0 at 12 o'clock,
 * screen-space y-down makes increasing angles clockwise).
 */
const CELLS = Array.from({ length: DOTS }, (_, i) => {
  const angle = (i / DOTS) * 2 * Math.PI - Math.PI / 2;
  return {
    left: 50 + RADIUS * Math.cos(angle),
    top: 50 + RADIUS * Math.sin(angle),
    delay: Math.round((i / DOTS - 1) * DUR_MS),
  } as const;
});

/**
 * The classic rotating circle loader, in this spinner family's cell language:
 * tiny squares arranged on a ring, each pulsing in turn so the bright spot
 * orbits clockwise with a comet tail — no actual rotation transform. Keyframes
 * and dot styling live in `index.css` (`.circle-dot` / `circleDotPulse`);
 * color inherits from the surrounding text via `currentColor`, size via
 * `className`.
 */
export function CircleSpinner({
  className = "size-2.75",
}: {
  className?: string;
}) {
  return (
    <span aria-hidden className={`relative block shrink-0 ${className}`}>
      {CELLS.map(({ left, top, delay }, i) => (
        <span
          key={i}
          className="circle-dot"
          style={
            {
              left: `${left}%`,
              top: `${top}%`,
              "--cd-delay": `${delay}ms`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}
