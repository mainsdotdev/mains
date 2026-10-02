import { useReducer } from "react";
import { Button, Tooltip } from "@/components/ui";
import { Plus, Refresh } from "@/components/ui/icons";
import { PreviewPanelControls } from "@/components/layout/preview-panel-controls";
import { ResizeHandle } from "@/components/layout/resize-handle";
import { McpAppIcon } from "@/components/layout/sidebar/mcp-app-icon";
import { useMcpAppPanel } from "@/hooks/use-mcp-app-panel";
import { usePreviewPanelTransition } from "@/hooks/use-preview-panel-transition";
import { setLayoutWidthVar } from "@/hooks/use-layout-width-vars";
import { useSuppressBrowserView } from "@/hooks/use-suppress-browser-view";
import { useIsDarkMode } from "@/hooks/use-is-dark-mode";
import { useAppSelector } from "@/lib/redux/hooks";
import { useListWorkspacesQuery, useGetCollectionQuery, useGetAccountQuery } from "@/lib/redux/api";
import { mcpAppCompatibility } from "@/lib/mcp-app-extensions";
import { BROWSER_PANEL_WIDTH_DEFAULT, BROWSER_PANEL_WIDTH_MIN, BROWSER_PANEL_WIDTH_MAX, MCP_APP_PANEL_WIDTH_VAR } from "@/lib/layout";
import { McpAppWorkspace } from "./mcp-app-workspace";

export function McpAppPanel() {
  const panel = useMcpAppPanel();
  const setChatHost = panel?.setChatHost;
  const { isVisible, isAnimatedIn } = usePreviewPanelTransition(!!panel?.isOpen);
  const [reloadKey, reload] = useReducer((value: number) => value + 1, 0);
  useSuppressBrowserView(isVisible && !!panel?.document);
  const isDarkMode = useIsDarkMode();
  const sidebarCollapsed = useAppSelector((s) => s.appSettings.sidebarCollapsed);
  const { data: workspaces = [] } = useListWorkspacesQuery();
  const { data: account } = useGetAccountQuery();
  const collectionId = panel?.scope?.collectionId;
  const { data: collection } = useGetCollectionQuery({ id: collectionId ?? "", accountId: account?.id ?? "" },
    { skip: !collectionId || !account });
  if (!panel?.document) return null;
  const app = panel.document.app;
  const scope = panel.scope;
  const workspace = workspaces.find((workspace) => workspace.id === scope?.workspaceId);
  const target = scope?.mode === "developer" ? `Code${workspace ? ` / ${workspace.name}` : ""}`
    : `${scope?.mode === "work" ? "Work" : "Chat"}${collection ? ` / ${collection.name}` : ""}`;
  const compatibility = mcpAppCompatibility(app);

  return (
    <div
      data-mcp-app-panel=""
      role="complementary"
      aria-label={`${app.name} app panel`}
      aria-hidden={!panel.isOpen}
      inert={!panel.isOpen}
      className="fixed inset-y-0 right-0 z-9999 overflow-hidden transition-[width,transform,opacity] duration-300 ease-out motion-reduce:transition-none"
      style={{
        display: isVisible ? undefined : "none",
        pointerEvents: panel.isOpen ? undefined : "none",
        width: panel.isExpanded
          ? sidebarCollapsed ? "calc(100% - var(--content-left) - 4rem)" : "calc(100% - var(--content-left) + 0.3rem)"
          : `var(${MCP_APP_PANEL_WIDTH_VAR})`,
        transform: isAnimatedIn ? "translateX(0)" : "translateX(100%)",
        opacity: isAnimatedIn ? 1 : 0,
      }}
      onPointerDownCapture={(event) => {
        if (!panel.isExpanded || panel.chatMode !== "details") return;
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
      <div className="absolute inset-1.25 flex min-h-0 flex-col overflow-hidden rounded-2xl bg-primary dark:bg-primary-950">
        <header className="flex min-h-10 shrink-0 items-center gap-1 border-b border-primary-200/60 px-2 dark:border-primary-800/50">
          <div className="flex min-w-0 flex-1 items-center gap-2 py-1.5">
            <div className="glass-outline flex h-7 min-w-0 max-w-44 shrink-0 items-center gap-1.5 rounded-xl bg-primary-50 px-2.5 text-primary-950 dark:bg-primary-900 dark:text-primary-50">
              <McpAppIcon icons={app.icons} isDarkMode={isDarkMode} className="size-3.5 shrink-0" />
              <span className="truncate text-[12px] font-medium">{app.name}</span>
            </div>
            <Tooltip content={workspace?.rootPath ? `${target} · ${workspace.rootPath}` : target} position="bottom-left" className="max-w-xs whitespace-normal wrap-break-word">
              <span className="min-w-0 truncate text-xs text-primary-500">{target}</span>
            </Tooltip>
            <Button
              onClick={panel.newChat}
              tooltip="New chat"
              tooltipPosition="bottom-left"
              aria-label="New app chat"
              className="shrink-0 rounded-md p-1 text-primary-500 hover:bg-primary-200/60 hover:text-primary-900 focus-visible:bg-primary-200/60 dark:hover:bg-primary-800/70 dark:hover:text-primary-100 dark:focus-visible:bg-primary-800/70"
            >
              <Plus aria-hidden className="size-3.5" />
            </Button>
          </div>
          <Button
            onClick={reload}
            tooltip="Reload app"
            tooltipPosition="bottom-left"
            aria-label="Reload app"
            className="group ml-1 shrink-0 rounded-full p-1 text-primary-500 hover:bg-primary-200/60 hover:text-primary-900 focus-visible:bg-primary-200/60 dark:hover:bg-primary-800/70 dark:hover:text-primary-100 dark:focus-visible:bg-primary-800/70"
          >
            <Refresh aria-hidden className="size-3.5 rotate-180 transition-transform duration-200 group-active:rotate-90" />
          </Button>
          <PreviewPanelControls
            label={app.name}
            isExpanded={panel.isExpanded}
            onToggleExpanded={panel.toggleExpanded}
            onClose={panel.close}
            chatVisible={panel.chatVisible}
            onToggleChat={() => panel.setChatVisible(!panel.chatVisible)}
          />
        </header>
        {compatibility.notice && (
          <div role="note" className="shrink-0 border-b border-primary-200/60 px-3 py-2 text-xs text-primary-500 dark:border-primary-800/50">
            {compatibility.notice}
          </div>
        )}
        <div className="relative min-h-0 flex-1 isolate">
          <McpAppWorkspace key={reloadKey} />
          <div ref={setChatHost} className="pointer-events-none absolute inset-0 z-10" />
        </div>
      </div>
    </div>
  );
}
