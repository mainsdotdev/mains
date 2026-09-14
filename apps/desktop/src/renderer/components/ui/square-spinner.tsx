import { type CSSProperties } from "react";

/** Side of the loader grid. Drives `grid-template` below. */
const GRID = 3;
/** Cycle length — must match the `toolSquarePulse` animation in `index.css`. */
const DUR_MS = 2000;
/** Keyframe peak position (fraction of cycle) — must match `toolSquarePulse`. */
const PEAK = 0.28;
/** Fraction of a half-cycle that each diagonal sweep spans. */
const SWEEP = 0.25;

/**
 * Per-cell pulse delays for the two diagonal sweeps. `--tsq-d1` drives the
 * top-left → bottom-right pass (keyed by the anti-diagonal `row + col`) over the
 * first half of the cycle; `--tsq-d2` drives the bottom-left → top-right pass
 * (keyed by `(N-1-row) + col`) over the second half. Delays subtract the
 * keyframe's peak offset — landing the bump on the target phase — and may go
 * negative so every cell is already mid-cycle on first paint. Computed once.
 */
const CELLS = Array.from({ length: GRID * GRID }, (_, i) => {
  const row = Math.floor(i / GRID);
  const col = i % GRID;
  const max = (GRID - 1) * 2; // largest diagonal index
  const phase = (target: number) => Math.round((target - PEAK) * DUR_MS);
  const d1 = phase(((row + col) / max) * SWEEP);
  const d2 = phase(0.5 + ((GRID - 1 - row + col) / max) * SWEEP);
  return { d1, d2 } as const;
});

const TEMPLATE = `repeat(${GRID}, minmax(0, 1fr))`;

/**
 * Loading indicator: a small grid of squares whose lit cells slide diagonally
 * across (top-left → bottom-right, then bottom-left → top-right) with a smooth,
 * faintly random pulse. Keyframes and cell styling live in `index.css`
 * (`.tool-square` / `toolSquarePulse`); color is inherited from the surrounding
 * text via `currentColor`, and size comes from `className` (default `size-3`).
 */
export function SquareSpinner({ className = "size-2.75" }: { className?: string }) {
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
