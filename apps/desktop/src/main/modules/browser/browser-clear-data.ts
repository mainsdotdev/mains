import type {
  BrowserClearDataTimeRange,
  BrowserDownload,
  BrowserHistoryEntry,
} from "./browser.dto";

const RANGE_MILLISECONDS: Exclude<
  Record<BrowserClearDataTimeRange, number | null>,
  undefined
> = {
  "last-hour": 60 * 60 * 1_000,
  "last-day": 24 * 60 * 60 * 1_000,
  "last-week": 7 * 24 * 60 * 60 * 1_000,
  "last-four-weeks": 28 * 24 * 60 * 60 * 1_000,
  "all-time": null,
};

export function browserClearDataCutoff(
  timeRange: BrowserClearDataTimeRange,
  now = Date.now(),
): number | null {
  const duration = RANGE_MILLISECONDS[timeRange];
  return duration === null ? null : now - duration;
}

function isInClearRange(timestamp: string, cutoff: number | null): boolean {
  if (cutoff === null) return true;
  const value = Date.parse(timestamp);
  return Number.isFinite(value) && value >= cutoff;
}

export function historyAfterBrowsingDataClear(
  entries: BrowserHistoryEntry[],
  timeRange: BrowserClearDataTimeRange,
  now = Date.now(),
): BrowserHistoryEntry[] {
  const cutoff = browserClearDataCutoff(timeRange, now);
  return entries.filter((entry) => !isInClearRange(entry.visitedAt, cutoff));
}

export function downloadsAfterBrowsingDataClear(
  downloads: BrowserDownload[],
  activeDownloadIds: ReadonlySet<string>,
  timeRange: BrowserClearDataTimeRange,
  now = Date.now(),
): BrowserDownload[] {
  const cutoff = browserClearDataCutoff(timeRange, now);
  return downloads.filter(
    (download) =>
      activeDownloadIds.has(download.id) ||
      !isInClearRange(download.startedAt, cutoff),
  );
}
