import { lazy, Suspense, useEffect, useLayoutEffect, useState } from "react";
import { HashRouter as Router, useLocation } from "react-router-dom";
import Sidebar from "./components/layout/sidebar";
import RightPanel from "./components/layout/right-panel";
import { ToggleButton } from "./components/layout/right-panel/toggle-button";
import { SessionPanel } from "@/features/workspace/components/session-panel";
import { SubagentPanel } from "@/features/workspace/components/subagent-panel/subagent-panel";
import { useHasSessionSubagents } from "./features/workspace/hooks/use-session-subagents";
import { selectSessionRunId } from "@/features/workspace/components/session-panel/select-session-run";
import {
  MainRoutes,
  MainLayout,
  MainContent,
} from "./components/layout/main";
import {
  shouldHideRightPanel,
  SESSION_PANEL_GUTTER,
  CONTENT_LEFT_VAR,
  CONTENT_RIGHT_VAR,
  hasSidebarPanel,
  isSettingsRoute,
  isWorkspaceRoute,
  NAV_RAIL_WIDTH,
  MCP_APP_PANEL_WIDTH_VAR,
} from "./lib/layout";
import { useBottomTerminal } from "./hooks/use-bottom-terminal";
import { useBrowserPanel, BrowserPanelProvider } from "./hooks/use-browser-panel";
import { McpAppPanelProvider, useMcpAppPanel } from "./hooks/use-mcp-app-panel";
import { McpAppPanel } from "./features/workspace/components/mcp-app-panel";
import { BrowserPanel } from "./features/workspace/components/browser-panel";
import { useDocumentViewer, DocumentViewerProvider } from "./hooks/use-document-viewer";
import { DocumentViewerPanel } from "./features/workspace/components/document-viewer-panel";
import { useWorkspaceVariant } from "./hooks/use-workspace-variant";
import { useModeConfig } from "./hooks/use-mode-config";
import { ReduxProvider } from "./providers/redux-provider";
import { ErrorBoundary, Toaster } from "@/components/ui";
import { useAppSelector, useAppDispatch } from "./lib/redux/hooks";
import { onAppReady } from "./lib/app-ready";
import { isWeb, useIsMobile } from "./lib/platform";
import {
  setSidebarCollapsed,
  setRightPanelOpen,
  setSessionPanelOpen,
  setOnboardingCompleted,
} from "./lib/redux/slices/appSettingsSlice";
import { SidebarToggleButton } from "./components/layout/sidebar/sidebar-toggle-button";
import { MainHeaderProvider } from "./hooks/use-main-header";
import { useLayoutWidthVars } from "./hooks/use-layout-width-vars";
import { useAppearanceFonts } from "./hooks/use-appearance-fonts";
import { useAppTheme } from "./hooks/use-app-theme";
import { getProviderVariant } from "./lib/provider-variants";
import { CommandMenu } from "./features/command-menu/command-menu";
import { useAppshots } from "./hooks/use-appshots";
import { useRunMessageQueueController } from "./features/workspace/hooks/use-run-message-queue-controller";
import { useRealtimeVoiceLifecycle } from "./features/workspace/hooks/use-realtime-voice";
import { RealtimeVoiceDock } from "./features/workspace/components/realtime-voice-dock";
import { useWindowRequests } from "./hooks/use-window-requests";
import { useAppSettingsEvents } from "./hooks/use-app-settings-events";
import { useOnboardingWindow } from "./features/onboarding/hooks/use-onboarding-window";
import {
  KeyboardShortcutsProvider,
  useKeyboardShortcut,
} from "./providers/keyboard-shortcuts-provider";

// First-run-only UI is a substantial graph (feature previews, provider cards,
// and settings controls). Completed users should not parse it on every launch.
const OnboardingScreen = lazy(() =>
  import("./features/onboarding/components/onboarding-screen").then((module) => ({
    default: module.OnboardingScreen,
  })),
);

/** Layout widths live in CSS (`--sidebar-width`, `--panel-width`, `--browser-panel-width`) — see index.css. */
const SIDEBAR_WIDTH = "var(--sidebar-width)";
const RIGHT_PANEL_WIDTH = "var(--panel-width)";
const BROWSER_PANEL_WIDTH = "var(--browser-panel-width)";
const DOC_VIEWER_PANEL_WIDTH = "var(--doc-viewer-panel-width)";
const SESSION_PANEL_WIDTH = "var(--session-panel-width)";
/** Content inset when no panel occupies that edge. */
const EDGE_GUTTER = "0.375rem";

function useDropdownAnimationPrewarm() {
  useEffect(() => {
    let el: HTMLDivElement | null = null;
    let timeoutId = 0;
    // Must run AFTER `.app-ready`: before it, the index.css gate forces
    // animation-duration to 0s, so the keyframe would "finish" instantly and
    // compile nothing. Runs in-viewport (offscreen layers can be culled from
    // raster) at an imperceptible opacity, on a realistically sized replica of
    // the menu surface, so the compositor rasterizes the gradient/border/shadow
    // and runs the scale+opacity keyframe before a real dropdown first opens.
    const unsubscribe = onAppReady(() => {
      el = document.createElement("div");
      el.style.cssText =
        "position:fixed;bottom:0;right:0;opacity:0.001;pointer-events:none;";
      el.innerHTML =
        '<div class="animate-dropdown-in glass-surface rounded-2xl" style="width:240px;height:280px;padding:12px;font-size:13px;">prewarm</div>';
      document.body.appendChild(el);
      timeoutId = window.setTimeout(() => el?.remove(), 600);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timeoutId);
      el?.remove();
    };
  }, []);
}

function AppContent() {
  useDropdownAnimationPrewarm();
  useLayoutWidthVars();
  useAppearanceFonts();
  useAppTheme();
  useAppshots();
  useRunMessageQueueController();
  useWindowRequests();
  useAppSettingsEvents();
  const location = useLocation();
  const sidebarPanelRoute = hasSidebarPanel(location.pathname);
  const settingsRoute = isSettingsRoute(location.pathname);
  const workspaceRoute = isWorkspaceRoute(location.pathname);
  useRealtimeVoiceLifecycle();
  const hideRightPanel = shouldHideRightPanel(location.pathname);
  const variant = useWorkspaceVariant();
  const activeProviderId =
    variant === "default" ? undefined : getProviderVariant(variant).providerId;
  const bottomTerminal = useBottomTerminal();
  const browserPanel = useBrowserPanel();
  const mcpAppPanel = useMcpAppPanel();
  const appExpanded = !!mcpAppPanel?.isExpanded;
  const docViewer = useDocumentViewer();
  const modeConfig = useModeConfig();
  const showTerminalToggle = variant !== "default" && modeConfig.showTerminal;
  const showBrowserToggle = variant !== "default";
  const dispatch = useAppDispatch();
  const sidebarCollapsed = useAppSelector(
    (state) => state.appSettings.sidebarCollapsed,
  );
  const isRightPanelOpen = useAppSelector((state) => state.appSettings.rightPanelOpen);
  const rightPaneReady = useAppSelector((state) => state.workspace.composerContextReady);
  const isSessionPanelOpen = useAppSelector(
    (state) => state.appSettings.sessionPanelOpen,
  );
  const activeWorkspaceId = useAppSelector(
    (state) => state.workspace.activeWorkspaceId,
  );
  const sessionRunId = useAppSelector((state) =>
    selectSessionRunId(state.workspace),
  );
  const onboardingCompleted = useAppSelector(
    (state) => state.appSettings.onboardingCompleted,
  );
  // The onboarding screen announces its native mode only once its lazy chunk
  // has mounted, so the first visible window already contains the welcome UI.
  useOnboardingWindow(false, onboardingCompleted);
  const [animateWorkspaceEntry] = useState(
    () => !onboardingCompleted && !isWeb && typeof document.startViewTransition !== "function",
  );
  const isMobile = useIsMobile();
  const browserTabsInHeader = browserPanel.isExpanded && !modeConfig.showTabs && !isMobile;

  // Chat/work hide the right panel entirely; a persisted rightPanelOpen from a
  // developer session must not inset the content there (and is left untouched
  // so switching back to developer restores it).
  const rightPanelVisible =
    rightPaneReady && !hideRightPanel && modeConfig.showRightPanel && isRightPanelOpen;
  // Whatever currently owns the right edge — the content stops there, and the
  // session box aligns to the same edge just inside it.
  const rightLaneWidth = mcpAppPanel?.isOpen
    ? appExpanded ? EDGE_GUTTER : `var(${MCP_APP_PANEL_WIDTH_VAR})`
    : docViewer.isOpen
    ? DOC_VIEWER_PANEL_WIDTH
    : browserPanel.isOpen
      ? browserTabsInHeader ? EDGE_GUTTER : BROWSER_PANEL_WIDTH
      : rightPanelVisible
        ? RIGHT_PANEL_WIDTH
        : EDGE_GUTTER;
  // The box has two independent targets: Code can describe a workspace before
  // a run exists; Work can describe a workspace-less run. Git remains gated
  // behind the workspace half so its status query never touches managed run
  // directories.
  const hasSessionPanelTarget =
    (modeConfig.showGitActions && !!activeWorkspaceId) ||
    (modeConfig.showSources && !!sessionRunId);
  const sessionPanelShown =
    isSessionPanelOpen &&
    !hideRightPanel &&
    hasSessionPanelTarget;
  // The box floats — overlays the content instead of taking a column — when
  // there is no room to share (another panel already holds the right edge), or
  // nothing to share *with*: the empty state and the other non-run tabs centre
  // a prompt, and insetting the content would slide that column off-centre for
  // a panel it has no relationship to. Both are derived, so closing that panel
  // or opening a run drops the box back into the layout on its own.
  const sessionPanelFloating =
    rightLaneWidth !== EDGE_GUTTER || sessionRunId === null;
  // The subagent box shares the session box's layout contract: it appears when
  // the open run has agents, hides while the right panel owns the edge, floats
  // over the content when the browser/doc panels do, and — in its normal list
  // state — insets the content like the session box. Collapsed to its pill it
  // stops asking for room, and its expanded state grows OVER the chat from the
  // docked slot rather than widening the inset.
  const hasSubagents = useHasSessionSubagents(sessionRunId);
  const subagentPanelCollapsed = useAppSelector(
    (state) => state.appSettings.subagentPanelCollapsed,
  );
  // Hidden whenever ANY panel owns the right edge (right panel, browser, doc
  // viewer) — the corner it lives in belongs to that panel then.
  const subagentPanelShown =
    hasSubagents &&
    !!sessionRunId &&
    !hideRightPanel &&
    !mcpAppPanel?.isOpen &&
    rightLaneWidth === EDGE_GUTTER;
  const subagentPanelDocked =
    subagentPanelShown && !isMobile && !subagentPanelCollapsed;

  // Sharing the layout means insetting the content, not shrinking it: a smaller
  // content box would cut a hole in its opaque surface and expose the
  // translucent window behind it. The inset keeps the surface whole and still
  // slides the centered chat column left, exactly as far as the box is wide.
  // Both corner boxes live in the same right lane at the same width, so either
  // one docking asks for the same inset.
  const contentInsetRight =
    (sessionPanelShown && !isMobile && !sessionPanelFloating) ||
    subagentPanelDocked
      ? `calc(${SESSION_PANEL_WIDTH} + ${SESSION_PANEL_GUTTER})`
      : undefined;

  // The content column's live edges — the same values MainContent gets as
  // margins (plus the docked session box on the right). Published on `:root`
  // so viewport-fixed overlays (the Toaster) can center over the content
  // instead of the window. Onboarding renders without the shell,
  // so the edges collapse to zero there.
  const contentLeft = isMobile
    ? EDGE_GUTTER
    : sidebarPanelRoute && (settingsRoute || !sidebarCollapsed)
      ? `calc(${NAV_RAIL_WIDTH} + ${SIDEBAR_WIDTH})`
      : `calc(${NAV_RAIL_WIDTH} + 0.5rem)`;
  const contentRight = isMobile ? EDGE_GUTTER : rightLaneWidth;
  const shellVisible = onboardingCompleted || isWeb;

  useKeyboardShortcut("app.toggleSidebar", () => {
    dispatch(setSidebarCollapsed(!sidebarCollapsed));
  }, { enabled: !appExpanded && (isMobile || workspaceRoute), allowInEditable: true });
  useKeyboardShortcut("app.toggleTerminal", bottomTerminal.toggle, {
    enabled:
      showTerminalToggle && (!!activeWorkspaceId || bottomTerminal.isOpen),
    allowInEditable: true,
  });
  useKeyboardShortcut("app.toggleBrowser", () => {
    if (!showBrowserToggle) return;
    if (!browserPanel.isOpen) {
      mcpAppPanel?.close();
      dispatch(setRightPanelOpen(false));
      docViewer.close();
    }
    browserPanel.toggle();
  }, {
    enabled: showBrowserToggle && !hideRightPanel,
    allowInEditable: true,
  });
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    if (!shellVisible) {
      root.setProperty(CONTENT_LEFT_VAR, "0px");
      root.setProperty(CONTENT_RIGHT_VAR, "0px");
      return;
    }
    root.setProperty(CONTENT_LEFT_VAR, contentLeft);
    root.setProperty(
      CONTENT_RIGHT_VAR,
      contentInsetRight
        ? `calc(${contentRight} + ${contentInsetRight})`
        : contentRight,
    );
  }, [shellVisible, contentLeft, contentRight, contentInsetRight]);

  // Mobile: the sidebar is an overlay drawer — auto-close on navigation (and on
  // entering mobile) so the selected content is visible. Local UI state only.
  useEffect(() => {
    if (isMobile) dispatch(setSidebarCollapsed(true));
  }, [isMobile, location.pathname, dispatch]);

  // Web skips onboarding (CLI setup is a backend concern), but onboardingCompleted
  // is a per-browser persisted flag that gates the space selector + composer.
  // Mark it complete so those render. Local-only; no backend write.
  useEffect(() => {
    if (isWeb && !onboardingCompleted) dispatch(setOnboardingCompleted(true));
  }, [onboardingCompleted, dispatch]);

  // Onboarding sets up local CLIs; in web those live on the backend, so skip
  // it. First run shows only the onboarding screen — the app shell mounts
  // after completion.
  if (!onboardingCompleted && !isWeb) {
    return (
      <>
        <Toaster />
        <Suspense fallback={null}>
          <OnboardingScreen />
        </Suspense>
      </>
    );
  }

  // App previews use their own reload and expand/collapse controls. Keep the
  // workspace controls outside animated panels when no app preview is open.
  const showLayoutControls = !mcpAppPanel?.isOpen && !hideRightPanel && !(isMobile && !sidebarCollapsed);
  const layoutControls = showLayoutControls ? (
    <ToggleButton
      showChatActions={isMobile}
      hideChatControls={appExpanded}
      sessionPanelRight={!isMobile
        ? mcpAppPanel?.isOpen && !appExpanded
          ? `calc(var(${MCP_APP_PANEL_WIDTH_VAR}) + 0.75rem)`
          : browserPanel.isOpen && !browserPanel.isExpanded
            ? `calc(${BROWSER_PANEL_WIDTH} + 0.75rem)`
            : undefined
        : undefined}
      isOpen={rightPanelVisible}
      onClick={() => {
        const open = !isRightPanelOpen;
        if (open) {
          mcpAppPanel?.close();
          browserPanel.close();
          docViewer.close();
          // The right panel takes the edge the session box sits against.
          dispatch(setSessionPanelOpen(false));
        }
        dispatch(setRightPanelOpen(open));
      }}
      terminalOpen={showTerminalToggle ? bottomTerminal.isOpen : undefined}
      onTerminalToggle={showTerminalToggle ? bottomTerminal.toggle : undefined}
      browserOpen={showBrowserToggle ? browserPanel.isOpen : undefined}
      browserExpanded={browserPanel.isExpanded}
      onBrowserExpandToggle={showBrowserToggle ? browserPanel.toggleExpanded : undefined}
      onBrowserToggle={showBrowserToggle ? () => {
        if (!browserPanel.isOpen) {
          mcpAppPanel?.close();
          dispatch(setRightPanelOpen(false));
          docViewer.close();
        }
        browserPanel.toggle();
      } : undefined}
    />
  ) : undefined;

  return (
    <>
      <Toaster />
      <CommandMenu />
      {isMobile && (
        <div className="fixed bottom-5 left-5 z-(--z-overlay)">
          <RealtimeVoiceDock />
        </div>
      )}
      <MainLayout className={animateWorkspaceEntry ? "onboarding-workspace-enter" : undefined}>
        {/* Mobile drawer scrims — tap to dismiss. Each sits just below its panel
            (sidebar z-30, right panel z-50) and above the full-width content. */}
        {isMobile && !sidebarCollapsed && (
          <div
            className="fixed inset-0 bg-primary-950/40"
            style={{ zIndex: 20 }}
            onClick={() => dispatch(setSidebarCollapsed(true))}
            aria-hidden
          />
        )}
        {isMobile && rightPanelVisible && (
          <div
            className="fixed inset-0 bg-primary-950/40"
            style={{ zIndex: 45 }}
            onClick={() => dispatch(setRightPanelOpen(false))}
            aria-hidden
          />
        )}
        {!appExpanded && (isMobile || workspaceRoute) && !(
          isMobile &&
          (rightPanelVisible || browserPanel.isOpen || docViewer.isOpen || mcpAppPanel?.isOpen)
        ) && (
          <SidebarToggleButton
            isOpen={!sidebarCollapsed}
            browserExpanded={browserPanel.isExpanded || appExpanded}
            onClick={() => dispatch(setSidebarCollapsed(!sidebarCollapsed))}
          />
        )}
        <Sidebar collapsed={sidebarCollapsed} />
        <MainContent
          marginLeft={contentLeft}
          marginRight={contentRight}
          transparentSurface={workspaceRoute}
          contentInsetRight={contentInsetRight}
          hasRightPanel={
            !hideRightPanel && !rightPanelVisible && !browserPanel.isOpen && !docViewer.isOpen && !mcpAppPanel?.isOpen
          }
          browserOpen={browserPanel.isOpen || docViewer.isOpen || !!mcpAppPanel?.isOpen}
          headerHidden={(browserPanel.isExpanded && !browserTabsInHeader) || appExpanded}
          browserTabsInHeader={browserTabsInHeader}
          sidebarCollapsed={sidebarCollapsed}
        >
          <ErrorBoundary level="route">
            <MainRoutes />
          </ErrorBoundary>
        </MainContent>
        {!hideRightPanel && modeConfig.showRightPanel && (
          <RightPanel isOpen={rightPanelVisible} width={RIGHT_PANEL_WIDTH} />
        )}
        {!hideRightPanel && (
          <SessionPanel
            providerId={activeProviderId}
            runId={sessionRunId}
            laneOffset={rightLaneWidth}
            floating={sessionPanelFloating}
          />
        )}
        {!hideRightPanel && (
          <SubagentPanel shown={subagentPanelShown} laneOffset={rightLaneWidth} />
        )}
        <BrowserPanel
          tabsInMainHeader={browserTabsInHeader}
          reserveLayoutControls={showLayoutControls}
        />
        <McpAppPanel reserveLayoutControls={showLayoutControls} />
        {layoutControls}
        <DocumentViewerPanel />
      </MainLayout>
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary level="app">
      <ReduxProvider>
        <Router>
          <KeyboardShortcutsProvider>
            <MainHeaderProvider>
              <BrowserPanelProvider>
                <DocumentViewerProvider>
                  <McpAppPanelProvider>
                    <AppContent />
                  </McpAppPanelProvider>
                </DocumentViewerProvider>
              </BrowserPanelProvider>
            </MainHeaderProvider>
          </KeyboardShortcutsProvider>
        </Router>
      </ReduxProvider>
    </ErrorBoundary>
  );
}
