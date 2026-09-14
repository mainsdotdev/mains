import { useEffect, useRef, useState } from "react";

/**
 * Spread the current backlog across a short run of frames. Incoming provider
 * chunks vary wildly in size; draining a fraction of the backlog on each frame
 * keeps both single-token and bursty streams moving without building a long
 * delay behind the Mac.
 */
const DRAIN_FRAMES = 10;

/** Advance a streamed prefix without cutting an emoji's surrogate pair. */
export function advanceTextReveal(target: string, displayed: string): string {
  if (!target.startsWith(displayed)) return target;
  const backlog = target.length - displayed.length;
  if (backlog === 0) return displayed;

  let end = displayed.length + Math.max(1, Math.ceil(backlog / DRAIN_FRAMES));
  if (end >= target.length) return target;

  const finalCodeUnit = target.charCodeAt(end - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) end++;
  return target.slice(0, end);
}

/**
 * Turn cumulative, chunk-sized snapshots into a steady character reveal.
 * Existing text is immediate on mount; only content appended during a live
 * response is paced over animation frames.
 */
export function useSmoothText(target: string): string {
  const [displayed, setDisplayed] = useState(target);
  const displayedRef = useRef(target);

  useEffect(() => {
    if (displayedRef.current === target) return;

    let frame: number | null = null;
    const tick = () => {
      const next = advanceTextReveal(target, displayedRef.current);
      displayedRef.current = next;
      setDisplayed(next);
      if (next !== target) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [target]);

  return target.startsWith(displayed) ? displayed : target;
}
