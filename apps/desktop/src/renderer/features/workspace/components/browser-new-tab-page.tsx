import { useMemo } from "react";
import { Text } from "@/components/ui";
import { BrowserFavicon } from "./browser-favicon";
import type { BrowserHistoryEntryViewModel } from "./browser-history-panel";

const RECENT_SITE_LIMIT = 12;

interface BrowserNewTabPageProps {
  entries: BrowserHistoryEntryViewModel[];
  onNavigate: (url: string) => void;
}

interface RecentSite {
  host: string;
  url: string;
  faviconUrl: string | null;
}

export function BrowserNewTabPage({
  entries,
  onNavigate,
}: BrowserNewTabPageProps) {
  const recentSites = useMemo(() => {
    const seenHosts = new Set<string>();
    const recent: RecentSite[] = [];
    // History arrives newest first. Each site gets one shortcut to its root;
    // www shares a card with the bare host, while development ports stay distinct.
    for (const entry of entries) {
      let url: URL;
      try {
        url = new URL(entry.url);
      } catch {
        continue;
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      const host = url.host.replace(/^www\./i, "");
      if (seenHosts.has(host)) continue;
      seenHosts.add(host);
      recent.push({ host, url: `${url.origin}/`, faviconUrl: entry.faviconUrl });
      if (recent.length === RECENT_SITE_LIMIT) break;
    }
    return recent;
  }, [entries]);

  if (recentSites.length === 0) {
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
    <div className="pointer-events-auto absolute inset-0 overflow-y-auto overscroll-none px-6 py-8">
      <section aria-label="Recent sites" className="mx-auto max-w-2xl">
        <Text as="h2" size="lg" weight="semibold" className="mb-5 px-2">
          Recent sites
        </Text>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-x-3 gap-y-4">
          {recentSites.map((site) => (
            <button
              key={site.host}
              type="button"
              onClick={() => onNavigate(site.url)}
              title={site.url}
              className="group flex min-w-0 cursor-pointer flex-col items-center gap-2.5 rounded-xl px-1 py-2 outline-none transition-colors hover:bg-primary-100/70 focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-primary-900/60"
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl glass-outline glass-outline-soft bg-primary-100  transition-colors group-hover:bg-primary-200/70  dark:bg-primary-900 dark:group-hover:bg-primary-800/70">
                <BrowserFavicon faviconUrl={site.faviconUrl} className="size-8" />
              </span>
              <Text
                as="span"
                size="xs"
                weight="medium"
                tone="secondary"
                className="line-clamp-2 w-full wrap-anywhere text-center"
              >
                {site.host}
              </Text>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
