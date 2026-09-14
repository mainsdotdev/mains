import { useState, useEffect, useCallback, useRef } from "react";
import NumberFlow from "@number-flow/react";
import { cn } from "../../lib/cn";
import Text from "./text";

interface SliderBaseProps {
  id?: string;
  value: number;
  onChange: (value: number) => void;
  /**
   * Called when the drag ends, with the value it ended on. For settings whose
   * effect moves the slider itself — the interface font size rescales the whole
   * page, this control included — apply on commit and let `onChange` only drive
   * the preview, so the drag target stays under the cursor.
   */
  onCommit?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  minLabel?: string;
  maxLabel?: string;
  showValue?: boolean;
  formatValue?: (value: number) => string;
  disabled?: boolean;
}

export type SliderProps = SliderBaseProps &
  (
    | { label: string; "aria-label"?: string }
    | { label?: undefined; "aria-label": string }
  );

export function Slider({
  id,
  value,
  onChange,
  onCommit,
  min = 0,
  max = 100,
  step = 1,
  label,
  minLabel,
  maxLabel,
  showValue = true,
  formatValue,
  disabled = false,
  "aria-label": ariaLabel,
}: SliderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // The commit fires from a window listener installed once per drag, so it
  // closes over the render that started the drag. Both the value it reports and
  // the handler it calls are read from refs refreshed after every render —
  // otherwise a caller whose `onCommit` closes over state would commit against
  // a snapshot taken at mousedown.
  const latestValue = useRef(value);
  const latestCommit = useRef(onCommit);
  useEffect(() => {
    latestValue.current = value;
    latestCommit.current = onCommit;
  });

  // Stable, so the drag listeners can be subscribed honestly rather than behind
  // a suppressed dependency check.
  const commit = useCallback(() => {
    latestCommit.current?.(latestValue.current);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(parseFloat(e.target.value));
  };

  const handleMouseDown = () => {
    setIsDragging(true);
  };

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    commit();
  }, [commit]);

  // Keyboard stepping never goes through the drag listeners, so commit here too.
  const handleKeyUp = commit;

  useEffect(() => {
    if (!isDragging) return;
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("touchend", handleMouseUp, { passive: true });
    return () => {
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("touchend", handleMouseUp);
    };
  }, [isDragging, handleMouseUp]);

  const displayValue = formatValue ? formatValue(value) : value;
  const range = max - min;
  const percentage =
    range === 0
      ? 0
      : Math.min(100, Math.max(0, ((value - min) / range) * 100));

  const lineOpacity =
    percentage > 90 ? 0 : percentage > 75 ? (90 - percentage) / 15 : 1;

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className={cn(
          "relative w-full min-w-50 overflow-hidden rounded-[10px] px-3 py-3.5",
          "bg-primary-950/5 dark:bg-primary/5 glass-outline",
          "flex items-center justify-between text-sm text-primary-900 dark:text-primary",
          "has-focus-visible:ring-2 has-focus-visible:ring-primary-500 has-focus-visible:ring-offset-2",
          "shadow-(--shadow-inset-subtle) transition-all dark:shadow-(--shadow-inset-subtle-dark)",
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        )}
      >
        {/* The fill animates during the drag too, not just after it. Coarse
            scales (the font sizes span seven steps) otherwise snap between a
            handful of positions, which reads as stuttering rather than
            tracking; a short duration keeps it attached to the cursor. */}
        <div
          className={`absolute inset-y-0 left-0 rounded-lg bg-primary-950/10 dark:bg-primary/10 transition-[width] ease-out ${isDragging ? "duration-100" : "duration-150"}`}
          style={{ width: `${percentage}%` }}
        >
          {/* Vertical line inside percentage bar */}
          <div
            className="absolute inset-y-0 right-2 h-4 rounded-full top-1.5 w-[1.5px] bg-primary-950/20 dark:bg-primary/50 transition-opacity duration-150"
            style={{ opacity: lineOpacity }}
          />
        </div>

        {showValue && (
          <Text
            as="div"
            size="xs"
            weight="medium"
            className="absolute inset-y-0 right-2 flex items-center tabular-nums"
          >
            {typeof displayValue === "number" ? (
              <NumberFlow
                value={displayValue}
                format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
              />
            ) : (
              displayValue
            )}
          </Text>
        )}

        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={ariaLabel ?? label}
          aria-valuetext={
            typeof displayValue === "string" ? displayValue : undefined
          }
          disabled={disabled}
          onChange={handleChange}
          onMouseDown={handleMouseDown}
          onTouchStart={handleMouseDown}
          onKeyUp={handleKeyUp}
          className="absolute inset-0 size-full cursor-pointer opacity-0 focus:outline-none disabled:cursor-not-allowed"
        />
      </div>
      {(minLabel || maxLabel) && (
        <div className="flex justify-between">
          {minLabel && <Text size="xs">{minLabel}</Text>}
          {maxLabel && <Text size="xs">{maxLabel}</Text>}
        </div>
      )}
    </div>
  );
}
