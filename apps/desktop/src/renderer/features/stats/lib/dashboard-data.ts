import type { DashboardConsumptionData, DashboardData, DashboardRange } from "@mains/contracts/stats";
import { calendarDate } from "./dashboard-format";

type DashboardViewData = Pick<DashboardData, "range" | "summary" | "tokenActivity" | "toolUsage" | "hourDistribution" | "statusBreakdown">;
const USAGE_METRICS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens", "estimatedCostUsd", "durationMs"];
const CONSUMPTION_METRICS = ["inputTokens", "uncachedInputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens", "estimatedCostUsd", "cacheSavingsUsd"];

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): value is string { return typeof value === "string"; }
function count(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function counts(value: Record<string, unknown>, keys: string[]) { return keys.every((key) => count(value[key])); }
function metric(value: unknown, signed = false) {
  return value === null || typeof value === "number" && Number.isFinite(value) && (signed || value >= 0);
}
function array(value: unknown, check: (item: unknown) => boolean) {
  if (!Array.isArray(value)) return false;
  // Unlike every(), iteration also checks holes in arrays arriving over IPC.
  for (const item of value) if (!check(item)) return false;
  return true;
}

function validRange(value: unknown): value is DashboardRange {
  if (!object(value) || !text(value.startDate) || !text(value.endDate) || !text(value.timeZone)
    || !calendarDate(value.startDate) || !calendarDate(value.endDate) || value.startDate > value.endDate
    || !text(value.period) || !["week", "month", "year"].includes(value.period)
    || value.granularity !== (value.period === "year" ? "month" : "day")) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value.timeZone }); }
  catch { return false; }
  const days = (calendarDate(value.endDate)!.getTime() - calendarDate(value.startDate)!.getTime()) / 86_400_000 + 1;
  return days <= (value.period === "week" ? 7 : value.period === "month" ? 30 : 366);
}

function datedRows(value: unknown, range: DashboardRange, check: (item: Record<string, unknown>) => boolean) {
  let previous = "";
  return array(value, (item) => {
    if (!object(item) || !text(item.date) || !calendarDate(item.date) || item.date <= previous
      || item.date < range.startDate || item.date > range.endDate || !check(item)) return false;
    previous = item.date;
    return true;
  });
}

function usage(value: unknown): value is Record<string, unknown> {
  return object(value) && USAGE_METRICS.every((key) => metric(value[key]))
    && counts(value, ["completedTurns", "tokenReportedTurns", "costReportedTurns"]);
}

/** Validate only this screen's projection. Missing or malformed measurements
 * are never filled with zero, and fields used by other clients stay untouched. */
export function isDashboardViewData(value: unknown): value is DashboardViewData {
  if (!object(value) || !validRange(value.range) || !usage(value.summary)
    || !counts(value.summary, ["totalSessions", "totalTurns"]) || !object(value.statusBreakdown)) return false;
  const hours = new Set<number>();
  const tools = new Set<string>();
  return datedRows(value.tokenActivity, value.range, usage)
    && array(value.toolUsage, (item) => {
      if (!object(item) || !text(item.toolName) || !count(item.count) || tools.has(item.toolName)) return false;
      tools.add(item.toolName);
      return true;
    })
    && array(value.hourDistribution, (item) => {
      if (!object(item) || !count(item.hour) || item.hour > 23 || !count(item.count) || hours.has(item.hour)) return false;
      hours.add(item.hour);
      return true;
    })
    && counts(value.statusBreakdown, ["totalSucceeded", "totalFailed", "totalCanceled", "totalOther"])
    && datedRows(value.statusBreakdown.days, value.range, (item) => counts(item, ["succeeded", "failed", "canceled", "other"]));
}

function consumptionTotals(value: unknown): value is Record<string, unknown> {
  return object(value) && CONSUMPTION_METRICS.every((key) => metric(value[key], key === "cacheSavingsUsd"))
    && counts(value, ["records", "sessions", "tokenReportedRecords", "costEstimatedRecords", "cacheSavingsEstimatedRecords", "providerReportedCostRecords"])
    && object(value.reportedMetrics) && counts(value.reportedMetrics, CONSUMPTION_METRICS);
}
function consumptionRow(value: unknown) {
  return consumptionTotals(value) && text(value.providerId) && (value.model === null || text(value.model));
}
function report(value: unknown, range: DashboardRange) {
  return object(value) && consumptionTotals(value.totals) && array(value.providers, consumptionRow)
    && array(value.models, consumptionRow)
    && datedRows(value.buckets, range, (item) => consumptionTotals(item) && array(item.providers, consumptionRow));
}

export function isDashboardConsumptionData(value: unknown): value is DashboardConsumptionData {
  if (!object(value) || !validRange(value.range) || !text(value.scannedAt) || !object(value.pricing)) return false;
  return report(value.cli, value.range) && report(value.mains, value.range)
    && array(value.sources, (source) => object(source)
      && (source.providerId === "claude_code" || source.providerId === "codex")
      && text(source.status) && ["available", "missing", "partial", "error"].includes(source.status)
      && array(source.directories, text) && counts(source, ["scannedFiles", "unreadableFiles", "skippedLines"]))
    && text(value.pricing.status) && ["fresh", "cached", "unavailable"].includes(value.pricing.status)
    && text(value.pricing.source) && (value.pricing.fetchedAt === null || text(value.pricing.fetchedAt));
}
