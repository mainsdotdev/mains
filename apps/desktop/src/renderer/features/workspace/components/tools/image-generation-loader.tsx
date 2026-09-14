import { useEffect, useMemo, useState, type CSSProperties } from "react";

const STAGES = [
  { afterMs: 0, label: "Creating image" },
  { afterMs: 8_000, label: "Building the scene" },
  { afterMs: 20_000, label: "Polishing details" },
] as const;

const DOT_COLUMNS = 9;
const DOT_ROWS = 13;

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
    const maxDistance = Math.hypot(centerX, centerY);

    return Array.from({ length: DOT_COLUMNS * DOT_ROWS }, (_, index) => {
      const x = index % DOT_COLUMNS;
      const y = Math.floor(index / DOT_COLUMNS);
      const distance = Math.hypot(x - centerX, y - centerY);
      const intensity = Math.max(0, 1 - distance / maxDistance);
      const size = 2 + intensity * 2.75;
      const opacity = 0.16 + intensity * 0.62;

      return {
        index,
        style: {
          "--image-dot-opacity": opacity,
          "--image-dot-dim-opacity": opacity * 0.3,
          width: `${size}px`,
          height: `${size}px`,
          animationDelay: `-${Math.round(distance * 105 + index * 17)}ms`,
          animationDuration: `${1_650 + Math.round(distance * 95)}ms`,
        } as CSSProperties,
      };
    });
  }, []);

  const stage = getImageGenerationStage(elapsedMs);

  return (
    <div
      className="image-generation-card relative isolate w-full max-w-80 mt-4 aspect-5/6 overflow-hidden rounded-4xl glass-card  bg-primary-50/80 shadow-[0_20px_60px_-40px_rgba(15,15,15,0.28)]  dark:bg-primary-900/70 dark:shadow-black/20"
      role="status"
      aria-live="polite"
      aria-label={`${stage}. Image generation is in progress.`}
    >
      <div className="relative z-10 flex h-full flex-col">
        <div
          key={stage}
          className="image-generation-stage px-6 pt-6 text-sm font-semibold tracking-[-0.01em] text-primary-800 dark:text-primary-200"
        >
          {stage}
        </div>

        <div className="flex flex-1 items-center justify-center pb-5" aria-hidden="true">
          <div
            className="grid place-items-center gap-x-3.5 gap-y-3"
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
      </div>
    </div>
  );
}
