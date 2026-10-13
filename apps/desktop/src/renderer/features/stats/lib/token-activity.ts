import type { TokenUsageBucket } from "@mains/contracts/stats";
import { calendarDate } from "./dashboard-format";

export function calendarCells(days: TokenUsageBucket[]) {
  if (!days.length) return [];
  const start = calendarDate(days[0].date);
  if (!start) return [];
  const weekday = (start.getUTCDay() + 6) % 7;
  const cells: (TokenUsageBucket | null)[] = Array.from({ length: weekday }, () => null);
  for (const day of days) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function tokenIntensity(day: TokenUsageBucket, maximum: number): number | null {
  if (day.completedTurns === 0) return 0;
  if (day.totalTokens === null || !Number.isFinite(day.totalTokens) || day.totalTokens < 0) return null;
  if (day.totalTokens === 0) return 0;
  const scale = Number.isFinite(maximum) && maximum > 0 ? maximum : Math.max(1, day.totalTokens);
  return Math.min(4, Math.max(1, Math.ceil(Math.sqrt(day.totalTokens / scale) * 4)));
}
