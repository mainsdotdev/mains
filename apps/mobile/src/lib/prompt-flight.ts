/**
 * Project a bubble measured during a scroll animation onto its final resting
 * coordinate. As the native offset advances, the measured Y moves by the same
 * amount in the opposite direction, so both snapshots resolve to one target.
 */
export function projectedPromptLandingY({
  measuredWindowY,
  rootWindowY,
  currentScrollOffset,
  finalScrollOffset,
  reservedTop,
}: {
  measuredWindowY: number;
  rootWindowY: number;
  currentScrollOffset: number | null;
  finalScrollOffset: number;
  reservedTop: number;
}): number {
  const remainingScroll =
    currentScrollOffset === null ? 0 : finalScrollOffset - currentScrollOffset;
  return Math.max(measuredWindowY - rootWindowY - remainingScroll, reservedTop);
}
