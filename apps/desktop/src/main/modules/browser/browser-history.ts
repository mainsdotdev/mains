import type { BrowserHistoryEntry } from "./browser.dto";

export const MAX_BROWSER_HISTORY_ENTRIES = 1_000;

export function isTrackableBrowserHistoryUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function normalizedFavicon(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return isTrackableBrowserHistoryUrl(value) ? value : null;
}

export function normalizedBrowserHistoryEntry(
  value: unknown,
): BrowserHistoryEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<BrowserHistoryEntry>;
  if (
    typeof entry.id !== "string" ||
    !entry.id ||
    typeof entry.url !== "string" ||
    !isTrackableBrowserHistoryUrl(entry.url) ||
    typeof entry.visitedAt !== "string" ||
    !Number.isFinite(Date.parse(entry.visitedAt))
  ) {
    return null;
  }

  const title = typeof entry.title === "string" ? entry.title.trim() : "";
  return {
    id: entry.id,
    url: entry.url,
    title: title || entry.url,
    faviconUrl: normalizedFavicon(entry.faviconUrl),
    visitedAt: new Date(entry.visitedAt).toISOString(),
    visitCount: Math.max(1, Math.floor(Number(entry.visitCount) || 1)),
  };
}

/** Keep newest-first order and merge only immediately repeated visits. */
export function addBrowserHistoryVisit(
  entries: BrowserHistoryEntry[],
  visit: BrowserHistoryEntry,
  limit = MAX_BROWSER_HISTORY_ENTRIES,
): BrowserHistoryEntry[] {
  const newest = entries[0];
  if (newest?.url === visit.url) {
    return [
      {
        ...newest,
        title: visit.title || newest.title,
        faviconUrl: visit.faviconUrl ?? newest.faviconUrl,
        visitedAt: visit.visitedAt,
        visitCount: newest.visitCount + 1,
      },
      ...entries.slice(1),
    ].slice(0, limit);
  }

  return [visit, ...entries].slice(0, limit);
}

export function updateBrowserHistoryMetadata(
  entries: BrowserHistoryEntry[],
  url: string,
  metadata: { title?: string; faviconUrl?: string | null },
): BrowserHistoryEntry[] {
  const index = entries.findIndex((entry) => entry.url === url);
  if (index < 0) return entries;

  const current = entries[index];
  const title = metadata.title?.trim();
  const next = {
    ...current,
    title: title || current.title,
    faviconUrl: normalizedFavicon(metadata.faviconUrl) ?? current.faviconUrl,
  };
  if (next.title === current.title && next.faviconUrl === current.faviconUrl) {
    return entries;
  }

  const updated = [...entries];
  updated[index] = next;
  return updated;
}
