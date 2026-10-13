import { useState } from "react";
import { Button, TabStrip } from "@/components/ui";
import { Plus, Web } from "@/components/ui/icons";
import { PreviewPanelControls } from "@/components/layout/preview-panel-controls";
import { ShellHeader } from "@/components/layout/shell-header";
import { useShellHeaderChrome } from "@/hooks/use-shell-header-chrome";
import { proxiedImageSrc } from "@/lib/proxied-image-src";
import { useMainHeader } from "@/hooks/use-main-header";
import { BaseTab } from "./base-tab";

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
  isExpanded: boolean;
  sidebarCollapsed?: boolean;
  onToggleExpanded?: () => void;
  reserveLayoutControls?: boolean;
  newTabShortcutLabel?: string;
  closeTabShortcutLabel?: string;
  inMainHeader?: boolean;
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
  isExpanded,
  sidebarCollapsed,
  onToggleExpanded,
  reserveLayoutControls,
  newTabShortcutLabel,
  closeTabShortcutLabel,
  inMainHeader,
}: BrowserTabStripProps) {
  const { header } = useMainHeader();
  const { previewInsetLeft } = useShellHeaderChrome(sidebarCollapsed);
  const reserveTrafficLights = isExpanded && !inMainHeader && !!previewInsetLeft;
  const firstTabFlush = !reserveTrafficLights &&
    (!inMainHeader || (!header && !sidebarCollapsed)) &&
    tabs[0]?.tabId === activeTabId;

  return (
    <ShellHeader
      data-browser-flush-tab-active={firstTabFlush ? "true" : undefined}
      paddingLeft={reserveTrafficLights ? previewInsetLeft : undefined}
      reserveWindowControls={reserveLayoutControls && !inMainHeader}
      actions={<PreviewPanelControls label="browser" isExpanded={isExpanded}
        onToggleExpanded={onToggleExpanded} onClose={reserveLayoutControls ? undefined : onClosePanel} />}
    >
      <TabStrip
        activeKey={activeTabId}
        role="tablist"
        aria-label="Browser tabs"
        createAction={<Button variant="icon" onClick={onCreate} tooltip="New tab" tooltipShortcut={newTabShortcutLabel}
          tooltipPosition="bottom-left" aria-label="New browser tab"><Plus className="size-4" /></Button>}
      >
        {tabs.map((tab, index) => {
          const active = tab.tabId === activeTabId;
          const title = tab.title || "New tab";
          return (
            <BaseTab
              key={tab.tabId}
              isActive={active}
              isFirst={index === 0 && (!inMainHeader || !header)}
              showLeadingCorner={inMainHeader ? undefined : index > 0 || !!reserveTrafficLights}
              role="tab"
              ariaLabel={title}
              onClick={() => onActivate(tab.tabId)}
              icon={<BrowserTabIcon faviconUrl={tab.faviconUrl} isLoading={tab.isLoading} isCrashed={tab.isCrashed} />}
              label={title}
              tooltip={title}
              closeLabel={`Close ${title}`}
              closeShortcut={closeTabShortcutLabel}
              onClose={(event) => {
                event.stopPropagation();
                onClose(tab.tabId);
              }}
            />
          );
        })}
      </TabStrip>
    </ShellHeader>
  );
}
