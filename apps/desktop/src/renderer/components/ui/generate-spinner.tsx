import { useState, type CSSProperties } from "react";

/** Side of the twinkle grid. */
const GRID = 3;

const TEMPLATE = `repeat(${GRID}, minmax(0, 1fr))`;

/**
 * Random phase + tempo per cell, rolled once per mount so every spinner
 * instance twinkles differently. Negative delays start each cell mid-cycle,
 * so the grid is alive on first paint instead of igniting in unison.
 */
function rollCells() {
  return Array.from({ length: GRID * GRID }, () => ({
    dur: Math.round(900 + Math.random() * 1100),
    delay: -Math.round(Math.random() * 2000),
  }));
}

/**
 * "Generating…" indicator: a grid of tiny squares twinkling at random, unlike
 * SquareSpinner's ordered diagonal sweeps. Keyframes and cell styling live in
 * `index.css` (`.generate-square` / `generateSquareTwinkle`); color inherits
 * from the surrounding text via `currentColor`, size via `className`.
 */
export function GenerateSpinner({
  className = "size-2.75",
}: {
  className?: string;
}) {
  const [cells] = useState(rollCells);
  return (
    <span
      aria-hidden
      className={`grid shrink-0 gap-px ${className}`}
      style={{ gridTemplateColumns: TEMPLATE, gridTemplateRows: TEMPLATE }}
    >
      {cells.map(({ dur, delay }, i) => (
        <span
          key={i}
          className="generate-square"
          style={
            {
              "--gsq-dur": `${dur}ms`,
              "--gsq-delay": `${delay}ms`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}
