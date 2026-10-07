import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

const BASE_CHARS_PER_SECOND = 80;
const INITIAL_BUFFER_MS = 120;
const CATCH_UP_SECONDS = 1.2;
const RATE_BLEND_MS = 240;
const INITIAL_REVEAL_CHARS = 180;

/**
 * Reveal a character budget without splitting a surrogate pair. A zero budget
 * leaves the prefix alone; a replaced source shows its own text immediately.
 */
export function advanceReveal(target: string, displayed: string, characters = 1): string {
  if (!target.startsWith(displayed)) return target;
  let end = displayed.length + Math.max(0, Math.floor(characters));
  if (end >= target.length) return target;
  if (end === displayed.length) return displayed;
  const code = target.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end++;
  return target.slice(0, end);
}

/**
 * Buffer live text briefly and reveal it on a wall-clock character budget.
 * Blend speed changes instead of accelerating on every packet. Once the server
 * finishes, drain the remaining buffer at its current speed. Settled history
 * shows immediately; remounting a long live report only animates its tail.
 */
export function useSmoothText(target: string, enabled: boolean): string {
  const reducedMotion = usePrefersReducedMotion();
  const [displayed, setDisplayed] = useState(() => enabled && !reducedMotion
    ? advanceReveal(target, "", Math.max(0, target.length - INITIAL_REVEAL_CHARS))
    : target);
  const [active, setActive] = useState(enabled && !reducedMotion);
  // The rAF chain outlives each render; the ref lets ticks read what is
  // actually on screen without restarting the effect per frame.
  const displayedRef = useRef(displayed);
  const targetRef = useRef(target);
  const rafRef = useRef<number | null>(null);
  const activeRef = useRef(enabled && !reducedMotion);
  const streamingRef = useRef(enabled);
  const startedRef = useRef(false);

  useEffect(() => {
    targetRef.current = target;
    if (enabled && !streamingRef.current) startedRef.current = false;
    streamingRef.current = enabled;
    if (enabled && !activeRef.current) {
      activeRef.current = true;
      setActive(true);
    }
    if (reducedMotion || !activeRef.current || !target.startsWith(displayedRef.current)) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      displayedRef.current = target;
      activeRef.current = enabled && !reducedMotion;
      setActive(activeRef.current);
      setDisplayed(target);
      return;
    }
    if (displayedRef.current === target) {
      if (!enabled) {
        activeRef.current = false;
        setActive(false);
      }
      return;
    }
    if (rafRef.current !== null) return;

    let lastFrame: number | null = null;
    let revealAfter = 0;
    let rate = BASE_CHARS_PER_SECOND;
    let budget = 0;
    const tick = (now: number) => {
      if (lastFrame === null) {
        lastFrame = now;
        revealAfter = now + (startedRef.current ? 0 : INITIAL_BUFFER_MS);
      }
      // Carry fractional characters across frames: 120 Hz must not force one
      // character per frame. Keep the same clock across incoming SDK chunks.
      const elapsed = Math.min(Math.max(0, now - Math.max(lastFrame, revealAfter)), 64);
      lastFrame = now;
      const backlog = targetRef.current.length - displayedRef.current.length;
      if (streamingRef.current) {
        const desiredRate = Math.max(BASE_CHARS_PER_SECOND, backlog / CATCH_UP_SECONDS);
        rate += (desiredRate - rate) * (1 - Math.exp(-elapsed / RATE_BLEND_MS));
      }
      budget += rate * elapsed / 1000;
      const next = advanceReveal(targetRef.current, displayedRef.current, budget);
      budget = Math.max(0, budget - (next.length - displayedRef.current.length));
      if (next !== displayedRef.current) {
        startedRef.current = true;
        displayedRef.current = next;
        setDisplayed(next);
      }
      rafRef.current = next === targetRef.current ? null : requestAnimationFrame(tick);
      if (rafRef.current === null && !streamingRef.current) {
        activeRef.current = false;
        setActive(false);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [enabled, reducedMotion, target]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  if (reducedMotion || (!enabled && !active)) return target;
  // A replaced report must show its own content immediately, before the
  // effect synchronizes the reveal refs with this render's target.
  return target.startsWith(displayed) ? displayed : target;
}
