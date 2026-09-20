import { describe, expect, it } from "vitest";
import type { BrowserDownload, BrowserHistoryEntry } from "./browser.dto";
import {
  browserClearDataCutoff,
  downloadsAfterBrowsingDataClear,
  historyAfterBrowsingDataClear,
} from "./browser-clear-data";

const NOW = Date.parse("2026-09-17T10:00:00.000Z");

function history(id: string, visitedAt: string): BrowserHistoryEntry {
  return {
    id,
    url: `https://${id}.test`,
    title: id,
    faviconUrl: null,
    visitedAt,
    visitCount: 1,
  };
}

function download(id: string, startedAt: string): BrowserDownload {
  return {
    id,
    tabId: null,
    fileName: `${id}.zip`,
    savePath: `/tmp/${id}.zip`,
    sourceUrl: `https://${id}.test/file.zip`,
    mimeType: "application/zip",
    state: "completed",
    receivedBytes: 10,
    totalBytes: 10,
    speedBytesPerSecond: 0,
    startedAt,
    updatedAt: startedAt,
  };
}

describe("browser browsing-data ranges", () => {
  it("turns relative ranges into deterministic cutoffs", () => {
    expect(browserClearDataCutoff("last-hour", NOW)).toBe(
      Date.parse("2026-09-17T09:00:00.000Z"),
    );
    expect(browserClearDataCutoff("all-time", NOW)).toBeNull();
  });

  it("removes only history entries inside the selected range", () => {
    const entries = [
      history("recent", "2026-09-17T09:30:00.000Z"),
      history("old", "2026-09-16T08:00:00.000Z"),
    ];
    expect(historyAfterBrowsingDataClear(entries, "last-hour", NOW)).toEqual([
      entries[1],
    ]);
    expect(historyAfterBrowsingDataClear(entries, "all-time", NOW)).toEqual([]);
  });

  it("preserves active downloads while clearing matching download history", () => {
    const downloads = [
      download("active", "2026-09-17T09:45:00.000Z"),
      download("recent", "2026-09-17T09:30:00.000Z"),
      download("old", "2026-09-16T08:00:00.000Z"),
    ];
    expect(
      downloadsAfterBrowsingDataClear(
        downloads,
        new Set(["active"]),
        "last-hour",
        NOW,
      ).map((item) => item.id),
    ).toEqual(["active", "old"]);
  });
});
