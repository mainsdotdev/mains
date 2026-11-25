import type { CreatePulseInput } from "./pulse.dto";

type Schedule = Pick<CreatePulseInput, "frequency" | "hour" | "minute" | "dayOfWeek" | "timezone">;

/** Resolve wall-clock candidates in the routine's IANA zone, independently of the backend's zone. */
export function computeRoutineNextRunAt(spec: Schedule, from: Date): Date {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: spec.timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const wall = (at: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(at).filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  };
  const today = new Date(wall(from.getTime()));
  const dayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  // A weekly wall time can disappear during DST; allow the following week too.
  for (let day = 0; day < 15; day++) {
    const date = new Date(dayStart + day * 86_400_000);
    const weekday = date.getUTCDay();
    if (spec.frequency === "weekdays" && (weekday === 0 || weekday === 6)) continue;
    if (spec.frequency === "weekly" && weekday !== (spec.dayOfWeek ?? 1)) continue;
    const hours = spec.frequency === "hourly" ? Array.from({ length: 24 }, (_, hour) => hour) : [spec.hour];
    const candidates: number[] = [];
    for (const hour of hours) {
      const target = date.getTime() + hour * 3_600_000 + spec.minute * 60_000;
      const offsets = new Set([-36, 0, 36].map(delta => {
        const sample = target + delta * 3_600_000;
        return wall(sample) - sample;
      }));
      const matches = [...offsets].map(offset => target - offset).filter(at => wall(at) === target).sort((a, b) => a - b);
      // Daily/weekly schedules fire once on a fall-back date; nonexistent spring-forward times skip that date.
      candidates.push(...(spec.frequency === "hourly" ? matches : matches.slice(0, 1)));
    }
    const next = candidates.filter(at => at > from.getTime()).sort((a, b) => a - b)[0];
    if (next !== undefined) return new Date(next);
  }
  throw new Error("Could not determine this routine's next scheduled time");
}
