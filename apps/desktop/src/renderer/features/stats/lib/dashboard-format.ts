import type { DashboardRange, UsageTotals } from "@mains/contracts/stats";
import { PROVIDER_VARIANTS } from "@/lib/provider-variants";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const smallDollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const dayDate = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const fullDate = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const weekDate = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" });
const monthDate = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", year: "2-digit" });

export function formatTokens(value: number | null, full = false): string {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? (full ? integer : compact).format(value) : "No data";
}

export function formatEstimatedCost(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value)
    ? (Math.abs(value) > 0 && Math.abs(value) < 1 ? smallDollars : dollars).format(value) : "No data";
}

export function usageCoverage(usage: UsageTotals, kind: "tokens" | "cost" = "tokens"): string {
  const reported = kind === "tokens" ? usage.tokenReportedTurns : usage.costReportedTurns;
  if (usage.completedTurns === 0) return "No completed turns";
  if (reported === 0) {
    const value = kind === "tokens" ? usage.totalTokens : usage.estimatedCostUsd;
    return value === null ? "Not reported by the provider" : "Partial usage reported";
  }
  return `${reported} of ${usage.completedTurns} completed turns reported`;
}

export function providerDescriptor(providerId: string) {
  return Object.values(PROVIDER_VARIANTS).find((provider) => provider.providerId === providerId);
}

export function providerColor(providerId: string): string {
  const provider = providerDescriptor(providerId);
  // Monochrome brand colors do not make readable chart series in both themes.
  const colors = { claude: "var(--color-claude)", codex: "var(--viz-cat-1)",
    copilot: "var(--viz-cat-5)", cursor: "var(--viz-cat-3)" };
  return provider ? colors[provider.variant] : "var(--color-primary-500)";
}

export function calendarDate(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

export function getClientTimeZone(): string {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof timeZone !== "string" || !timeZone) return "UTC";
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

export function formatBucketDate(date: string, range: DashboardRange, full = false): string {
  const value = calendarDate(date);
  if (!value) return "Date unavailable";
  return (range.granularity === "month" ? monthDate : full ? fullDate
    : range.period === "week" ? weekDate : dayDate).format(value);
}

export function showBucketLabel(index: number, count: number): boolean {
  return count <= 7 || index === 0 || index === count - 1 || index % Math.ceil(count / 6) === 0;
}

export function formatRange(range: DashboardRange): string {
  const startDate = calendarDate(range.startDate), endDate = calendarDate(range.endDate);
  if (!startDate || !endDate || startDate > endDate) return "Date unavailable";
  const start = dayDate.format(startDate);
  const end = dayDate.format(endDate);
  const startYear = range.startDate.slice(0, 4), endYear = range.endDate.slice(0, 4);
  return `${start}${startYear === endYear ? "" : `, ${startYear}`} – ${end}, ${endYear}`;
}
