import { useState } from "react";
import { ShellHeader } from "@/components/layout/shell-header";
import { ResizeHandle } from "@/components/layout/resize-handle";
import { PreviewPanelControls } from "@/components/layout/preview-panel-controls";
import { TabStrip, toast } from "@/components/ui";
import { Refresh, Plugin } from "@/components/ui/icons";
import { usePreviewPanel } from "@/hooks/use-preview-panel";
import { usePanelAnimation } from "@/hooks/use-panel-animation";
import { usePreviewTabLifecycle } from "@/hooks/use-preview-tab-lifecycle";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setBrowserPanelWidth } from "@/lib/redux/slices/appSettingsSlice";
import { closePreviewTab, syncBrowserPreviewTabs, type PreviewTab } from "@/lib/redux/slices/previewSlice";
import { setLayoutWidthVar } from "@/hooks/use-layout-width-vars";
import { useShellHeaderChrome } from "@/hooks/use-shell-header-chrome";
import { useIsMobile } from "@/lib/platform";
import { useMcpAppInstances } from "@/hooks/use-mcp-app-panel";
import { useKeyboardShortcut } from "@/providers/keyboard-shortcuts-provider";
import { useBrowserPanel } from "@/hooks/use-browser-panel";
import { BROWSER_PANEL_WIDTH_VAR, BROWSER_PANEL_WIDTH_DEFAULT, BROWSER_PANEL_WIDTH_MIN, BROWSER_PANEL_WIDTH_MAX } from "@/lib/layout";
import { browserPreviewTab } from "../lib/preview-tabs";
import { BaseTab } from "./base-tab";
import { BrowserTabIcon } from "./browser-tab-strip";
import { DOC_TYPE_ICONS } from "./document-viewer/doc-type-icons";
import { BrowserPanel } from "./browser-panel";
import { McpAppPanel } from "./mcp-app-panel";
import { McpAppTabIcon } from "./mcp-app-tab-icon";
import { DocumentViewerPanel } from "./document-viewer-panel";
import { PreviewNewTabButton } from "./preview-new-tab-button";

export function PreviewPanel({ reserveLayoutControls = false }: { reserveLayoutControls?: boolean }) {
  const preview = usePreviewPanel();
  const dispatch = useAppDispatch();
  const width = useAppSelector((state) => state.appSettings.browserPanelWidth);
  const sidebarCollapsed = useAppSelector((state) => state.appSettings.sidebarCollapsed);
  const { headerInsetLeft } = useShellHeaderChrome(sidebarCollapsed);
  const { isVisible, isAnimatedIn } = usePanelAnimation(preview.isOpen);
  const isMobile = useIsMobile();
  const { prepareClose } = usePreviewTabLifecycle();
  const [closing, setClosing] = useState<Set<string>>(new Set());
  const instances = useMcpAppInstances();

  const closeTab = async (tab: PreviewTab) => {
    const ownerKey = preview.ownerKey;
    if (closing.has(tab.id)) return;
    setClosing((ids) => new Set(ids).add(tab.id));
    try {
      if (tab.kind === "browser") {
        const response = await window.api.browser.closeTab(tab.id);
        if (!response.success) throw new Error(response.error);
        // Native beforeunload can veto the close. Its returned catalog is authoritative.
        if (response.data.ownerKey === ownerKey) dispatch(syncBrowserPreviewTabs({ ownerKey,
          tabs: response.data.tabs.map(browserPreviewTab), activeTabId: response.data.activeTabId }));
      } else {
        await prepareClose(tab.id);
        dispatch(closePreviewTab({ ownerKey, id: tab.id }));
      }
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setClosing((ids) => { const next = new Set(ids); next.delete(tab.id); return next; }); }
  };

  const browser = useBrowserPanel();
  const nextTab = (direction: number) => {
    const tabs = preview.group.tabs;
    if (!tabs.length) return;
    const index = tabs.findIndex((tab) => tab.id === preview.group.activeTabId);
    const next = tabs[(index + direction + tabs.length) % tabs.length];
    preview.select(next.id);
    document.getElementById(`preview-tab-${next.id}`)?.focus();
  };
  useKeyboardShortcut("browser.nextTab", () => nextTab(1), { enabled: preview.isOpen, allowInEditable: true });
  useKeyboardShortcut("browser.previousTab", () => nextTab(-1), { enabled: preview.isOpen, allowInEditable: true });
  useKeyboardShortcut("browser.closeTab", () => { if (preview.activeTab) void closeTab(preview.activeTab); }, { enabled: preview.isOpen, allowInEditable: true });
  useKeyboardShortcut("browser.newTab", () => { void browser.newTab().catch((error) => toast.error(String(error))); }, { enabled: preview.isOpen, allowInEditable: true });

  return <div id="preview-panel" data-preview-panel="" role="complementary" aria-label="Preview panel" aria-hidden={!preview.isOpen}
    inert={!preview.isOpen} className="fixed inset-y-0 right-0 z-(--z-overlay) overflow-hidden transition-[width,transform,opacity] duration-150 ease-out motion-reduce:transition-none"
    style={{ display: isVisible ? undefined : "none", width: isMobile ? "100vw" : preview.isExpanded
      ? "calc(100% - var(--content-left) + var(--spacing) * 1.25)" : `var(${BROWSER_PANEL_WIDTH_VAR})`,
      transform: isAnimatedIn ? "translateX(0)" : "translateX(100%)", opacity: isAnimatedIn ? 1 : 0 }}>
    {!preview.isExpanded && !isMobile && <ResizeHandle edge="left" value={width} min={BROWSER_PANEL_WIDTH_MIN} max={BROWSER_PANEL_WIDTH_MAX}
      computeWidth={(clientX) => window.innerWidth - clientX}
      onPreview={(next) => setLayoutWidthVar(BROWSER_PANEL_WIDTH_VAR, next)}
      onCommit={(next) => dispatch(setBrowserPanelWidth(next))} onReset={() => dispatch(setBrowserPanelWidth(BROWSER_PANEL_WIDTH_DEFAULT))}
      onDragStart={() => { void window.api?.browser?.setVisible(false); }}
      onDragEnd={() => { if (preview.activeTab?.kind === "browser") void window.api?.browser?.setVisible(true); }}
      ariaLabel="Resize preview panel" />}
    <div className="absolute inset-1.25 flex min-h-0 flex-col overflow-hidden">
      <ShellHeader reserveWindowControls={reserveLayoutControls} paddingLeft={preview.isExpanded ? headerInsetLeft : undefined}
        onKeyDown={(event) => {
          if (!(event.target as Element).closest('[role="tab"]')) return;
          if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            event.preventDefault(); nextTab(event.key === "ArrowRight" ? 1 : -1);
          }
        }}
        actions={<PreviewPanelControls label="preview" isExpanded={preview.isExpanded}
          onToggleExpanded={preview.canExpand ? preview.toggleExpanded : undefined}
          onClose={reserveLayoutControls ? undefined : preview.hide} />}>
        <TabStrip activeKey={preview.group.activeTabId ?? undefined} role="tablist" aria-label="Preview tabs"
          createAction={<PreviewNewTabButton />}>
          {preview.group.tabs.map((tab, index) => {
            const label = tab.kind === "document" ? tab.doc.fileName : tab.title;
            let icon;
            if (tab.kind === "browser") icon = <BrowserTabIcon {...tab} />;
            else if (tab.kind === "document") { const Icon = DOC_TYPE_ICONS[tab.doc.docType]; icon = <Icon className="size-3.5" />; }
            else { const instance = instances.find((instance) => instance.document?.id === tab.id);
              icon = instance?.document && instance.scope
                ? <McpAppTabIcon app={instance.document.app} providerId={instance.scope.providerId} />
                : <Plugin className="size-3.5" />; }
            return <BaseTab key={tab.id} id={`preview-tab-${tab.id}`} ariaControls="preview-content" role="tab"
              ariaLabel={label} label={label} tooltip={label} icon={icon} isFirst={index === 0} showLeadingCorner={index > 0 || (preview.isExpanded && !!headerInsetLeft)}
              isActive={tab.id === preview.group.activeTabId} tabIndex={tab.id === preview.group.activeTabId ? 0 : -1}
              onClick={() => preview.select(tab.id)} onClose={() => { void closeTab(tab); }} closeLabel={`Close ${label}`}
              closeIcon={closing.has(tab.id) ? <Refresh className="size-3 animate-spin" /> : undefined} />;
          })}
        </TabStrip>
      </ShellHeader>
      <div id="preview-content" role="tabpanel" aria-labelledby={preview.activeTab ? `preview-tab-${preview.activeTab.id}` : undefined}
        className="relative min-h-0 flex-1 overflow-hidden rounded-2xl rounded-tl-none bg-primary dark:bg-primary-950">
        <BrowserPanel embedded />
        <DocumentViewerPanel />
        <McpAppPanel />
      </div>
    </div>
  </div>;
}
