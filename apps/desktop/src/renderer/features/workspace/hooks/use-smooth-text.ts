import { useEffect, useRef, useState } from "react";

/**
 * How many frames the current backlog is spread over. Higher = slower,
 * smoother tail; lower = snappier catch-up. At 60fps a value of 10 drains
 * each incoming chunk in ~170ms, comfortably inside the typical gap
 * between SDK chunks so the reveal never falls behind the stream.
 */
const DRAIN_FRAMES = 10;

/**
 * Advance the revealed prefix of `target` by one animation step.
 * Pure so it can be unit-tested without a DOM: returns the next string to
 * display given what is currently displayed.
 *
 * - `displayed` must be a prefix of `target`; if the stream diverged
 *   (cleared/replaced content), snaps straight to `target`.
 * - Steps by ceil(backlog / DRAIN_FRAMES) so bursty chunks drain at a rate
 *   proportional to their size instead of popping in whole.
 * - Never splits a surrogate pair, so emoji/CJK-ext glyphs don't render as
 *   replacement characters mid-reveal.
 */
export function advanceReveal(target: string, displayed: string): string {
  if (!target.startsWith(displayed)) return target;
  const backlog = target.length - displayed.length;
  if (backlog === 0) return displayed;
  let end = displayed.length + Math.max(1, Math.ceil(backlog / DRAIN_FRAMES));
  if (end >= target.length) return target;
  const code = target.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end++;
  return target.slice(0, end);
}

/**
 * Typewriter catch-up for streamed text. While `enabled`, the returned
 * string chases `target` one requestAnimationFrame step at a time, turning
 * bursty SDK chunks into a steady per-frame reveal. Content present on
 * mount shows immediately — only text appended afterwards animates — and
 * when `enabled` is false the full target is returned untouched.
 */
export function useSmoothText(target: string, enabled: boolean): string {
  const [displayed, setDisplayed] = useState(target);
  // The rAF chain outlives each render; the ref lets ticks read what is
  // actually on screen without restarting the effect per frame.
  const displayedRef = useRef(target);

  useEffect(() => {
    if (!enabled || displayedRef.current === target) return;
    let raf: number;
    const tick = () => {
      const next = advanceReveal(target, displayedRef.current);
      displayedRef.current = next;
      setDisplayed(next);
      if (next !== target) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, target]);

  if (!enabled) return target;
  // State is only maintained while enabled, so right after re-enabling it
  // can still hold another stream's text. A stale prefix is a valid reveal
  // start; anything else shows the target until the first tick snaps to it.
  return target.startsWith(displayed) ? displayed : target;
}
