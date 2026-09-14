import { useCallback, useRef } from "react";
import { clamp } from "@/lib/layout";

interface UseResizableOptions {
  min: number;
  max: number;
  /** Map the pointer's clientX to a desired width (px). */
  computeWidth: (clientX: number) => number;
  /** Fires on every pointer move — use for live, un-persisted feedback. */
  onPreview: (width: number) => void;
  /** Fires once on release — use to persist the final width. */
  onCommit: (width: number) => void;
  /** Fires when an actual drag begins (first move, not a bare click). */
  onStart?: () => void;
  /** Fires when a drag ends (release after at least one move). */
  onEnd?: () => void;
}

/**
 * Pointer-driven horizontal resize. Uses pointer capture so the drag keeps
 * tracking outside the handle, and flips `document.body[data-resizing]` so the
 * layout can suspend its width/margin transitions while dragging (see
 * `index.css`). Width is previewed live and only committed on release to keep
 * redux + persistence churn off the hot path.
 */
export function useResizable({
  min,
  max,
  computeWidth,
  onPreview,
  onCommit,
  onStart,
  onEnd,
}: UseResizableOptions) {
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const latestRef = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    movedRef.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    document.body.dataset.resizing = "true";
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      if (!movedRef.current) {
        movedRef.current = true;
        onStart?.();
      }
      const next = clamp(computeWidth(e.clientX), min, max);
      latestRef.current = next;
      onPreview(next);
    },
    [computeWidth, min, max, onPreview, onStart],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      const el = e.currentTarget as HTMLElement;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      delete document.body.dataset.resizing;
      // A bare click (no drag) shouldn't rewrite the width or fire drag hooks.
      if (movedRef.current) {
        onCommit(latestRef.current);
        onEnd?.();
      }
    },
    [onCommit, onEnd],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };
}
