import { useState } from "react";
import { Button, Checkbox, Select, Text } from "@/components/ui";
import type { SelectOption } from "@/components/ui";
import { ChevronLeft, Trash } from "@/components/ui/icons";

export type BrowserClearDataTimeRangeViewModel =
  | "last-hour"
  | "last-day"
  | "last-week"
  | "last-four-weeks"
  | "all-time";

export interface BrowserClearDataOptionsViewModel {
  timeRange: BrowserClearDataTimeRangeViewModel;
  history: boolean;
  cookiesAndSiteData: boolean;
  cache: boolean;
  downloads: boolean;
}

interface BrowserClearDataPanelProps {
  onBack: () => void;
  onClear: (options: BrowserClearDataOptionsViewModel) => Promise<boolean>;
}

type ClearDataBooleanKey = Exclude<
  keyof BrowserClearDataOptionsViewModel,
  "timeRange"
>;

const DATA_TYPES: Array<{
  key: ClearDataBooleanKey;
  label: string;
  description: string;
}> = [
  {
    key: "history",
    label: "Browsing history",
    description: "Visited pages from the selected time range",
  },
  {
    key: "cookiesAndSiteData",
    label: "Cookies and site data",
    description: "Signs you out of most websites",
  },
  {
    key: "cache",
    label: "Cached images and files",
    description: "Sites may load more slowly on the next visit",
  },
  {
    key: "downloads",
    label: "Download history",
    description: "Downloaded files remain on your Mac",
  },
];

const DEFAULT_OPTIONS: BrowserClearDataOptionsViewModel = {
  timeRange: "all-time",
  history: true,
  cookiesAndSiteData: true,
  cache: true,
  downloads: true,
};

const TIME_RANGE_OPTIONS: SelectOption<BrowserClearDataTimeRangeViewModel>[] = [
  { value: "last-hour", label: "Last hour" },
  { value: "last-day", label: "Last 24 hours" },
  { value: "last-week", label: "Last 7 days" },
  { value: "last-four-weeks", label: "Last 4 weeks" },
  { value: "all-time", label: "All time" },
];

export function BrowserClearDataPanel({
  onBack,
  onClear,
}: BrowserClearDataPanelProps) {
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [clearing, setClearing] = useState(false);
  const hasSelection = DATA_TYPES.some(({ key }) => options[key]);
  const clearsAllSessionData =
    options.timeRange !== "all-time" &&
    (options.cookiesAndSiteData || options.cache);

  const clear = async () => {
    if (!hasSelection || clearing) return;
    setClearing(true);
    const didClear = await onClear(options);
    if (!didClear) setClearing(false);
  };

  return (
    <div className="w-90" role="none">
      <div className="flex h-10 items-center gap-2 border-b border-primary-200/70 px-2 dark:border-primary-800/70">
        <Button
          autoFocus
          role="menuitem"
          tabIndex={-1}
          onClick={onBack}
          disabled={clearing}
          aria-label="Back to browser menu"
          className="rounded-lg text-primary-600 hover:text-primary-900 dark:text-primary-300 dark:hover:text-primary-100"
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <Text as="span" size="xs" weight="medium" className="min-w-0 flex-1">
          Clear browsing data
        </Text>
      </div>

      <div className="space-y-3 p-3" role="none">
        <div>
          <Text as="span" size="xxs" tone="subtle" className="mb-1.5 block">
            Time range
          </Text>
          <Select
            size="sm"
            value={options.timeRange}
            options={TIME_RANGE_OPTIONS}
            disabled={clearing}
            onChange={(timeRange) =>
              setOptions((current) => ({
                ...current,
                timeRange,
              }))
            }
            aria-label="Browsing data time range"
          />
        </div>

        <div
          className="overflow-hidden rounded-xl glass-outline"
          role="group"
          aria-label="Data to clear"
        >
          {DATA_TYPES.map((item, index) => (
            <label
              key={item.key}
              className={`flex cursor-pointer items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-primary-200/35 dark:hover:bg-primary/5 ${
                index > 0
                  ? "border-t border-primary-200/60 dark:border-primary-800/60"
                  : ""
              }`}
            >
              <Checkbox
                checked={options[item.key]}
                disabled={clearing}
                onChange={(checked) =>
                  setOptions((current) => ({
                    ...current,
                    [item.key]: checked,
                  }))
                }
                aria-label={item.label}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <Text as="span" size="xs" className="block">
                  {item.label}
                </Text>
                <Text as="span" size="xxs" tone="subtle" className="mt-0.5 block">
                  {item.description}
                </Text>
              </span>
            </label>
          ))}
        </div>

        {clearsAllSessionData && (
          <Text
            as="div"
            size="xxs"
            tone="subtle"
            className="rounded-lg bg-primary-200/35 px-2.5 py-2 dark:bg-primary-800/35"
          >
            Cookies, site data, and cache are cleared for all time. The selected
            range applies to history and downloads.
          </Text>
        )}

        <Text as="div" size="xxs" tone="subtle">
          Saved passwords and downloaded files are not removed.
        </Text>

        <div className="flex justify-end gap-2 border-t border-primary-200/60 pt-3 dark:border-primary-800/60">
          <Button
            role="menuitem"
            tabIndex={-1}
            variant="secondary"
            onClick={onBack}
            disabled={clearing}
            className="text-xs"
          >
            Cancel
          </Button>
          <Button
            role="menuitem"
            tabIndex={-1}
            variant="danger"
            onClick={() => void clear()}
            disabled={!hasSelection}
            isLoading={clearing}
            className="inline-flex items-center gap-1.5 text-xs"
          >
            <Trash className="size-3.5 shrink-0" />
            <span>Clear data</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
