import { useState } from "react";
import { Button } from "@/components/ui";
import { Close, Plus, Web } from "@/components/ui/icons";
import { proxiedImageSrc } from "@/lib/proxied-image-src";

export interface BrowserTabViewModel {
  tabId: string;
  url: string;
  title: string;
  faviconUrl: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  isCrashed: boolean;
  zoomFactor: number;
  deviceEmulation: BrowserDeviceEmulationViewModel;
}

export type BrowserDevicePresetId =
  | "responsive"
  | "iphone-se"
  | "iphone-14-pro"
  | "iphone-14-pro-max"
  | "pixel-7"
  | "galaxy-s20-ultra"
  | "surface-duo"
  | "ipad-mini"
  | "ipad-air"
  | "nest-hub";

export interface BrowserDeviceEmulationViewModel {
  enabled: boolean;
  presetId: BrowserDevicePresetId;
  width: number;
  height: number;
  deviceScaleFactor: number;
  scale: number;
}

interface BrowserTabStripProps {
  tabs: BrowserTabViewModel[];
  activeTabId: string;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onCreate: () => void;
  onClosePanel: () => void;
}

function BrowserTabIcon({
  faviconUrl,
  isLoading,
  isCrashed,
}: Pick<BrowserTabViewModel, "faviconUrl" | "isLoading" | "isCrashed">) {
  const src = proxiedImageSrc(faviconUrl);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showFavicon = Boolean(src && failedSrc !== src);

  if (showFavicon) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        draggable={false}
        onError={() => setFailedSrc(src ?? null)}
        className={`size-3.5 shrink-0 rounded-[3px] object-contain ${
          isLoading ? "animate-pulse opacity-60" : ""
        }`}
      />
    );
  }

  return (
    <Web
      aria-hidden="true"
      className={`size-3.5 shrink-0 ${
        isCrashed
          ? "text-danger"
          : "text-primary-400 dark:text-primary-500"
      } ${isLoading ? "animate-pulse" : ""}`}
    />
  );
}

export function BrowserTabStrip({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onCreate,
  onClosePanel,
}: BrowserTabStripProps) {
  return (
    <div className="flex min-h-10 items-center border-b border-primary-200/60 px-2 dark:border-primary-800/50">
      <div
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1.5 scrollbar-none [&::-webkit-scrollbar]:hidden"
      >
        <div
          role="tablist"
          aria-label="Browser tabs"
          className="flex shrink-0 items-center gap-1"
        >
          {tabs.map((tab) => {
            const active = tab.tabId === activeTabId;
            return (
              <div
                key={tab.tabId}
                role="tab"
                aria-selected={active}
                className={`group relative flex h-7 min-w-24 max-w-44 shrink-0 items-center overflow-hidden rounded-xl  transition-colors ${
                  active
                    ? "glass-outline bg-primary-50 text-primary-950  dark:bg-primary-900 dark:text-primary-50"
                    : " text-primary-500 hover:bg-primary-100/60 hover:text-primary-800 dark:text-primary-500 dark:hover:bg-primary-900/50 dark:hover:text-primary-200"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onActivate(tab.tabId)}
                  className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 pl-2.5 pr-1 text-left focus:outline-none"
                  aria-label={`Open ${tab.title || "New tab"}`}
                >
                  <BrowserTabIcon
                    faviconUrl={tab.faviconUrl}
                    isLoading={tab.isLoading}
                    isCrashed={tab.isCrashed}
                  />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                    {tab.title || "New tab"}
                  </span>
                </button>
                <Button
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(tab.tabId);
                  }}
                  tooltip="Close tab"
                  tooltipPosition="bottom"
                  aria-label={`Close ${tab.title || "New tab"}`}
                  className={`mr-1 rounded-full p-0.5 transition-opacity hover:bg-primary-200/70 dark:hover:bg-primary/10 ${
                    active
                      ? "opacity-70 hover:opacity-100"
                      : "opacity-0 group-hover:opacity-70"
                  }`}
                >
                  <Close className="size-3" />
                </Button>
              </div>
            );
          })}
        </div>
        <Button
          onClick={onCreate}
          tooltip="New tab"
          tooltipShortcut="⌘T"
          tooltipPosition="bottom-left"
          aria-label="New browser tab"
          className="shrink-0 rounded-md p-1 text-primary-500 hover:bg-primary-200/60 hover:text-primary-900 dark:hover:bg-primary-800/70 dark:hover:text-primary-100"
        >
          <Plus className="size-3.5" />
        </Button>
      </div>
      <Button
        onClick={onClosePanel}
        tooltip="Close browser"
        tooltipPosition="bottom-left"
        aria-label="Close browser"
        className="ml-1 shrink-0 rounded-full p-1 text-primary-500 hover:bg-primary-200/60 hover:text-primary-900 dark:hover:bg-primary-800/70 dark:hover:text-primary-100"
      >
        <Close className="size-3.5" />
      </Button>
    </div>
  );
}
