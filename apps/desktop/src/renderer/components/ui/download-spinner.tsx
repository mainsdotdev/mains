import { type CSSProperties } from "react";

/** Side of the loader grid. Matches `SquareSpinner` for a shared look. */
const GRID = 3;
/** Cycle length — must match the `toolSquarePulse` animation in `index.css`. */
const DUR_MS = 2000;
/** Keyframe peak position (fraction of cycle) — must match `toolSquarePulse`. */
const PEAK = 0.28;
/** Fraction of a half-cycle that each top-to-bottom sweep spans. */
const SWEEP = 0.3;

/**
 * Per-cell pulse delays for two stacked top-to-bottom sweeps, keyed purely by
 * `row` so a whole row lights at once and the lit band marches downward — a
 * "downloading" cascade. `--tsq-d1` drives the descent over the first half of
 * the cycle, `--tsq-d2` repeats it over the second half so the motion is
 * continuous. Delays subtract the keyframe's peak offset (landing the bump on
 * the target phase) and may go negative so the grid is already mid-cycle on
 * first paint. Computed once.
 */
const CELLS = Array.from({ length: GRID * GRID }, (_, i) => {
  const row = Math.floor(i / GRID);
  const max = GRID - 1; // last row index
  const phase = (target: number) => Math.round((target - PEAK) * DUR_MS);
  const d1 = phase((row / max) * SWEEP);
  const d2 = phase(0.5 + (row / max) * SWEEP);
  return { d1, d2 } as const;
});

const TEMPLATE = `repeat(${GRID}, minmax(0, 1fr))`;

/**
 * Downloading indicator: the same square grid as `SquareSpinner`, but its lit
 * cells sweep straight down the rows (top → bottom, on a loop) so it reads as a
 * "download". Reuses the `.tool-square` cell + `toolSquarePulse` keyframe from
 * `index.css` for an identical visual language; color is inherited from the
 * surrounding text via `currentColor`, and size comes from `className`.
 */
export function DownloadSpinner({
  className = "size-2.75",
}: {
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 gap-px ${className}`}
      style={{ gridTemplateColumns: TEMPLATE, gridTemplateRows: TEMPLATE }}
    >
      {CELLS.map(({ d1, d2 }, i) => (
        <span
          key={i}
          className="tool-square"
          style={{ "--tsq-d1": `${d1}ms`, "--tsq-d2": `${d2}ms` } as CSSProperties}
        />
      ))}
    </span>
  );
}
