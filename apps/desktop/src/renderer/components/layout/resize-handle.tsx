import { useResizable } from "@/hooks/use-resizable";
import { useIsMobile } from "@/lib/platform";
import { clamp } from "@/lib/layout";

interface ResizeHandleProps {
  /** Which edge of the parent container the handle sits on. */
  edge: "left" | "right";
  /** Current width in px — drives aria + keyboard stepping. */
  value: number;
  min: number;
  max: number;
  /** Map the pointer's clientX to a desired width (px). */
  computeWidth: (clientX: number) => number;
  /** Live, un-persisted update on every drag move. */
  onPreview: (width: number) => void;
  /** Persisted update on release (drag, keyboard, or reset). */
  onCommit: (width: number) => void;
  /** Double-click to restore the default width. */
  onReset?: () => void;
  /** Fires when a pointer drag begins / ends (not on keyboard or reset). */
  onDragStart?: () => void;
  onDragEnd?: () => void;
  ariaLabel: string;
}

const KEY_STEP = 16;
const KEY_STEP_LARGE = 48;

export function ResizeHandle({
  edge,
  value,
  min,
  max,
  computeWidth,
  onPreview,
  onCommit,
  onReset,
  onDragStart,
  onDragEnd,
  ariaLabel,
}: ResizeHandleProps) {
  const isMobile = useIsMobile();
  const handlers = useResizable({
    min,
    max,
    computeWidth,
    onPreview,
    onCommit,
    onStart: onDragStart,
    onEnd: onDragEnd,
  });

  // Drag-to-resize is pointless on touch, and panels are full-width overlays there.
  if (isMobile) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    // Dragging the handle outward grows the container.
    const grow = edge === "right" ? e.key === "ArrowRight" : e.key === "ArrowLeft";
    onCommit(clamp(value + (grow ? step : -step), min, max));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      {...handlers}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className={`group absolute top-0 bottom-0 z-10 w-2 cursor-col-resize touch-none select-none focus:outline-none ${
        edge === "right" ? "right-0" : "left-0"
      }`}
    >
      <div
        className={`absolute inset-y-0 w-px bg-transparent transition-colors duration-150 dark:group-hover:bg-primary/5 group-hover:bg-primary-400/60 dark:group-focus-visible:bg-primary/5 group-focus-visible:bg-primary-400/60 ${
          edge === "right" ? "right-0" : "left-0"
        }`}
      />
    </div>
  );
}
