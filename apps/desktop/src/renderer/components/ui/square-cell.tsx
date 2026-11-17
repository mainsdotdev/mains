import type { CSSProperties, ReactNode } from "react";

export const SQUARE_PULSE_DURATION_MS = 2000;
const PEAK = 0.24;
const SWEEP = 0.25;

/** Shared timing for the spinner and shaped grids of the same cells. */
export function squareCellStyle(row: number, col: number, side: number): CSSProperties {
  const diagonal = Math.max(1, (side - 1) * 2);
  return {
    "--tsq-d1": (row + col) / diagonal * SWEEP - PEAK,
    "--tsq-d2": 0.5 + (side - 1 - row + col) / diagonal * SWEEP - PEAK,
  } as CSSProperties;
}

export function SquareCell({ className = "", style, children, ...attributes }: {
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  "data-cell-id"?: string;
  "data-eye"?: "left" | "right";
}) {
  return <span {...attributes} className={`tool-square ${className}`} style={style}>{children}</span>;
}
