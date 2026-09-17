import { Button, Text } from "@/components/ui";
import { Close } from "@/components/ui/icons";
import type { BrowserHistoryEntryViewModel } from "./browser-history-panel";
import { BrowserFavicon } from "./browser-favicon";

const DEFAULT_SUGGESTION_LIMIT = 5;

export interface BrowserAddressSuggestion extends BrowserHistoryEntryViewModel {
  displayUrl: string;
}

interface BrowserAddressSuggestionsProps {
  suggestions: BrowserAddressSuggestion[];
  selectedIndex: number;
  onSelect: (suggestion: BrowserAddressSuggestion) => void;
  onHighlight: (index: number) => void;
  onRemove: (historyEntryId: string) => void;
}

function normalizedText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function displayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, "");
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return `${host}${path === "/" ? "" : path}`;
  } catch {
    return url;
  }
}

function matchScore(
  entry: BrowserHistoryEntryViewModel,
  query: string,
): number | null {
  if (!query) return 0;

  const title = normalizedText(entry.title);
  const url = normalizedText(entry.url);
  const visibleUrl = normalizedText(displayUrl(entry.url));
  let host = visibleUrl;
  try {
    host = new URL(entry.url).hostname
      .replace(/^www\./i, "")
      .toLocaleLowerCase();
  } catch {
    // The raw URL remains searchable when the history item is not parseable.
  }

  if (host === query || title === query || visibleUrl === query) return 1_000;
  if (host.startsWith(query)) return 900;
  if (title.startsWith(query)) return 850;
  if (visibleUrl.startsWith(query) || url.startsWith(query)) return 800;
  if (title.split(/\s+/).some((word) => word.startsWith(query))) return 750;
  if (host.includes(query)) return 700;
  if (title.includes(query)) return 650;
  if (visibleUrl.includes(query) || url.includes(query)) return 600;
  return null;
}

export function browserAddressSuggestions(
  entries: BrowserHistoryEntryViewModel[],
  rawQuery: string,
  limit = DEFAULT_SUGGESTION_LIMIT,
): BrowserAddressSuggestion[] {
  const query = normalizedText(rawQuery);
  const seenUrls = new Set<string>();
  const candidates: Array<{
    entry: BrowserHistoryEntryViewModel;
    recencyIndex: number;
    score: number;
  }> = [];

  entries.forEach((entry, recencyIndex) => {
    const key = entry.url.trim().toLocaleLowerCase();
    if (seenUrls.has(key)) return;
    seenUrls.add(key);
    const score = matchScore(entry, query);
    if (score === null) return;
    candidates.push({ entry, recencyIndex, score });
  });

  return candidates
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.entry.visitCount !== left.entry.visitCount) {
        return right.entry.visitCount - left.entry.visitCount;
      }
      const dateDifference =
        Date.parse(right.entry.visitedAt) - Date.parse(left.entry.visitedAt);
      if (Number.isFinite(dateDifference) && dateDifference !== 0) {
        return dateDifference;
      }
      return left.recencyIndex - right.recencyIndex;
    })
    .slice(0, Math.max(0, limit))
    .map(({ entry }) => ({ ...entry, displayUrl: displayUrl(entry.url) }));
}

export function BrowserAddressSuggestions({
  suggestions,
  selectedIndex,
  onSelect,
  onHighlight,
  onRemove,
}: BrowserAddressSuggestionsProps) {
  if (suggestions.length === 0) return null;

  return (
    <div
      id="browser-address-suggestions"
      role="listbox"
      aria-label="Suggestions from browsing history"
      className="mx-2 mb-1 mt-1 max-h-64 shrink-0 overflow-y-auto rounded-2xl p-1 glass-outline bg-primary-50/95 shadow-xl backdrop-blur-xl dark:bg-primary-950/95"
    >
      {suggestions.map((suggestion, index) => {
        const isSelected = index === selectedIndex;
        return (
          <div
            id={`browser-address-suggestion-${index}`}
            key={suggestion.url}
            role="option"
            aria-selected={isSelected}
            onMouseEnter={() => onHighlight(index)}
            className={`group flex min-w-0 items-center rounded-xl transition-colors ${
              isSelected
                ? "bg-primary-200/75 dark:bg-primary-800/75"
                : "hover:bg-primary-100/80 dark:hover:bg-primary-900/80"
            }`}
          >
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(suggestion)}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-left focus:outline-none"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary-100/80 dark:bg-primary-900/80">
                <BrowserFavicon
                  faviconUrl={suggestion.faviconUrl}
                  className="size-4.5"
                />
              </span>
              <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                <Text
                  as="span"
                  size="xs"
                  weight="medium"
                  className="max-w-[45%] shrink-0 truncate"
                >
                  {suggestion.title || suggestion.displayUrl}
                </Text>
                <Text
                  as="span"
                  size="xxs"
                  tone="subtle"
                  className="min-w-0 truncate"
                >
                  {suggestion.displayUrl}
                </Text>
              </span>
            </button>
            <Button
              tabIndex={-1}
              aria-label={`Remove ${suggestion.title || suggestion.displayUrl} from history`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onRemove(suggestion.id)}
              className="mr-1 rounded-lg p-1 text-primary-500 opacity-0 hover:bg-primary-300/50 hover:text-primary-900 group-hover:opacity-100 dark:text-primary-400 dark:hover:bg-primary-700/60 dark:hover:text-primary-100"
            >
              <Close className="size-3.5" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
