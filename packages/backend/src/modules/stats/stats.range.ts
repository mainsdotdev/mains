import { isProviderId } from "@mains/contracts/provider-ids";
import type { DashboardQuery, DashboardRange, ProviderFilter } from "./stats.dto";

export function resolveDashboardRange(query: DashboardQuery | ProviderFilter = {}, now = new Date()) {
  const options = typeof query === "string" ? { provider: query } : query;
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("Invalid dashboard query.");
  const provider = options.provider ?? "all";
  if (provider !== "all" && !isProviderId(provider)) throw new Error("Invalid dashboard provider.");
  const period = options.period ?? "month";
  if (period !== "week" && period !== "month" && period !== "year") throw new Error("Invalid dashboard period.");
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  let formatter: Intl.DateTimeFormat;
  try {
    if (typeof timeZone !== "string" || !timeZone || timeZone.length > 100) throw new Error();
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
    });
  } catch {
    throw new Error("Invalid dashboard time zone.");
  }
  const localTime = (timestamp: number) => {
    const parts = formatter.formatToParts(new Date(timestamp * 1000));
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
    return { date: `${part("year")}-${part("month")}-${part("day")}`, hour: Number(part("hour")) };
  };
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const endDate = localTime(nowSeconds).date;
  // UTC represents local calendar labels only; local days can be shorter or
  // longer than 24 hours across DST changes.
  const start = new Date(`${endDate}T00:00:00Z`);
  if (period === "year") {
    start.setUTCDate(1);
    start.setUTCMonth(start.getUTCMonth() - 11);
  } else {
    start.setUTCDate(start.getUTCDate() - (period === "week" ? 6 : 29));
  }
  const startDate = start.toISOString().slice(0, 10);
  const dates: string[] = [];
  const dailyDates: string[] = [];
  const cursor = new Date(start);
  while (cursor.toISOString().slice(0, 10) <= endDate) {
    const date = cursor.toISOString().slice(0, 10);
    dailyDates.push(date);
    if (period !== "year" || cursor.getUTCDate() === 1) dates.push(date);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const range: DashboardRange = {
    period, timeZone, startDate, endDate, granularity: period === "year" ? "month" : "day",
  };
  const fromSeconds = start.getTime() / 1000 - 24 * 60 * 60;
  const dateInRange = (timestamp: number): string | null => {
    if (!Number.isFinite(timestamp) || timestamp < fromSeconds || timestamp > nowSeconds) return null;
    const date = localTime(timestamp).date;
    return date >= startDate && date <= endDate ? date : null;
  };
  return {
    range, provider, dates, dailyDates, localTime, dateInRange,
    bucketDate: (date: string) => period === "year" ? `${date.slice(0, 7)}-01` : date,
    // Bound the DB read generously, then filter exact client-local dates. This
    // covers every IANA UTC offset without SQLite's host-local date functions.
    fromSeconds,
    toSeconds: nowSeconds,
    includes: (timestamp: number) => dateInRange(timestamp) !== null,
  };
}

export type ResolvedDashboardRange = ReturnType<typeof resolveDashboardRange>;
