import { cn } from "../../lib/cn";

const TICK_COUNT = 24;

function usageLevelClass(remainingPercent: number): string {
  if (remainingPercent <= 20) return "bg-danger";
  if (remainingPercent <= 50) return "bg-warning";
  return "bg-accent";
}

/** Quota ticks shared by provider allowances and storage. Provider meters show
 * the remainder by default; storage draws consumption. Colour always reflects
 * how close the quota is to being exhausted. */
export function UsageTicks({
  usedPercent,
  label,
  display = "remaining",
  role = "progressbar",
  valueText,
  className,
}: {
  usedPercent: number;
  label: string;
  display?: "remaining" | "used";
  role?: "progressbar" | "meter";
  valueText?: string;
  className?: string;
}) {
  const used = Math.min(100, Math.max(0, usedPercent));
  const remaining = 100 - used;
  const value = display === "used" ? used : remaining;
  const filled = value === 0 ? 0 : Math.max(1, Math.round((value / 100) * TICK_COUNT));
  const levelClass = usageLevelClass(remaining);

  return (
    <div
      role={role}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      aria-valuetext={valueText}
      className={cn("flex items-center gap-1.25", className)}
    >
      {Array.from({ length: TICK_COUNT }, (_, i) => (
        <span
          key={i}
          className={`h-3.5 w-0.75 rounded-full transition-colors duration-300 ${
            i < filled ? levelClass : "bg-primary-300/70 dark:bg-primary-600/50"
          }`}
        />
      ))}
    </div>
  );
}
