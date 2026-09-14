/**
 * Horizontal gutter for the run content column — the transcript and the
 * composer that sits under it.
 *
 * Both are `max-w-210 mx-auto`, so past 840px the column floats in the middle
 * of whatever width is left and the gutter is free. Below it — the moment the
 * right panel or the browser opens — the column hits the edges, and the two
 * things that hang *outside* it land on top of the conversation:
 *
 * - the turn rail, pinned `left-3` and 32px wide, needs 44px on the left;
 * - the context-usage ring, `left-full ml-3` and 27px wide, needs 39px on the
 *   right.
 *
 * 48px clears both with a little air, and the same value on both sides keeps
 * the transcript and the composer on one vertical line — they are read as one
 * column, so a padding that drifts between them reads as the composer being
 * off-centre.
 *
 * It belongs on a wrapper *around* the `max-w-210` box, never on the box
 * itself: padding inside the cap subtracts from the column instead of framing
 * it, which is how the transcript ends up narrower than the composer.
 *
 * Apply it on its own element, never alongside `content-inset` — that utility
 * also declares `padding-right` and wins, leaving the right side flush against
 * whatever owns the edge. See the note in index.css.
 */
export const CONTENT_COLUMN_GUTTER = "px-12";
