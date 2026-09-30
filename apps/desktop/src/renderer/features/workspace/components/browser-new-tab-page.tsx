import { useMemo } from "react";
import { Text } from "@/components/ui";
import { BrowserFavicon } from "./browser-favicon";
import type { BrowserHistoryEntryViewModel } from "./browser-history-panel";

const RECENT_TAB_LIMIT = 12;

interface BrowserNewTabPageProps {
  entries: BrowserHistoryEntryViewModel[];
  onNavigate: (url: string) => void;
}

function pageLabel(entry: BrowserHistoryEntryViewModel): string {
  const title = entry.title.trim();
  if (title && title !== entry.url) return title;
  try {
    return new URL(entry.url).host.replace(/^www\./i, "");
  } catch {
    return entry.url;
  }
}

export function BrowserNewTabPage({
  entries,
  onNavigate,
}: BrowserNewTabPageProps) {
  const recentEntries = useMemo(() => {
    const seenUrls = new Set<string>();
    const recent: BrowserHistoryEntryViewModel[] = [];
    // History arrives newest first; retain the latest visit to each page.
    for (const entry of entries) {
      if (seenUrls.has(entry.url)) continue;
      seenUrls.add(entry.url);
      recent.push(entry);
      if (recent.length === RECENT_TAB_LIMIT) break;
    }
    return recent;
  }, [entries]);

  if (recentEntries.length === 0) {
    return (
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-8 text-center">
        <Text as="div" size="sm" tone="secondary">
          A fresh tab, ready when you are.
        </Text>
        <Text as="div" size="xxs" tone="subtle">
          Search the web or enter a local development URL.
        </Text>
      </div>
    );
  }

  return (
    <div className="pointer-events-auto absolute inset-0 overflow-y-auto px-6 py-8">
      <section aria-label="Recent tabs" className="mx-auto max-w-2xl">
        <Text as="h2" size="lg" weight="semibold" className="mb-5 px-2">
          Recent tabs
        </Text>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-x-3 gap-y-4">
          {recentEntries.map((entry) => (
            <button
              key={entry.url}
              type="button"
              onClick={() => onNavigate(entry.url)}
              title={entry.url}
              className="group flex min-w-0 cursor-pointer flex-col items-center gap-2.5 rounded-xl px-1 py-2 outline-none transition-colors hover:bg-primary-100/70 focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-primary-900/60"
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl glass-outline glass-outline-soft bg-primary-100  transition-colors group-hover:bg-primary-200/70  dark:bg-primary-900 dark:group-hover:bg-primary-800/70">
                <BrowserFavicon faviconUrl={entry.faviconUrl} className="size-8" />
              </span>
              <Text
                as="span"
                size="xs"
                weight="medium"
                tone="secondary"
                className="line-clamp-2 w-full wrap-anywhere text-center"
              >
                {pageLabel(entry)}
              </Text>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
