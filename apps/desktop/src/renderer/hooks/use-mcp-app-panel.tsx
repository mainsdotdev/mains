import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { McpAppEntrypoint, McpAppToolOpen, OpenMcpAppExtensionResponse } from "@mains/contracts/mcp-apps";
import { McpAppToolOpenerProvider } from "./use-mcp-app-tool-opener";
import type { FloatingChatMode } from "../../shared/floating-chat";
import { toast } from "@/components/ui";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { store } from "@/lib/redux";
import { appApi } from "@/lib/transport";
import { BROWSER_PANEL_WIDTH_DEFAULT, BROWSER_PANEL_WIDTH_MIN, BROWSER_PANEL_WIDTH_MAX, MCP_APP_PANEL_WIDTH_VAR, clamp, isWorkspaceRoute } from "@/lib/layout";
import { setLayoutWidthVar } from "./use-layout-width-vars";
import { setBrowserPanelOpen, setDocumentViewerOpen, setRightPanelOpen, setSessionPanelOpen, setSidebarCollapsed } from "@/lib/redux/slices/appSettingsSlice";
import { openNewRunTab, replaceMcpAppContext, setMcpAppRunId, setPendingRunId, setSelectedCollectionId } from "@/lib/redux/slices/workspaceSlice";
import { useActiveSpace } from "./use-active-space";
import { useModeConfig } from "./use-mode-config";
import { useSpaceProviderVariant } from "./use-space-provider-variant";
import { useMcpAppExtensions } from "./use-mcp-app-extensions";
import { useWorkspaceData } from "@/features/workspace/hooks/use-workspace-data";
import { composerOwnerKey, mcpAppConversationKey } from "@/features/workspace/lib/ui-context";
import { sameMcpApp, sameMcpAppScope, mcpAppConversationPath, type McpAppScope } from "@/features/workspace/lib/mcp-app-panel";
import { mcpAppContextItems, mcpAppContextState, mcpAppMessageText, normalizeMcpAppContext,
  type McpAppMessageOptions, type McpAppModelContextState } from "@/features/workspace/lib/mcp-app-context";
import type { ContextItem } from "@/features/workspace/lib/composer-context";

export interface McpAppPanelDocument {
  id: string;
  app: McpAppEntrypoint & { originCallId?: string };
  sessionId?: string;
  resourceRunId?: string;
  input: Record<string, unknown>;
  output: unknown;
}

interface PanelState {
  document: McpAppPanelDocument;
  scope: McpAppScope;
  ownerKey: string;
  runId?: string;
  visible: boolean;
  expanded: boolean;
  pendingNewChat?: boolean;
}

export interface McpAppConversationHost {
  scope: McpAppScope;
  ownerKey: string;
  runId?: string;
  send: (text: string, options?: McpAppMessageOptions) => Promise<string | null | undefined>;
}

export type { McpAppToolOpen } from "@mains/contracts/mcp-apps";

interface McpAppPanelValue {
  document: McpAppPanelDocument | null;
  scope: McpAppScope | null;
  ownerKey: string | null;
  runId?: string;
  isOpen: boolean;
  isExpanded: boolean;
  width: number;
  setWidth: (width: number) => void;
  chatMode: FloatingChatMode;
  setChatMode: (mode: FloatingChatMode) => void;
  chatVisible: boolean;
  setChatVisible: (visible: boolean) => void;
  chatHost: HTMLDivElement | null;
  setChatHost: (node: HTMLDivElement | null) => void;
  opening: string | null;
  error: string | null;
  openGlobal: (app: McpAppEntrypoint) => Promise<void>;
  openTool: (result: McpAppToolOpen, automatic?: boolean) => void;
  close: () => void;
  toggleExpanded: () => void;
  newChat: () => void;
  registerConversation: (host: McpAppConversationHost) => () => void;
  attachRun: (fromKey: string, runId: string, scope: McpAppScope) => void;
  sendMessage: (content: unknown, options?: McpAppMessageOptions) => Promise<void>;
  updateModelContext: (context: unknown) => Promise<McpAppModelContextState | null>;
  modelContext: McpAppModelContextState | null;
  appContext: (ownerKey: string) => ContextItem[];
}

const Context = createContext<McpAppPanelValue | null>(null);

/** One live app document, shared by the docked and expanded presentations. */
export function McpAppPanelProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { activeSpaceId } = useActiveSpace();
  const provider = useSpaceProviderVariant();
  const { mode } = useModeConfig();
  const backendId = useAppSelector((s) => s.backends.activeBackendId);
  const composerKey = useAppSelector((s) => s.workspace.composerContextKey);
  const contextItems = useAppSelector((s) => s.workspace.contextItems);
  const contextItemsByKey = useAppSelector((s) => s.workspace.contextItemsByKey);
  const anotherPanelOpen = useAppSelector((s) => s.appSettings.browserPanelOpen || s.appSettings.documentViewerOpen || s.appSettings.rightPanelOpen);
  const sidebarCollapsed = useAppSelector((s) => s.appSettings.sidebarCollapsed);
  const { workspaceId } = useWorkspaceData(provider.providerId, mode);
  const { entries } = useMcpAppExtensions();
  const [state, setState] = useState<PanelState | null>(null);
  const stateRef = useRef(state);
  const commitState = useCallback((next: PanelState | null) => {
    stateRef.current = next;
    setState(next);
  }, []);
  const activeContext = `${backendId}/${activeSpaceId}/${provider.providerId}/${mode}`;
  const activeContextRef = useRef(activeContext);
  const pathnameRef = useRef(pathname);
  useLayoutEffect(() => { activeContextRef.current = activeContext; }, [activeContext]);
  useLayoutEffect(() => { pathnameRef.current = pathname; }, [pathname]);
  const hostRef = useRef<McpAppConversationHost | null>(null);
  const openingRevision = useRef(0);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [width, updateWidth] = useState(BROWSER_PANEL_WIDTH_DEFAULT);
  const setWidth = useCallback((next: number) => {
    updateWidth(clamp(next, BROWSER_PANEL_WIDTH_MIN, BROWSER_PANEL_WIDTH_MAX));
  }, []);
  useLayoutEffect(() => { setLayoutWidthVar(MCP_APP_PANEL_WIDTH_VAR, width); }, [width]);
  const [chatMode, setChatMode] = useState<FloatingChatMode>("input");
  const [chatVisible, setChatVisible] = useState(true);
  const [chatHost, setChatHost] = useState<HTMLDivElement | null>(null);
  const sendingRef = useRef(false);

  const captureScope = useCallback((): McpAppScope => ({
    backendId, spaceId: activeSpaceId, providerId: provider.providerId, mode,
    workspaceId: mode === "developer" ? workspaceId : undefined,
    collectionId: mode === "developer" ? null : store.getState().workspace.selectedCollectionId,
  }), [backendId, activeSpaceId, provider.providerId, mode, workspaceId]);

  const takeRightEdge = useCallback(() => {
    dispatch(setBrowserPanelOpen(false));
    dispatch(setDocumentViewerOpen(false));
    dispatch(setRightPanelOpen(false));
    dispatch(setSessionPanelOpen(false));
  }, [dispatch]);

  const showConversation = useCallback((scope: McpAppScope, runId?: string, replace = false) => {
    dispatch(setSelectedCollectionId(scope.collectionId ?? null));
    if (runId) dispatch(setPendingRunId(runId));
    navigate(mcpAppConversationPath(scope, runId), { replace });
  }, [dispatch, navigate]);

  // Changing presentation never disposes a connection. Only replacing the
  // document (or the window going away) releases its ephemeral thread.
  const sessionId = state?.document.sessionId;
  useEffect(() => {
    if (!sessionId) return;
    const release = () => { void window.api.mcpApps.closeExtension({ sessionId }).catch(() => {}); };
    window.addEventListener("beforeunload", release);
    return () => { window.removeEventListener("beforeunload", release); release(); };
  }, [sessionId]);
  useEffect(() => () => { openingRevision.current++; }, []);

  const rememberRun = useCallback((panel: PanelState, runId: string) => {
    dispatch(setMcpAppRunId({ key: mcpAppConversationKey(panel.scope, panel.document.app.id), runId }));
  }, [dispatch]);

  const openGlobal = useCallback(async (app: McpAppEntrypoint) => {
    const scope = captureScope();
    const current = stateRef.current;
    const bucket = mcpAppConversationKey(scope, app.id);
    takeRightEdge();
    setError(null);
    setChatVisible(true);
    setChatMode("input");
    const revision = ++openingRevision.current;
    const openingPath = pathnameRef.current;
    const replaceRoute = openingPath.startsWith("/apps/");
    const isCurrentOpening = () => revision === openingRevision.current &&
      activeContext === activeContextRef.current && openingPath === pathnameRef.current;
    if (current && mcpAppConversationKey(current.scope, current.document.app.id) === bucket && sameMcpApp(current.document.app, app)) {
      setOpening(null);
      commitState({ ...current, visible: true, expanded: true });
      showConversation(current.scope, current.runId, replaceRoute);
      return;
    }
    setOpening(app.id);
    try {
      const runId: string | undefined = store.getState().workspace.mcpAppRunIdByKey[bucket];
      let runScope = scope;
      if (runId) {
        const response = await appApi.runs.getById(runId);
        const run = response.success ? response.data : null;
        if (!run || run.providerId !== scope.providerId || run.mode !== scope.mode || run.spaceId !== scope.spaceId)
          throw new Error("This app's conversation is unavailable. Open the app from a conversation to start again.");
        else runScope = { ...scope, workspaceId: run.workspaceId ?? undefined, collectionId: run.collectionId ?? null };
      }
      if (!isCurrentOpening()) return;
      const opened = await window.api.mcpApps.openExtension({ providerId: scope.providerId, entrypointId: app.id });
      if (!opened.success) throw new Error(opened.error);
      const session = opened.data as OpenMcpAppExtensionResponse;
      if (!isCurrentOpening()) {
        await window.api.mcpApps.closeExtension({ sessionId: session.sessionId });
        return;
      }
      commitState({ document: { id: crypto.randomUUID(), app: session.app, sessionId: session.sessionId, input: {}, output: session.output },
        scope: runScope, ownerKey: composerOwnerKey(runScope, runId ?? null), runId,
        visible: true, expanded: true, pendingNewChat: !runId });
      showConversation(runScope, runId, replaceRoute);
    } catch (reason) {
      if (isCurrentOpening()) {
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(message);
        toast.error(message);
      }
    } finally {
      if (revision === openingRevision.current) setOpening(null);
    }
  }, [captureScope, takeRightEdge, showConversation, commitState, activeContext]);

  const openTool = useCallback((result: McpAppToolOpen, automatic = false) => {
    const scope = hostRef.current?.runId === result.runId ? hostRef.current.scope : captureScope();
    const ownerKey = composerOwnerKey(scope, result.runId);
    // A result in an old transcript may be opened explicitly, but never steals
    // the visible conversation merely because its row mounted.
    if (automatic && composerKey !== ownerKey) return;
    const current = stateRef.current;
    const entry = entries.find((app) => sameMcpApp(app, result.app));
    const app: McpAppPanelDocument["app"] = entry ?? {
      id: JSON.stringify([result.app.server, result.app.resourceUri, result.app.connectorId ?? null, result.app.linkId ?? null]),
      name: result.app.appName ?? result.title, server: result.app.server, tool: result.app.tool,
      resourceUri: result.app.resourceUri, connectorId: result.app.connectorId, linkId: result.app.linkId,
      entrypoints: ["thread"], preferredModelDisplayMode: result.app.preferredModelDisplayMode ?? "fullscreen",
    };
    const reuse = current && sameMcpApp(current.document.app, app) &&
      current.scope.backendId === scope.backendId && current.scope.spaceId === scope.spaceId && current.scope.mode === scope.mode;
    const document: McpAppPanelDocument = reuse
      ? { ...current.document, input: result.input ?? {}, output: result.output }
      : { id: crypto.randomUUID(), app: { ...app, originCallId: result.app.originCallId },
          resourceRunId: result.runId, input: result.input ?? {}, output: result.output };
    const next: PanelState = { document, scope, ownerKey, runId: result.runId, visible: true,
      expanded: !!(reuse && current.visible && current.ownerKey === ownerKey && current.expanded) };
    ++openingRevision.current;
    setOpening(null);
    takeRightEdge();
    commitState(next);
    rememberRun(next, result.runId);
    if (!automatic) showConversation(scope, result.runId);
  }, [captureScope, composerKey, entries, takeRightEdge, rememberRun, showConversation, commitState]);

  const attachRun = useCallback((fromKey: string, runId: string, scope: McpAppScope) => {
    const current = stateRef.current;
    if (!current || current.ownerKey !== fromKey) return;
    const ownerKey = composerOwnerKey(scope, runId);
    if (ownerKey !== fromKey) {
      const workspace = store.getState().workspace;
      const items = (workspace.composerContextKey === fromKey ? workspace.contextItems : workspace.contextItemsByKey[fromKey] ?? [])
        .filter((item) => item.kind === "mcp-app" && item.sessionId === current.document.id);
      if (items.length) {
        dispatch(replaceMcpAppContext({ key: fromKey, sessionId: current.document.id, items: [] }));
        dispatch(replaceMcpAppContext({ key: ownerKey, sessionId: current.document.id, items }));
      }
    }
    const next = { ...current, scope, ownerKey, runId, pendingNewChat: false };
    commitState(next);
    rememberRun(next, runId);
  }, [rememberRun, commitState, dispatch]);

  const registerConversation = useCallback((host: McpAppConversationHost) => {
    hostRef.current = host;
    const current = stateRef.current;
    if (current?.pendingNewChat && sameMcpAppScope(current.scope, host.scope)) {
      dispatch(openNewRunTab());
      commitState({ ...current, pendingNewChat: false });
    }
    return () => { if (hostRef.current === host) hostRef.current = null; };
  }, [dispatch, commitState]);

  const newChat = useCallback(() => {
    const current = stateRef.current;
    if (!current || sendingRef.current) return;
    const scope = captureScope();
    const ownerKey = composerOwnerKey(scope, null);
    const items = (store.getState().workspace.contextItemsByKey[current.ownerKey] ?? [])
      .filter((item) => item.kind === "mcp-app" && item.sessionId === current.document.id);
    dispatch(replaceMcpAppContext({ key: current.ownerKey, sessionId: current.document.id, items: [] }));
    dispatch(replaceMcpAppContext({ key: ownerKey, sessionId: current.document.id, items }));
    dispatch(setMcpAppRunId({ key: mcpAppConversationKey(scope, current.document.app.id), runId: null }));
    dispatch(openNewRunTab());
    commitState({ ...current, scope, ownerKey, runId: undefined, pendingNewChat: true, visible: true });
    setChatMode("input");
    setChatVisible(true);
    showConversation(scope);
  }, [captureScope, dispatch, showConversation, commitState]);

  const sendMessage = useCallback(async (content: unknown, options?: McpAppMessageOptions) => {
    const current = stateRef.current;
    const host = hostRef.current;
    if (!current?.visible || !host || current.ownerKey !== host.ownerKey || !sameMcpAppScope(current.scope, host.scope)) {
      throw new Error("Open this app's conversation before sending a message");
    }
    if (sendingRef.current) throw new Error("Wait for the current message to be sent");
    sendingRef.current = true;
    try {
      const runId = await host.send(mcpAppMessageText(content), options);
      if (!runId) throw new Error("Could not send the message; your draft is still available");
      attachRun(current.ownerKey, runId, host.scope);
      setChatMode("details");
    } finally { sendingRef.current = false; }
  }, [attachRun]);

  const updateModelContext = useCallback(async (value: unknown) => {
    const current = stateRef.current;
    if (!current) return null;
    const context = { ...normalizeMcpAppContext(value), updateId: crypto.randomUUID() };
    const items = mcpAppContextItems(current.document.id, current.document.app.name, context);
    dispatch(replaceMcpAppContext({ key: current.ownerKey, sessionId: current.document.id, items }));
    return items.length ? context : null;
  }, [dispatch]);
  useEffect(() => {
    const id = state?.document.id;
    if (!id) return;
    return () => {
      const workspace = store.getState().workspace;
      for (const [key, items] of Object.entries(workspace.contextItemsByKey)) {
        if (items.some((item) => item.kind === "mcp-app" && item.sessionId === id))
          dispatch(replaceMcpAppContext({ key, sessionId: id, items: [] }));
      }
    };
  }, [state?.document.id, dispatch]);

  const appContext = useCallback((ownerKey: string): ContextItem[] => {
    const current = stateRef.current;
    if (!current?.visible || ownerKey !== current.ownerKey) return [];
    const app = current.document.app;
    return [{ kind: "mcp-app", id: `${current.document.id}:app`, sessionId: current.document.id,
      appName: app.name, updateId: "app", label: app.name, hidden: true,
      block: { type: "text", text: `Active app: ${app.name}\nMCP server: ${app.server}\nEntrypoint tool: ${app.tool}\nUI resource: ${app.resourceUri}\nUse this app's tools and the attached app context for requests about the open canvas.` } }];
  }, []);

  const isOpen = !!state?.visible && state.scope.backendId === backendId && state.scope.spaceId === activeSpaceId &&
    state.scope.providerId === provider.providerId && state.scope.mode === mode && state.ownerKey === composerKey;
  const ownItems = state ? (state.ownerKey === composerKey ? contextItems : contextItemsByKey[state.ownerKey]) : undefined;
  const documentId = state?.document.id;
  const modelContext = useMemo(() => documentId ? mcpAppContextState((ownItems ?? []).filter((item) => item.kind === "mcp-app"), documentId) : null,
    [ownItems, documentId]);
  const close = useCallback(() => {
    ++openingRevision.current;
    setOpening(null);
    const current = stateRef.current;
    commitState(current ? { ...current, visible: false } : null);
  }, [commitState]);
  useEffect(() => store.subscribe(() => {
    const settings = store.getState().appSettings;
    if (stateRef.current?.visible && (settings.browserPanelOpen || settings.documentViewerOpen || settings.rightPanelOpen)) close();
  }), [close]);
  const toggleExpanded = useCallback(() => {
    const current = stateRef.current;
    commitState(current ? { ...current, expanded: !current.expanded } : null);
    if (current && !current.expanded) setChatMode("input");
    setChatVisible(true);
  }, [commitState]);

  const visibleInWorkspace = isOpen && !anotherPanelOpen && isWorkspaceRoute(pathname);
  const isExpanded = visibleInWorkspace && !!state?.expanded;
  useLayoutEffect(() => {
    if (isExpanded && !sidebarCollapsed) dispatch(setSidebarCollapsed(true));
  }, [isExpanded, sidebarCollapsed, dispatch]);
  const value: McpAppPanelValue = { document: state?.document ?? null, scope: state?.scope ?? null,
    ownerKey: state?.ownerKey ?? null, runId: state?.runId, isOpen: visibleInWorkspace, isExpanded,
    width, setWidth, chatMode, setChatMode, chatVisible, setChatVisible, chatHost, setChatHost, opening, error,
    openGlobal, openTool, close, toggleExpanded, newChat, registerConversation, attachRun, sendMessage,
    updateModelContext, modelContext, appContext };
  return <Context.Provider value={value}>
    <McpAppToolOpenerProvider openTool={openTool}>{children}</McpAppToolOpenerProvider>
  </Context.Provider>;
}

export function useMcpAppPanel(): McpAppPanelValue | null { return useContext(Context); }
