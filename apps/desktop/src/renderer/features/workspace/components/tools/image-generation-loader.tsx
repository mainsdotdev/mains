import { useEffect, useMemo, useState, type CSSProperties } from "react";

const STAGES = [
  { afterMs: 0, label: "Creating image" },
  { afterMs: 8_000, label: "Building the scene" },
  { afterMs: 20_000, label: "Polishing details" },
] as const;

const DOT_COLUMNS = 23;
const DOT_ROWS = 17;
const DOT_CYCLE_MS = 3_600;

export function getImageGenerationStage(elapsedMs: number): string {
  let label: string = STAGES[0].label;
  for (const stage of STAGES) {
    if (elapsedMs < stage.afterMs) break;
    label = stage.label;
  }
  return label;
}

export function ImageGenerationLoader({ startedAt }: { startedAt: Date }) {
  const [elapsedMs, setElapsedMs] = useState(() =>
    Math.max(0, Date.now() - startedAt.getTime()),
  );

  useEffect(() => {
    const updateElapsed = () => {
      setElapsedMs(Math.max(0, Date.now() - startedAt.getTime()));
    };
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(interval);
  }, [startedAt]);

  const dots = useMemo(() => {
    const centerX = (DOT_COLUMNS - 1) / 2;
    const centerY = (DOT_ROWS - 1) / 2;

    return Array.from({ length: DOT_COLUMNS * DOT_ROWS }, (_, index) => {
      const x = index % DOT_COLUMNS;
      const y = Math.floor(index / DOT_COLUMNS);
      const normalizedX = (x - centerX) / centerX;
      const normalizedY = (y - centerY) / centerY;
      const distance = Math.hypot(normalizedX * 0.88, normalizedY);
      const intensity = Math.max(0, 1 - distance);
      const easedIntensity = intensity * intensity * (3 - 2 * intensity);
      const size = 1.75 + easedIntensity * 1.8;
      const opacity = 0.22 + easedIntensity * 0.62;

      // One shared duration keeps the field coherent. Offsetting only the phase
      // produces a continuous diagonal wave instead of dots drifting out of sync.
      const phase =
        x / DOT_COLUMNS * 0.68 +
        y / DOT_ROWS * 0.2 +
        Math.sin(y * 0.72) * 0.055 +
        Math.sin(x * 0.48) * 0.035;

      return {
        index,
        style: {
          "--image-dot-opacity": opacity,
          "--image-dot-dim-opacity": Math.max(0.07, opacity * 0.28),
          "--image-dot-lift": `${1 + easedIntensity * 0.8}px`,
          "--image-dot-peak-scale": 1.15 + easedIntensity * 0.28,
          width: `${size}px`,
          height: `${size}px`,
          animationDelay: `-${Math.round(phase * DOT_CYCLE_MS)}ms`,
          animationDuration: `${DOT_CYCLE_MS}ms`,
        } as CSSProperties,
      };
    });
  }, []);

  const stage = getImageGenerationStage(elapsedMs);

  return (
    <div
      className="w-full max-w-96 mt-4 pb-3"
      role="status"
      aria-live="polite"
      aria-label={`${stage}. Image generation is in progress.`}
    >
      <div
        key={stage}
        className="image-generation-stage  text-sm font-medium tracking-[-0.01em] text-primary-600 dark:text-primary-300"
      >
        {stage}
      </div>

      <div
        className="mt-4 grid w-full place-items-center gap-x-3.5 gap-y-3"
        aria-hidden="true"
        style={{ gridTemplateColumns: `repeat(${DOT_COLUMNS}, minmax(0, 1fr))` }}
      >
        {dots.map((dot) => (
          <span
            key={dot.index}
            className="image-generation-dot block rounded-full bg-primary-500 dark:bg-primary-300"
            style={dot.style}
          />
        ))}
      </div>
    </div>
  );
}
