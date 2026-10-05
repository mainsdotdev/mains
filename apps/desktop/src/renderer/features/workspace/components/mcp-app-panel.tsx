import { useReducer, useState } from "react";
import { Button } from "@/components/ui";
import { Refresh } from "@/components/ui/icons";
import { PreviewPanelControls } from "@/components/layout/preview-panel-controls";
import { ResizeHandle } from "@/components/layout/resize-handle";
import { McpAppIcon } from "@/components/layout/sidebar/mcp-app-icon";
import { useMcpAppPanel } from "@/hooks/use-mcp-app-panel";
import { usePreviewPanelTransition } from "@/hooks/use-preview-panel-transition";
import { setLayoutWidthVar } from "@/hooks/use-layout-width-vars";
import { useSuppressBrowserView } from "@/hooks/use-suppress-browser-view";
import { useIsDarkMode } from "@/hooks/use-is-dark-mode";
import { BROWSER_PANEL_WIDTH_DEFAULT, BROWSER_PANEL_WIDTH_MIN, BROWSER_PANEL_WIDTH_MAX, MCP_APP_PANEL_WIDTH_VAR, LAYOUT_FIXED_CONTROLS_WIDTH_VAR } from "@/lib/layout";
import { mcpAppCompatibility } from "@/lib/mcp-app-extensions";
import { BaseTab } from "./base-tab";
import { McpAppWorkspace } from "./mcp-app-workspace";

export function McpAppPanel({ reserveLayoutControls = false }: { reserveLayoutControls?: boolean }) {
  const panel = useMcpAppPanel();
  const setChatHost = panel?.setChatHost;
  const { isVisible, isAnimatedIn } = usePreviewPanelTransition(!!panel?.isOpen);
  const [reloadKey, reload] = useReducer((value: number) => value + 1, 0);
  const [startedDocumentId, setStartedDocumentId] = useState<string | null>(null);
  const documentId = panel?.document?.id;
  // A rail launch changes the conversation owner before the panel can be
  // shown. Latch its first visible render, then keep the canvas mounted.
  if (documentId && panel?.isOpen && isVisible && startedDocumentId !== documentId) {
    setStartedDocumentId(documentId);
  }
  useSuppressBrowserView(isVisible && !!panel?.document);
  const isDarkMode = useIsDarkMode();
  if (!panel?.document) return null;
  const app = panel.document.app;
  const interfaceUnsupported = !!mcpAppCompatibility(app).notice;

  return (
    <div
      data-mcp-app-panel=""
      data-mcp-app-panel-visible={isVisible ? "" : undefined}
      role="complementary"
      aria-label={`${app.name} app panel`}
      aria-hidden={!panel.isOpen}
      inert={!panel.isOpen}
      className="fixed inset-y-0 right-0 z-9999 overflow-hidden transition-[width,transform,opacity] duration-300 ease-out motion-reduce:transition-none"
      style={{
        display: isVisible ? undefined : "none",
        pointerEvents: panel.isOpen ? undefined : "none",
        width: panel.isExpanded
          ? "calc(100% - var(--content-left) + 0.3rem)"
          : `var(${MCP_APP_PANEL_WIDTH_VAR})`,
        transform: isAnimatedIn ? "translateX(0)" : "translateX(100%)",
        opacity: isAnimatedIn ? 1 : 0,
      }}
      onPointerDownCapture={(event) => {
        if (interfaceUnsupported || !panel.isExpanded || panel.chatMode !== "details") return;
        if ((event.target as Element).closest("[data-floating-chat-surface]")) return;
        panel.setChatMode("input");
      }}
    >
      {!panel.isExpanded && (
        <ResizeHandle
          edge="left"
          value={panel.width}
          min={BROWSER_PANEL_WIDTH_MIN}
          max={BROWSER_PANEL_WIDTH_MAX}
          computeWidth={(clientX) => window.innerWidth - clientX}
          onPreview={(width) => setLayoutWidthVar(MCP_APP_PANEL_WIDTH_VAR, width)}
          onCommit={panel.setWidth}
          onReset={() => panel.setWidth(BROWSER_PANEL_WIDTH_DEFAULT)}
          ariaLabel="Resize app panel"
        />
      )}
      <div className="absolute inset-1.25 flex min-h-0 flex-col">
        <header className="relative z-(--z-panel-toggle) flex h-(--shell-header-height) shrink-0 items-center justify-end pr-2">
          {!panel.isExpanded && (
            <div role="tablist" aria-label="App tabs" className="-ml-3 flex min-w-0 flex-1 items-center overflow-x-auto pl-3 scrollbar-none [&::-webkit-scrollbar]:hidden">
              <BaseTab
                isActive
                isFirst
                showLeadingCorner={false}
                role="tab"
                ariaLabel={app.name}
                onClick={() => { if (panel.isExpanded) panel.setChatMode("input"); }}
                icon={<McpAppIcon icons={app.icons} isDarkMode={isDarkMode} className="size-3.5 shrink-0" />}
                label={app.name}
                tooltip={app.name}
                closeLabel={`Close ${app.name} tab`}
                onClose={(event) => {
                  event.stopPropagation();
                  panel.close();
                }}
              />
            </div>
          )}
          <div className="ml-1 flex shrink-0 items-center gap-0.5">
            <Button
              variant="icon"
              onClick={reload}
              tooltip="Reload app"
              tooltipPosition="bottom-left"
              aria-label="Reload app"
              className="group"
            >
              <Refresh aria-hidden className="size-4 rotate-180 transition-transform duration-200 group-active:rotate-90" />
            </Button>
            {(!interfaceUnsupported || !panel.isExpanded) && <PreviewPanelControls
              label={app.name}
              isExpanded={panel.isExpanded}
              onToggleExpanded={panel.toggleExpanded}
            />}
          </div>
          {reserveLayoutControls && (
            <div aria-hidden="true" className="shrink-0" style={{ width: `var(${LAYOUT_FIXED_CONTROLS_WIDTH_VAR}, 0px)` }} />
          )}
        </header>
        <div className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl ${panel.isExpanded ? "" : "rounded-tl-none"} bg-primary dark:bg-primary-950`}>
          <div className="relative min-h-0 flex-1 isolate">
            {startedDocumentId === documentId && <McpAppWorkspace key={reloadKey} />}
            {!interfaceUnsupported && <div ref={setChatHost} className="pointer-events-none absolute inset-0 z-10" />}
          </div>
        </div>
      </div>
    </div>
  );
}
