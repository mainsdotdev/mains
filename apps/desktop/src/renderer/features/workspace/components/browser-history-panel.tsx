import { useMemo, useState } from "react";
import { Button, Input, Text } from "@/components/ui";
import {
  ChevronLeft,
  Clock,
  Close,
  External,
  Search,
  Web,
} from "@/components/ui/icons";
import { proxiedImageSrc } from "@/lib/proxied-image-src";

export interface BrowserHistoryEntryViewModel {
  id: string;
  url: string;
  title: string;
  faviconUrl: string | null;
  visitedAt: string;
  visitCount: number;
}

interface BrowserHistoryPanelProps {
  entries: BrowserHistoryEntryViewModel[];
  onBack: () => void;
  onClear: () => void;
  onOpen: (url: string) => void;
  onOpenNewTab: (url: string) => void;
  onRemove: (historyEntryId: string) => void;
}

interface HistoryGroup {
  key: string;
  label: string;
  entries: BrowserHistoryEntryViewModel[];
}

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dateGroupLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const key = localDayKey(date);
  if (key === localDayKey(today)) return "Today";
  if (key === localDayKey(yesterday)) return "Yesterday";
  return dateFormatter.format(date);
}

function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "") || url;
  } catch {
    return url;
  }
}

function groupEntries(entries: BrowserHistoryEntryViewModel[]): HistoryGroup[] {
  const groups = new Map<string, HistoryGroup>();
  for (const entry of entries) {
    const date = new Date(entry.visitedAt);
    const key = localDayKey(date);
    const group = groups.get(key);
    if (group) {
      group.entries.push(entry);
    } else {
      groups.set(key, {
        key,
        label: dateGroupLabel(date),
        entries: [entry],
      });
    }
  }
  return Array.from(groups.values());
}

function HistoryFavicon({
  faviconUrl,
}: Pick<BrowserHistoryEntryViewModel, "faviconUrl">) {
  const src = proxiedImageSrc(faviconUrl);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (src && failedSrc !== src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        draggable={false}
        onError={() => setFailedSrc(src)}
        className="size-4 rounded-[3px] object-contain"
      />
    );
  }

  return (
    <Web
      aria-hidden="true"
      className="size-4 text-primary-400 dark:text-primary-500"
    />
  );
}

export function BrowserHistoryPanel({
  entries,
  onBack,
  onClear,
  onOpen,
  onOpenNewTab,
  onRemove,
}: BrowserHistoryPanelProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredEntries = useMemo(
    () =>
      normalizedQuery
        ? entries.filter((entry) =>
            `${entry.title}\n${entry.url}`
              .toLocaleLowerCase()
              .includes(normalizedQuery),
          )
        : entries,
    [entries, normalizedQuery],
  );
  const groups = useMemo(
    () => groupEntries(filteredEntries),
    [filteredEntries],
  );

  return (
    <div className="w-90" role="none">
      <div className="flex h-10 items-center gap-2 border-b border-primary-200/70 px-2 dark:border-primary-800/70">
        <Button
          autoFocus
          role="menuitem"
          tabIndex={-1}
          onClick={onBack}
          aria-label="Back to browser menu"
          className="rounded-lg text-primary-600 hover:text-primary-900 dark:text-primary-300 dark:hover:text-primary-100"
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <Text as="span" size="xs" weight="medium" className="min-w-0 flex-1">
          History
        </Text>
        {entries.length > 0 && (
          <Button
            role="menuitem"
            tabIndex={-1}
            onClick={onClear}
            className="rounded-lg px-2 py-1 text-xxs text-primary-600 hover:bg-primary-200/60 hover:text-primary-900 dark:text-primary-400 dark:hover:bg-primary-800/70 dark:hover:text-primary-100"
          >
            Clear
          </Button>
        )}
      </div>

      {entries.length > 0 && (
        <div className="border-b border-primary-200/70 p-2 dark:border-primary-800/70">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-primary-500"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "ArrowUp" ||
                  event.key === "ArrowDown" ||
                  event.key === "Home" ||
                  event.key === "End"
                ) {
                  event.stopPropagation();
                }
              }}
              placeholder="Search history"
              aria-label="Search history"
              className="h-8 rounded-lg py-1 pl-8 pr-2 text-xs"
            />
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="flex min-h-36 flex-col items-center justify-center gap-2 px-8 text-center">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary-200/60 text-primary-500 dark:bg-primary-800/50 dark:text-primary-400">
            <Clock className="size-4" />
          </div>
          <div>
            <Text as="div" size="xs" tone="secondary">
              No history yet
            </Text>
            <Text as="div" size="xxs" tone="subtle" className="mt-0.5">
              Pages visited in browser tabs appear here.
            </Text>
          </div>
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="flex min-h-28 items-center justify-center px-8 text-center">
          <Text as="div" size="xs" tone="subtle">
            No matching history
          </Text>
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto pb-1" role="none">
          {groups.map((group) => (
            <div key={group.key} role="none">
              <Text
                as="div"
                size="xxs"
                tone="subtle"
                className="sticky top-0 z-10 bg-primary-50/95 px-3 pb-1 pt-2 backdrop-blur-sm dark:bg-primary-950/95"
              >
                {group.label}
              </Text>
              {group.entries.map((entry) => (
                <div
                  key={entry.id}
                  className="group/history flex items-center gap-1 px-1.5 py-0.5 transition-colors hover:bg-primary-200/35 dark:hover:bg-primary/5"
                  role="none"
                >
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    onClick={() => onOpen(entry.url)}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg p-1.5 text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                    title={entry.url}
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center">
                      <HistoryFavicon faviconUrl={entry.faviconUrl} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <Text
                        as="span"
                        size="xs"
                        weight="medium"
                        className="block truncate text-primary-800 dark:text-primary-200"
                      >
                        {entry.title || entry.url}
                      </Text>
                      <Text
                        as="span"
                        size="xxs"
                        tone="subtle"
                        className="mt-0.5 block truncate tabular-nums"
                      >
                        {displayHost(entry.url)} ·{" "}
                        {timeFormatter.format(new Date(entry.visitedAt))}
                        {entry.visitCount > 1
                          ? ` · ${entry.visitCount} visits`
                          : ""}
                      </Text>
                    </span>
                  </button>

                  <div
                    className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/history:opacity-100 focus-within:opacity-100"
                    role="none"
                  >
                    <Button
                      role="menuitem"
                      tabIndex={-1}
                      tooltip="Open in new tab"
                      tooltipPosition="top-left"
                      onClick={() => onOpenNewTab(entry.url)}
                      aria-label={`Open ${entry.title || entry.url} in new tab`}
                      className="rounded-lg p-1.5 text-primary-500 hover:bg-primary-200/60 hover:text-primary-900 dark:text-primary-400 dark:hover:bg-primary-800/70 dark:hover:text-primary-100"
                    >
                      <External className="size-3.5" />
                    </Button>
                    <Button
                      role="menuitem"
                      tabIndex={-1}
                      tooltip="Remove from history"
                      tooltipPosition="top-left"
                      onClick={() => onRemove(entry.id)}
                      aria-label={`Remove ${entry.title || entry.url} from history`}
                      className="rounded-lg p-1.5 text-primary-500 hover:bg-primary-200/60 hover:text-danger dark:text-primary-400 dark:hover:bg-primary-800/70 dark:hover:text-danger"
                    >
                      <Close className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
