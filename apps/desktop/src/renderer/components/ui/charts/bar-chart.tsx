import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import Text from "../text";

interface BarSegment {
  percent: number;
  color: string;
}

interface Bar {
  key: string | number;
  segments: BarSegment[];
  title?: string;
  hoverLabel?: ReactNode;
  topLabel?: ReactNode;
}

interface BarChartProps {
  bars: Bar[];
  height: number;
  gap?: string;
  className?: string;
}

export default function BarChart({
  bars,
  height,
  gap = "gap-0.5",
  className,
}: BarChartProps) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; content: ReactNode } | null>(null);
  const [animated, setAnimated] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          requestAnimationFrame(() => setAnimated(true));
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn("flex items-end", gap, className)}
      style={{ height }}
    >
      {bars.map((bar, barIdx) => {
        const visibleSegments = bar.segments.filter((s) => s.percent > 0);
        return (
          <div
            key={bar.key}
            className="flex-1 h-full flex flex-col items-center justify-end"
            onMouseMove={(e) => {
              if (!bar.hoverLabel) return;
              setTooltip({ x: e.clientX, y: e.clientY, content: bar.hoverLabel });
            }}
            onMouseLeave={() => setTooltip(null)}
          >
            {bar.topLabel && (
              <div
                className="transition-opacity duration-300"
                style={{
                  opacity: animated ? 1 : 0,
                  transitionDelay: `${barIdx * 12 + 200}ms`,
                }}
              >
                {bar.topLabel}
              </div>
            )}
            {visibleSegments.map((seg, i) => (
              <div
                key={seg.color}
                className="w-full transition-[height] ease-out"
                style={{
                  height: animated ? `${seg.percent}%` : "0%",
                  backgroundColor: seg.color,
                  borderRadius: i === 0 ? "3px 3px 0 0" : undefined,
                  transitionDuration: "500ms",
                  transitionDelay: `${barIdx * 12}ms`,
                }}
              />
            ))}
          </div>
        );
      })}
      {tooltip &&
        createPortal(
          <Text
            as="div"
            size="xs"
            tone="muted"
            className={cn(
              "fixed px-2 py-1 rounded-lg glass-outline pointer-events-none whitespace-nowrap -translate-x-1/2",
              "font-light",
              "bg-primary-100 dark:bg-primary-900",
              "shadow-lg shadow-primary-950/10",
            )}
            style={{ left: tooltip.x, top: tooltip.y - 32, zIndex: 9999 }}
          >
            {tooltip.content}
          </Text>,
          document.body,
        )}
    </div>
  );
}
