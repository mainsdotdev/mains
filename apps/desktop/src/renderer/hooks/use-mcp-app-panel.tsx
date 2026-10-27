import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { McpAppEntrypoint, McpAppToolOpen, OpenMcpAppExtensionResponse } from "@mains/contracts/mcp-apps";
import { McpAppToolOpenerProvider } from "./use-mcp-app-tool-opener";
import type { FloatingChatMode } from "../../shared/floating-chat";
import { toast } from "@/components/ui";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { store } from "@/lib/redux";
import { appApi } from "@/lib/transport";
import { BROWSER_PANEL_WIDTH_MIN, BROWSER_PANEL_WIDTH_MAX, clamp, isWorkspaceRoute } from "@/lib/layout";
import { setBrowserPanelWidth, setRightPanelOpen, setSessionPanelOpen } from "@/lib/redux/slices/appSettingsSlice";
import { openPreviewTab, transferPreviewTab } from "@/lib/redux/slices/previewSlice";
import { openNewRunTab, replaceMcpAppContext, setMcpAppRunId, setPendingRunId, setSelectedCollectionId } from "@/lib/redux/slices/workspaceSlice";
import { useActiveSpace } from "./use-active-space";
import { useModeConfig } from "./use-mode-config";
import { useSpaceProviderVariant } from "./use-space-provider-variant";
import { useMcpAppExtensions } from "./use-mcp-app-extensions";
import { useWorkspaceData } from "@/features/workspace/hooks/use-workspace-data";
import { composerOwnerKey, mcpAppConversationKey } from "@/features/workspace/lib/ui-context";
import { previewOwnerKey } from "@/features/workspace/lib/preview-tabs";
import { sameMcpApp, sameMcpAppScope, mcpAppConversationPath, type McpAppScope } from "@/features/workspace/lib/mcp-app-panel";
import { hasUsableMcpAppResult } from "@/features/workspace/lib/mcp-app-tool-result";
import { McpAppCompatibilityNotice } from "@/features/workspace/components/mcp-app-compatibility-notice";
import { mcpAppCompatibility, mcpAppPath } from "@/lib/mcp-app-extensions";
import { mcpAppContextItems, mcpAppContextState, mcpAppMessageText, normalizeMcpAppContext,
  type McpAppMessageOptions, type McpAppModelContextState } from "@/features/workspace/lib/mcp-app-context";
import type { ContextItem } from "@/features/workspace/lib/composer-context";
import { usePreviewPanel } from "./use-preview-panel";

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
  previewKey: string;
  chatMode: FloatingChatMode;
  chatVisible: boolean;
  chatHost: HTMLDivElement | null;
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
const InstancesContext = createContext<McpAppPanelValue[]>([]);
export const McpAppInstanceProvider = Context.Provider;
export function useMcpAppInstances() { return useContext(InstancesContext); }

/** Open app instances retain their connection and conversation independently of selection. */
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
  const groups = useAppSelector((s) => s.preview.byOwner);
  const width = useAppSelector((s) => s.appSettings.browserPanelWidth);
  const { workspaceId } = useWorkspaceData(provider.providerId, mode);
  const { entries } = useMcpAppExtensions();
  const preview = usePreviewPanel();
  const [panels, setPanels] = useState<Record<string, PanelState>>({});
  const panelsRef = useRef(panels);
  const releaseDocument = useCallback((document: McpAppPanelDocument) => {
    if (document.sessionId) void window.api.mcpApps.closeExtension({ sessionId: document.sessionId }).catch(() => {});
    const workspace = store.getState().workspace;
    for (const [key, items] of Object.entries(workspace.contextItemsByKey))
      if (items.some((item) => item.kind === "mcp-app" && item.sessionId === document.id))
        dispatch(replaceMcpAppContext({ key, sessionId: document.id, items: [] }));
  }, [dispatch]);
  // Sessions are created by openGlobal, so their lifetime belongs to the
  // registry. A per-tab effect cleanup also runs on StrictMode's mount replay.
  useEffect(() => {
    const releaseAll = () => { Object.values(panelsRef.current).forEach((panel) => releaseDocument(panel.document)); };
    window.addEventListener("beforeunload", releaseAll);
    return () => { window.removeEventListener("beforeunload", releaseAll); releaseAll(); };
  }, [releaseDocument]);
  const commit = useCallback((panel: PanelState) => {
    const next = { ...panelsRef.current, [panel.document.id]: panel };
    panelsRef.current = next;
    setPanels(next);
  }, []);
  const update = useCallback((id: string, patch: Partial<PanelState>) => {
    const current = panelsRef.current[id];
    if (!current || (Object.keys(patch).length === 1 && "chatHost" in patch && current.chatHost === patch.chatHost)) return;
    commit({ ...current, ...patch });
  }, [commit]);
  const activeContext = `${backendId}/${activeSpaceId}/${provider.providerId}/${mode}`;
  const activeContextRef = useRef(activeContext);
  const pathnameRef = useRef(pathname);
  useLayoutEffect(() => { activeContextRef.current = activeContext; pathnameRef.current = pathname; }, [activeContext, pathname]);
  const hostRef = useRef<McpAppConversationHost | null>(null);
  const openingRevision = useRef(0);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(new Set<string>());
  const activeId = preview.activeTab?.kind === "app" ? preview.activeTab.id : "";

  const captureScope = useCallback((): McpAppScope => ({
    backendId, spaceId: activeSpaceId, providerId: provider.providerId, mode,
    workspaceId: mode === "developer" ? workspaceId : undefined,
    collectionId: mode === "developer" ? null : store.getState().workspace.selectedCollectionId,
  }), [backendId, activeSpaceId, provider.providerId, mode, workspaceId]);
  const showConversation = useCallback((scope: McpAppScope, runId?: string, replace = false) => {
    dispatch(setSelectedCollectionId(scope.collectionId ?? null));
    if (runId) dispatch(setPendingRunId(runId));
    navigate(mcpAppConversationPath(scope, runId), { replace });
  }, [dispatch, navigate]);
  const reveal = useCallback((panel: PanelState) => {
    dispatch(setRightPanelOpen(false));
    dispatch(setSessionPanelOpen(false));
    dispatch(openPreviewTab({ ownerKey: panel.previewKey, tab: { kind: "app", id: panel.document.id, title: panel.document.app.name } }));
  }, [dispatch]);
  const rememberRun = useCallback((panel: PanelState, runId: string) => {
    dispatch(setMcpAppRunId({ key: mcpAppConversationKey(panel.scope, panel.document.app.id), runId }));
  }, [dispatch]);
  const createPanel = (document: McpAppPanelDocument, scope: McpAppScope, runId?: string): PanelState => {
    const ownerKey = composerOwnerKey(scope, runId ?? null);
    return { document, scope, ownerKey, runId, previewKey: previewOwnerKey(scope, ownerKey),
      chatMode: "input", chatVisible: true, chatHost: null };
  };

  const openGlobal = useCallback(async (app: McpAppEntrypoint) => {
    const scope = captureScope();
    const current = Object.values(panelsRef.current).find((panel) => sameMcpAppScope(panel.scope, scope) && sameMcpApp(panel.document.app, app));
    setError(null);
    const revision = ++openingRevision.current;
    const openingPath = pathnameRef.current;
    const replace = openingPath.startsWith("/apps/");
    const isCurrent = () => revision === openingRevision.current && activeContext === activeContextRef.current && openingPath === pathnameRef.current;
    if (current) {
      setOpening(null);
      reveal(current);
      showConversation(current.scope, current.runId, replace);
      return;
    }
    setOpening(app.id);
    try {
      let runId: string | undefined = store.getState().workspace.mcpAppRunIdByKey[mcpAppConversationKey(scope, app.id)];
      let runScope = scope;
      if (runId) {
        const response = await appApi.runs.getById(runId);
        const run = response.success ? response.data : null;
        if (!run || run.providerId !== scope.providerId || run.mode !== scope.mode || run.spaceId !== scope.spaceId)
          throw new Error("This app's conversation is unavailable. Open the app from a conversation to start again.");
        if (scope.mode === "developer" && run.workspaceId !== scope.workspaceId) runId = undefined;
        else runScope = { ...scope, workspaceId: run.workspaceId ?? undefined, collectionId: run.collectionId ?? null };
      }
      if (!isCurrent()) return;
      const opened = await window.api.mcpApps.openExtension({ providerId: scope.providerId, entrypointId: app.id });
      if (!opened.success) throw new Error(opened.error);
      const session = opened.data as OpenMcpAppExtensionResponse;
      if (!isCurrent()) { await window.api.mcpApps.closeExtension({ sessionId: session.sessionId }); return; }
      const panel = { ...createPanel({ id: crypto.randomUUID(), app: session.app, sessionId: session.sessionId, input: {}, output: session.output }, runScope, runId), pendingNewChat: !runId };
      commit(panel);
      reveal(panel);
      showConversation(runScope, runId, replace);
    } catch (reason) {
      if (isCurrent()) { const message = reason instanceof Error ? reason.message : String(reason); setError(message); toast.error(message); }
    } finally { if (revision === openingRevision.current) setOpening(null); }
  }, [captureScope, activeContext, commit, reveal, showConversation]);

  const openTool = useCallback((result: McpAppToolOpen, automatic = false) => {
    if (!hasUsableMcpAppResult(result.output)) return;
    const scope = hostRef.current?.runId === result.runId ? hostRef.current.scope : captureScope();
    const ownerKey = composerOwnerKey(scope, result.runId);
    if (automatic && composerKey !== ownerKey) return;
    const app: McpAppPanelDocument["app"] = entries.find((entry) => sameMcpApp(entry, result.app)) ?? {
      id: JSON.stringify([result.app.server, result.app.resourceUri, result.app.connectorId ?? null, result.app.linkId ?? null]),
      name: result.app.appName ?? result.title, server: result.app.server, tool: result.app.tool,
      resourceUri: result.app.resourceUri, connectorId: result.app.connectorId, linkId: result.app.linkId,
      entrypoints: ["thread"], preferredModelDisplayMode: result.app.preferredModelDisplayMode ?? "fullscreen",
    };
    const current = Object.values(panelsRef.current).find((panel) => panel.ownerKey === ownerKey &&
      sameMcpAppScope(panel.scope, scope) && sameMcpApp(panel.document.app, app));
    const panel = current ? { ...current, document: { ...current.document, input: result.input ?? {}, output: result.output } }
      : createPanel({ id: crypto.randomUUID(), app: { ...app, originCallId: result.app.originCallId },
          resourceRunId: result.runId, input: result.input ?? {}, output: result.output }, scope, result.runId);
    ++openingRevision.current;
    setOpening(null);
    commit(panel);
    reveal(panel);
    rememberRun(panel, result.runId);
    if (!automatic) showConversation(scope, result.runId);
  }, [captureScope, composerKey, entries, commit, reveal, rememberRun, showConversation]);

  const attachRun = useCallback((fromKey: string, runId: string, scope: McpAppScope) => {
    for (const current of Object.values(panelsRef.current)) {
      if (current.ownerKey !== fromKey || !sameMcpAppScope(current.scope, scope)) continue;
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
      const previewKey = previewOwnerKey(scope, ownerKey);
      dispatch(transferPreviewTab({ fromKey: current.previewKey, toKey: previewKey, id: current.document.id }));
      const next = { ...current, scope, ownerKey, runId, previewKey, pendingNewChat: false };
      commit(next);
      rememberRun(next, runId);
    }
  }, [commit, rememberRun, dispatch]);
  const registerConversation = useCallback((host: McpAppConversationHost) => {
    hostRef.current = host;
    const current = Object.values(panelsRef.current).find((panel) => panel.pendingNewChat && sameMcpAppScope(panel.scope, host.scope));
    if (current) { dispatch(openNewRunTab()); update(current.document.id, { pendingNewChat: false }); }
    return () => { if (hostRef.current === host) hostRef.current = null; };
  }, [dispatch, update]);

  const newChat = useCallback((id: string) => {
    const current = panelsRef.current[id];
    if (!current || sending.current.has(id)) return;
    const scope = current.scope;
    const ownerKey = composerOwnerKey(scope, null);
    const items = (store.getState().workspace.contextItemsByKey[current.ownerKey] ?? []).filter((item) => item.kind === "mcp-app" && item.sessionId === id);
    dispatch(replaceMcpAppContext({ key: current.ownerKey, sessionId: id, items: [] }));
    dispatch(replaceMcpAppContext({ key: ownerKey, sessionId: id, items }));
    dispatch(setMcpAppRunId({ key: mcpAppConversationKey(scope, current.document.app.id), runId: null }));
    dispatch(openNewRunTab());
    const previewKey = previewOwnerKey(scope, ownerKey);
    dispatch(transferPreviewTab({ fromKey: current.previewKey, toKey: previewKey, id }));
    commit({ ...current, ownerKey, previewKey, runId: undefined, pendingNewChat: true, chatMode: "input", chatVisible: true });
    showConversation(scope);
  }, [dispatch, commit, showConversation]);
  const sendMessage = useCallback(async (id: string, content: unknown, options?: McpAppMessageOptions) => {
    const current = panelsRef.current[id];
    const host = hostRef.current;
    if (!current || !host || current.ownerKey !== host.ownerKey || !sameMcpAppScope(current.scope, host.scope))
      throw new Error("Open this app's conversation before sending a message");
    if (sending.current.has(id)) throw new Error("Wait for the current message to be sent");
    sending.current.add(id);
    try {
      const runId = await host.send(mcpAppMessageText(content), options);
      if (!runId) throw new Error("Could not send the message; your draft is still available");
      attachRun(current.ownerKey, runId, host.scope);
      update(id, { chatMode: "details" });
    } finally { sending.current.delete(id); }
  }, [attachRun, update]);
  const updateModelContext = useCallback(async (id: string, value: unknown) => {
    const current = panelsRef.current[id];
    if (!current) return null;
    const context = { ...normalizeMcpAppContext(value), updateId: crypto.randomUUID() };
    const items = mcpAppContextItems(id, current.document.app.name, context);
    dispatch(replaceMcpAppContext({ key: current.ownerKey, sessionId: id, items }));
    return items.length ? context : null;
  }, [dispatch]);
  const appContext = useCallback((ownerKey: string): ContextItem[] => {
    const state = store.getState();
    return Object.values(panelsRef.current).flatMap((panel) => {
      const group = state.preview.byOwner[panel.previewKey];
      if (ownerKey !== panel.ownerKey || !group?.open || group.activeTabId !== panel.document.id) return [];
      const app = panel.document.app;
      return [{ kind: "mcp-app" as const, id: `${panel.document.id}:app`, sessionId: panel.document.id,
        appName: app.name, updateId: "app", label: app.name, hidden: true,
        block: { type: "text" as const, text: `Active app: ${app.name}\nMCP server: ${app.server}\nEntrypoint tool: ${app.tool}\nUI resource: ${app.resourceUri}\nUse this app's tools and the attached app context for requests about the open canvas.` } }];
    });
  }, []);
  const hidePreview = preview.hide;
  const close = useCallback(() => { ++openingRevision.current; setOpening(null); hidePreview(); }, [hidePreview]);
  useEffect(() => () => { openingRevision.current++; }, []);
  useEffect(() => {
    const ids = new Set(Object.values(groups).flatMap((group) => group.tabs.filter((tab) => tab.kind === "app").map((tab) => tab.id)));
    const removed = Object.values(panelsRef.current).filter((panel) => !ids.has(panel.document.id));
    const next = Object.fromEntries(Object.entries(panelsRef.current).filter(([id]) => ids.has(id)));
    if (removed.length) {
      panelsRef.current = next;
      setPanels(next);
      removed.forEach((panel) => releaseDocument(panel.document));
    }
  }, [groups, releaseDocument]);

  const { instances, value } = useMemo(() => {
  function valueFor(panel?: PanelState): McpAppPanelValue {
    const id = panel?.document.id ?? "";
    const bound = { setChatMode: (chatMode: FloatingChatMode) => update(id, { chatMode }),
      setChatVisible: (chatVisible: boolean) => update(id, { chatVisible }),
      setChatHost: (chatHost: HTMLDivElement | null) => update(id, { chatHost }),
      sendMessage: (content: unknown, options?: McpAppMessageOptions) => sendMessage(id, content, options),
      updateModelContext: (value: unknown) => updateModelContext(id, value), newChat: () => newChat(id) };
    const isOpen = !!panel && preview.isOpen && activeId === id && panel.previewKey === preview.ownerKey && isWorkspaceRoute(pathname);
    const ownItems = panel ? (panel.ownerKey === composerKey ? contextItems : contextItemsByKey[panel.ownerKey]) : [];
    return { document: panel?.document ?? null, scope: panel?.scope ?? null, ownerKey: panel?.ownerKey ?? null, runId: panel?.runId,
      isOpen, isExpanded: isOpen && preview.isExpanded, width,
      setWidth: (next) => dispatch(setBrowserPanelWidth(clamp(next, BROWSER_PANEL_WIDTH_MIN, BROWSER_PANEL_WIDTH_MAX))),
      chatMode: panel?.chatMode ?? "input", chatVisible: !!panel?.chatVisible && !mcpAppCompatibility(panel?.document.app).notice,
      chatHost: panel?.chatHost ?? null, ...bound, opening, error, openGlobal, openTool, close,
      toggleExpanded: preview.toggleExpanded, registerConversation, attachRun, appContext,
      modelContext: panel ? mcpAppContextState((ownItems ?? []).filter((item) => item.kind === "mcp-app"), id) : null };
  }
  return { instances: Object.values(panels).map((panel) => valueFor(panel)), value: valueFor(panels[activeId]) };

  }, [panels, activeId, preview.isOpen, preview.isExpanded, preview.ownerKey, preview.toggleExpanded, pathname, composerKey, contextItems, contextItemsByKey, width, dispatch, update, sendMessage, updateModelContext, newChat, opening, error, openGlobal, openTool, close, registerConversation, attachRun, appContext]);
  const compatibilityApp = entries.find((app) => mcpAppPath(app) === pathname) ?? (preview.isOpen ? panels[activeId]?.document.app : undefined);
  return <Context.Provider value={value}>
    <InstancesContext.Provider value={instances}>
      <McpAppCompatibilityNotice key={activeContext} app={compatibilityApp} />
      <McpAppToolOpenerProvider openTool={openTool}>{children}</McpAppToolOpenerProvider>
    </InstancesContext.Provider>
  </Context.Provider>;
}

export function useMcpAppPanel(): McpAppPanelValue | null {
  const value = useContext(Context);
  const latest = useRef(value);
  useLayoutEffect(() => { latest.current = value; }, [value]);
  // Host callback identities stay stable while metadata and model context update.
  const id = value?.document?.id;
  const setChatHost = useCallback((node: HTMLDivElement | null) => { if (latest.current?.document?.id === id) latest.current?.setChatHost(node); }, [id]);
  const sendMessage = useCallback(async (content: unknown, options?: McpAppMessageOptions) => { if (latest.current?.document?.id !== id) throw new Error("This app tab is no longer active"); await latest.current?.sendMessage(content, options); }, [id]);
  const updateModelContext = useCallback(async (context: unknown) => latest.current?.document?.id === id ? latest.current?.updateModelContext(context) ?? null : null, [id]);
  if (!value) return null;
  return { ...value, setChatHost, sendMessage, updateModelContext };
}
