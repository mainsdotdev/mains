import { useMemo, type CSSProperties } from "react";

/** Side of the glyph grid — one step finer than the 3×3 spinners, so
 *  patterns are distinct at a glance but cells stay chunky at size-4. */
const GRID = 4;
/** Columns actually decided by the hash; the rest mirror. */
const HALF = Math.ceil(GRID / 2);

const TEMPLATE = `repeat(${GRID}, minmax(0, 1fr))`;

/**
 * Hue buckets around the OKLCH wheel — the glyph's whole color axis.
 *
 * Hue is the *only* thing that varies: lightness and chroma are fixed per
 * theme in `.agent-glyph` (index.css), so every agent sits at the same
 * perceived brightness. Brightness is a tempting second axis and a bad one —
 * it buys pairs that read as "the same color, one washed out" rather than as
 * two identities, and it drags half the palette off the contrast the mark
 * needs at size-3.5.
 *
 * 24 puts neighbours 15° apart, roughly the limit at which two tiny marks
 * still read as different colors. Raising it past that trades real
 * distinctness for a bigger number; the identity space grows on the pattern
 * axis instead (2^8 patterns × 24 hues).
 */
const HUES = 24;

/** FNV-1a over a string — the one hash the whole glyph derives from. */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h;
}

/**
 * Deterministic accent hue in degrees for a seed. Exported for tests.
 *
 * Hashed off a salted key so hue and pattern come from independent draws —
 * two agents that land on the same hue then almost never share a pattern.
 */
export function glyphHue(seed: string): number {
  return (Math.abs(fnv1a(`${seed}~hue`)) % HUES) * (360 / HUES);
}

/**
 * Deterministic cell pattern for a seed string. Exported for tests.
 *
 * FNV-1a seeds an LCG that decides the left half of each row; the right half
 * mirrors it (the identicon trick — symmetry is what makes a random scatter
 * read as a deliberate mark). Guaranteed non-empty.
 */
export function glyphCells(seed: string): boolean[] {
  const bits: boolean[] = [];
  let state = fnv1a(seed) || 1;
  for (let i = 0; i < GRID * HALF; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    bits.push(((state >>> 16) & 1) === 1);
  }
  const cells: boolean[] = new Array(GRID * GRID).fill(false);
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < HALF; col++) {
      const on = bits[row * HALF + col];
      cells[row * GRID + col] = on;
      cells[row * GRID + (GRID - 1 - col)] = on;
    }
  }
  if (!cells.some(Boolean)) cells[Math.floor((GRID * GRID) / 2)] = true;
  return cells;
}

/**
 * Deterministic twinkle timing for one lit cell. GenerateSpinner rolls random
 * phases per mount; here they hash from (seed, cell) instead, so the same
 * agent breathes the same way on every surface and re-renders never re-roll.
 */
function cellTiming(seed: string, index: number): { dur: number; delay: number } {
  const h = fnv1a(`${seed}#${index}`);
  return {
    dur: 900 + (Math.abs(h) % 1100),
    delay: -(Math.abs(Math.imul(h, 2654435761)) % 2000),
  };
}

/**
 * Identity mark in the ascii-spinner family: the same tiny square-grid
 * language as SquareSpinner/GenerateSpinner, with the pattern hashed from
 * `seed` so one agent renders the same mark everywhere, forever.
 *
 * While `active`, the pattern's lit cells twinkle (GenerateSpinner's
 * keyframes) — the mark stays readable because the unlit ghost cells hold
 * still and the lit cells stagger. When work ends the animation drops and the
 * mark freezes.
 *
 * The glyph tints itself: both halves of the identity (pattern and hue) hash
 * from the same `seed`, so a caller cannot pair one agent's mark with another
 * agent's color. `className` carries size only.
 */
export function AgentGlyph({
  seed,
  active = false,
  className = "size-4",
}: {
  seed: string;
  active?: boolean;
  className?: string;
}) {
  const cells = useMemo(() => glyphCells(seed), [seed]);
  const hue = useMemo(() => glyphHue(seed), [seed]);
  return (
    <span
      aria-hidden
      className={`agent-glyph grid shrink-0 gap-px ${className}`}
      style={
        {
          gridTemplateColumns: TEMPLATE,
          gridTemplateRows: TEMPLATE,
          "--agent-hue": hue,
        } as CSSProperties
      }
    >
      {cells.map((on, i) => {
        if (on && active) {
          const { dur, delay } = cellTiming(seed, i);
          return (
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
          );
        }
        return (
          <span
            key={i}
            className="rounded-[1px] bg-current"
            style={{ opacity: on ? 1 : 0.15 }}
          />
        );
      })}
    </span>
  );
}
