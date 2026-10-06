import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "@/components/ui";
import { useLocation, useNavigate } from "react-router-dom";
import { getProviderVariant } from "@/lib/provider-variants";
import type { ProviderVariant } from "@/lib/provider-variants";
import type { RefObject } from "react";
import {
  WorkspaceEmptyState,
  WorkspaceEvents,
  WorkspaceInput,
  WorkspaceTabs,
  TerminalSection,
  GoalSummaryBar,
  TodoSummaryBar,
} from "@/features/workspace/components";
import { ToolApprovalDialog } from "@/features/workspace/components/tools/tool-approval-dialog";
import { parseStructuralPlanSnapshot } from "@/features/workspace/components/todo-summary-bar";
import {
  useWorkspacePage,
  useToolApproval,
  useProviderAuthTerminal,
  PluginLogoProvider,
} from "@/features/workspace/hooks";
import { CONTENT_COLUMN_GUTTER } from "@/features/workspace/lib/content-column";
import { isFirstWorkspaceTabActive } from "@/features/workspace/lib/is-first-workspace-tab-active";
import { projectForNewChat } from "@/features/workspace/lib/run-collection-context";
import {
  useAbortRunMutation,
  useGetAccountQuery,
  useGetCollectionQuery,
  useGetProviderByIdQuery,
} from "@/lib/redux/api";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setContextItemsForKey } from "@/lib/redux/slices/workspaceSlice";
import { transferRightPaneContext } from "@/lib/redux/slices/appSettingsSlice";
import type { ContextItem } from "@/features/workspace/lib/composer-context";
import { useSetMainHeader } from "@/hooks/use-main-header";
import { useWorkspaceRouteTopRounding } from "@/hooks/use-workspace-route-top-rounding";
import { useBottomTerminal } from "@/hooks/use-bottom-terminal";
import { useBrowserPanel } from "@/hooks/use-browser-panel";
import { useMcpAppPanel } from "@/hooks/use-mcp-app-panel";
import { useMcpAppConversation } from "../hooks/use-mcp-app-conversation";
import { useVoiceChatPresence } from "../hooks/use-voice-chat-presence";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useModeConfig } from "@/hooks/use-mode-config";
import {
  isExitPlanApproval,
  respondToExitPlanApproval,
} from "@/features/workspace/lib/plan-approval";
import { WorkspaceReview } from "./workspace-review";
import { useSuppressBrowserView } from "@/hooks/use-suppress-browser-view";
import type { FloatingChatMode } from "../../../../shared/floating-chat";
import { FloatingChatOverlay } from "./floating-chat-overlay";
import { ComposerSendTargetSelect } from "./composer-send-target-select";
import { ChatHeader } from "./chat-header";
import { NewConversationContextSelect } from "./new-conversation-context-select";
import { floatingChatRunStatus } from "../lib/floating-chat-run-status";
import { store } from "@/lib/redux";
import { baseApi } from "@/lib/redux/api/baseApi";
import { serializeAttachments } from "@/features/workspace/lib/run-helpers";
import { deserializeBrowserChatUploads } from "@/features/workspace/lib/upload-bridge";
import type { UploadedFile } from "@/components/ui";
import type { BrowserChatUpload } from "../../../../shared/browser-chat-window";
import { getTransientUploadsForOwner } from "@/features/workspace/hooks/use-transient-uploads";
import { runOwnerKey } from "../../../../shared/ui-state-keys";
import type { ConversationQueue } from "@/lib/redux/slices/runQueueSlice";
import { queueForBrowserChat } from "../lib/run-queue-preview";
import type { RunSettingConfig, SettingsChangeSource } from "@mains/contracts/run-settings";

interface WorkspaceProviderPageProps {
  providerId: string;
  variant: ProviderVariant;
  /** Only the floating chat is mounted in the native child renderer. */
  browserChatOnly?: boolean;
}

export function WorkspaceProviderPage({
  providerId,
  variant,
  browserChatOnly = false,
}: WorkspaceProviderPageProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  // Per-variant page behavior comes straight from the descriptor table —
  // no props to forget or default divergently. Per-mode shape comes from its
  // sibling table the same way.
  const {
    planExit: planExitConfig,
    enableForkRun,
    enableSuggestions,
    label: providerLabel,
  } = getProviderVariant(variant);
  const modeConfig = useModeConfig();
  const selectedCollectionId = useAppSelector(
    (state) => state.workspace.selectedCollectionId,
  );
  const onboardingCompleted = useAppSelector(
    (state) => state.appSettings.onboardingCompleted,
  );
  const { data: account } = useGetAccountQuery();
  const showProjectContext =
    modeConfig.mode !== "developer" && selectedCollectionId !== null;
  const { data: selectedCollection } = useGetCollectionQuery(
    {
      id: selectedCollectionId ?? "",
      accountId: account?.id ?? "",
    },
    { skip: !account || !showProjectContext },
  );
  const newChatProject = projectForNewChat(
    modeConfig.mode,
    selectedCollectionId,
    selectedCollection,
  );
  const ws = useWorkspacePage(providerId, browserChatOnly);
  const changeConversationSettings = ws.setConversationSettings;
  const mcpPanel = useMcpAppPanel();
  const openMcpAppTool = mcpPanel?.openTool;
  useMcpAppConversation(ws);
  const { activeSpace } = useActiveSpace();
  const [abortRun] = useAbortRunMutation();
  const { data: providerData } = useGetProviderByIdQuery(providerId);
  useEffect(() => {
    if (browserChatOnly && providerData) {
      void window.api.browserChat.postAction({ type: "providerChanged", providerId });
    }
  }, [browserChatOnly, providerData, providerId]);
  const bottomTerminal = useBottomTerminal();
  const browserPanel = useBrowserPanel();
  const reviewActive = ws.activeTab === "review" && !!ws.currentWorkspace && modeConfig.showChangesTab;
  const reviewVisible = reviewActive && !browserPanel.isExpanded && !mcpPanel?.isExpanded;
  const [expandedReviewWorkspace, setExpandedReviewWorkspace] = useState<string | null>(null);
  const reviewExpanded = reviewVisible && expandedReviewWorkspace === ws.currentWorkspace?.id;
  const [reviewChatVisible, setReviewChatVisible] = useState(true);
  const [reviewChatMode, setReviewChatMode] = useState<FloatingChatMode>("input");
  const [reviewChatHost, setReviewChatHost] = useState<HTMLDivElement | null>(null);
  useSuppressBrowserView(reviewActive && reviewExpanded);
  const wasReviewActive = useRef(false);
  useEffect(() => {
    const entering = reviewActive && !wasReviewActive.current;
    wasReviewActive.current = reviewActive;
    if (!entering) return;
    // Review needs the main surface when an existing preview was expanded.
    if (reviewActive && browserPanel.isExpanded) browserPanel.toggleExpanded();
    if (reviewActive && mcpPanel?.isExpanded) mcpPanel.toggleExpanded();
  }, [reviewActive, browserPanel, mcpPanel]);
  const showReviewChat = useCallback(() => { setReviewChatVisible(true); setReviewChatMode("input"); }, []);
  const setChatDirectories = ws.setAdditionalDirectories;
  const submitChatSnapshot = ws.handleQueueSnapshot;
  const chatRunQueue = ws.runQueue;
  const chatComposerRunId = ws.composerRun?.id;
  const browserDirectoryKey = JSON.stringify(browserPanel.composerDirectories);
  useLayoutEffect(() => {
    if (browserChatOnly && browserDirectoryKey) setChatDirectories(JSON.parse(browserDirectoryKey) as string[]);
  }, [browserChatOnly, browserDirectoryKey, setChatDirectories]);
  const {
    isExpanded: browserExpanded,
    chatVisible: browserChatVisible,
    setChatMode: setBrowserChatMode,
    nativeOverlay,
    ownerKey: browserOwnerKey,
    chatMode: browserChatMode,
  } = browserPanel;
  const {
    activeTab: chatActiveTab,
    goal: chatDraft,
    selectedModel: chatSelectedModel,
    contextItems: chatContextItems,
    setGoal: setChatDraft,
    handleModelChange: changeChatModel,
    handleSelectRunTab: selectChatRunTab,
    handleExecute: executeChat,
    setUploadedFiles: setChatUploads,
  } = ws;
  const wasBrowserExpandedRef = useRef(false);
  const uploadRevisionRef = useRef(0);
  const browserQueueSubmitRef = useRef(false);
  const [browserQueueSubmitting, setBrowserQueueSubmitting] = useState(false);
  const [uploadSnapshot, setUploadSnapshot] = useState<{
    ownerKey: string;
    version: number;
    uploads: BrowserChatUpload[];
  }>({ ownerKey: "", version: 0, uploads: [] });
  const composerQueue = ws.runQueue?.queue;
  const [queueSnapshot, setQueueSnapshot] = useState<{ source: ConversationQueue; display: ConversationQueue } | null>(null);

  useEffect(() => {
    if (browserChatOnly || !nativeOverlay || !browserExpanded || !composerQueue) return;
    let active = true;
    void queueForBrowserChat(composerQueue, getTransientUploadsForOwner).then((display) => {
      if (active) setQueueSnapshot({ source: composerQueue, display });
    });
    return () => { active = false; };
  }, [browserChatOnly, nativeOverlay, browserExpanded, composerQueue]);

  useEffect(() => {
    if (browserChatOnly) return;
    let active = true;
    void serializeAttachments(ws.uploadedFiles).then((uploads) => {
      if (active) {
        setUploadSnapshot((previous) => ({
          ownerKey: browserOwnerKey,
          version: previous.version + 1,
          uploads,
        }));
      }
    }).catch(() => { /* Keep the current attachments when a file cannot be read. */ });
    return () => { active = false; };
  }, [browserChatOnly, browserOwnerKey, ws.uploadedFiles]);

  // The primary renderer owns the selected run, draft, and presentation mode.
  // The child window runs the same workspace UI against the same backend, with
  // these small UI-only values kept in step through local Electron IPC.
  useEffect(() => {
    if (browserChatOnly || !nativeOverlay || !browserExpanded ||
      !activeSpace || activeSpace.providerId !== providerId) return;
    const publish = () => {
      void window.api.browserChat.publishContext({
        route: location.pathname,
        activeTab: chatActiveTab,
        activeSpace,
        providerId,
        ownerKey: browserOwnerKey,
        mode: browserChatMode,
        draft: chatDraft,
        selectedModel: chatSelectedModel,
        conversationSettings: ws.conversationSettingsReady ? ws.conversationSettings : undefined,
        additionalDirectories: ws.additionalDirectories,
        selectedCollectionId,
        contextItems: chatContextItems,
        uploadsVersion: uploadSnapshot.version,
        uploads: uploadSnapshot.ownerKey === browserOwnerKey ? uploadSnapshot.uploads : [],
        runQueue: queueSnapshot && queueSnapshot.source === composerQueue ? queueSnapshot.display : composerQueue,
        draftRevision: composerQueue?.draftRevision,
        dark: document.documentElement.classList.contains("dark"),
        themeCss: document.getElementById("mains-app-theme")?.textContent ?? "",
        rootStyle: document.documentElement.style.cssText,
      });
    };
    publish();
    const observer = new MutationObserver(publish);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [
    browserChatOnly, nativeOverlay, browserExpanded,
    browserOwnerKey, browserChatMode, location.pathname,
    chatActiveTab, chatDraft, chatSelectedModel, chatContextItems,
    activeSpace, providerId, selectedCollectionId, uploadSnapshot, composerQueue, queueSnapshot, ws.additionalDirectories, ws.conversationSettings, ws.conversationSettingsReady,
  ]);

  useEffect(() => {
    if (browserChatOnly || !nativeOverlay) return;
    return window.api.browserChat.onAction((action) => {
      // A submission can finish after the browser was collapsed. Its run and
      // composer updates still belong to the parent; only presentation needs
      // an expanded browser.
      if (!browserExpanded && (action.type === "mode" || action.type === "pagePointerDown")) return;
      switch (action.type) {
        case "queueReorder":
          if (action.ownerKey === browserOwnerKey) chatRunQueue?.onReorder(action.orderedIds);
          break;
        case "queueSubmit":
          if (action.ownerKey === browserOwnerKey) {
            submitChatSnapshot({
              text: action.draft, contextItems: action.items as ContextItem[],
              files: deserializeBrowserChatUploads(action.uploads), model: action.model,
              conversationSettings: action.conversationSettings,
              additionalDirectories: action.additionalDirectories, editingId: action.editingId,
            });
          }
          break;
        case "queueAction":
          if (action.ownerKey !== browserOwnerKey) break;
          if (action.action === "steer" && action.id) chatRunQueue?.onSteer(action.id);
          if (action.action === "edit" && action.id) chatRunQueue?.onEdit(action.id);
          if (action.action === "remove" && action.id) chatRunQueue?.onRemove(action.id);
          if (action.action === "cancelEdit") chatRunQueue?.onCancelEdit();
          if (action.action === "resume") chatRunQueue?.onResume();
          if (action.action === "queueMode") chatRunQueue?.onModeChange("queue");
          if (action.action === "steerMode") chatRunQueue?.onModeChange("steer");
          if (action.action === "stop" && chatComposerRunId) void abortRun(chatComposerRunId);
          break;
        case "pagePointerDown":
          if (browserChatMode === "details") setBrowserChatMode("input");
          break;
        case "mode":
          setBrowserChatMode(action.mode);
          break;
        case "draft":
          if (action.ownerKey === browserOwnerKey) setChatDraft(action.draft);
          break;
        case "model":
          if (action.providerId === providerId && (!action.ownerKey || action.ownerKey === browserOwnerKey)) void changeChatModel(action.model, action.source);
          break;
        case "conversationSettings":
          if (action.ownerKey === browserOwnerKey) void changeConversationSettings(action.settings, action.source);
          break;
        case "directories":
          if (action.ownerKey === browserOwnerKey) setChatDirectories(action.directories);
          break;
        case "selectRun":
          if (action.ownerKey !== browserOwnerKey) break;
          dispatch(transferRightPaneContext({
            fromKey: action.ownerKey,
            toKey: runOwnerKey(store.getState().backends.activeBackendId ?? "local", action.runId),
          }));
          selectChatRunTab(action.runId);
          if (!modeConfig.showTabs) navigate(`/code/runs/${action.runId}`);
          break;
        case "openMcpApp":
          if (action.ownerKey === browserOwnerKey && action.result.runId === chatComposerRunId) {
            openMcpAppTool?.(action.result, action.automatic);
          }
          break;
        case "contextItems":
          if (action.ownerKey === browserOwnerKey) {
            dispatch(setContextItemsForKey({ key: action.ownerKey, items: action.items as ContextItem[] }));
          }
          break;
        case "providerChanged":
          if (action.providerId === providerId) {
            dispatch(baseApi.util.invalidateTags([{ type: "Providers", id: providerId }]));
          }
          break;
        case "uploads":
          if (action.ownerKey === browserOwnerKey) {
            setChatUploads(deserializeBrowserChatUploads(action.uploads));
          }
          break;
      }
    });
  }, [
    browserChatOnly, nativeOverlay, browserExpanded, browserChatMode,
    browserOwnerKey, setBrowserChatMode, modeConfig.showTabs,
    navigate, providerId, setChatDraft, changeChatModel, selectChatRunTab,
    setChatUploads, dispatch, openMcpAppTool, chatComposerRunId, chatRunQueue, submitChatSnapshot, setChatDirectories, abortRun, changeConversationSettings,
  ]);
  useLayoutEffect(() => {
    const enteringExpandedBrowser = browserExpanded && !wasBrowserExpandedRef.current;
    wasBrowserExpandedRef.current = browserExpanded;
    if (!browserChatOnly && enteringExpandedBrowser && browserChatVisible && ws.activeRunId) {
      setBrowserChatMode("details");
    }
  }, [browserChatOnly, browserExpanded, browserChatVisible, setBrowserChatMode, ws.activeRunId]);
  const authTerminal = useProviderAuthTerminal();
  const activeAuthTerminal =
    authTerminal.session?.providerId === providerId
      ? authTerminal.session
      : null;
  const showWorkspaceTerminal =
    !!ws.currentWorkspace && modeConfig.showTerminal;

  const { pendingApprovals, respond: respondToolApproval } = useToolApproval(
    ws.runs,
  );

  const useCenteredPromptLayout =
    (ws.showEmptyState && onboardingCompleted) || ws.showNewRunTab;

  const currentApproval = ws.activeRunId
    ? pendingApprovals.find((approval) => approval.runId === ws.activeRunId)
    : undefined;
  const currentPlanApproval = isExitPlanApproval(currentApproval)
    ? currentApproval
    : undefined;
  const currentStructuralPlan = useMemo(() => {
    const activeTurn = ws.currentTurns.find(
      (turn) => turn.status === "active",
    );
    return parseStructuralPlanSnapshot(
      activeTurn?.metadata?.codexPlan,
    );
  }, [ws.currentTurns]);

  const handleStop = useCallback(() => {
    if (browserChatOnly && ws.runQueue) {
      void window.api.browserChat.postAction({ type: "queueAction", ownerKey: browserOwnerKey, action: "stop" });
      return;
    }
    // On the editor tab there's no active run tab — stop the composer's
    // target run instead (the one whose running state the input reflects).
    const stopId = ws.activeRunId ?? ws.composerRun?.id;
    if (stopId) {
      abortRun(stopId);
    }
  }, [ws.activeRunId, ws.composerRun?.id, abortRun, browserChatOnly, ws.runQueue, browserOwnerKey]);

  const handleSuggestionSelect = useCallback(
    (suggestion: string) => {
      ws.setGoal(suggestion);
      ws.setAutoExecute(true);
    },
    [ws],
  );

  const handleApplyPlan = useCallback(async () => {
    if (planExitConfig) {
      const currentConfig = ws.conversationSettings.config;
      if (
        (currentConfig as Record<string, unknown>)[planExitConfig.key] ===
        planExitConfig.planValue
      ) {
        if (!await ws.handleSettingsConfigChange({ [planExitConfig.key]: planExitConfig.nextValue })) return;
      }
    }

    if (
      respondToExitPlanApproval(
        currentPlanApproval,
        true,
        respondToolApproval,
      )
    ) {
      return;
    }

    // A plan tool-call start can render a frame before its approval request
    // reaches renderer state. Never launch a second turn during that gap (or
    // while another tool approval is pending); the active run owns the plan.
    if (ws.composerRun?.status === "running" || ws.composerRun?.status === "queued") {
      return;
    }

    ws.setGoal("Execute the plan above.");
    ws.setAutoExecute(true);
  }, [
    ws,
    planExitConfig,
    currentPlanApproval,
    respondToolApproval,
  ]);

  const handleDismissPlan = useCallback(() => {
    respondToExitPlanApproval(
      currentPlanApproval,
      false,
      respondToolApproval,
    );
  }, [currentPlanApproval, respondToolApproval]);

  const tabBar = useMemo(
    () =>
      // Developer workspaces use their full strip; Work/Chat get one chat tab below.
      !modeConfig.showTabs || ws.showEmptyState || ws.isEmptyStatePending ? null : (
        <WorkspaceTabs
          variant={variant}
          runs={ws.runs}
          activeTab={ws.activeTab}
          hasSelectedFile={!!ws.selectedFile}
          fileName={ws.selectedFile?.name}
          issueTabs={ws.openIssueTabs}
          signalTabs={ws.openSignalTabs}
          noteTabs={ws.openNoteTabs}
          reviewTabOpen={ws.reviewTabOpen}
          onSelectReviewTab={ws.handleSelectReviewTab}
          onCloseReviewTab={ws.handleCloseReviewTab}
          onSelectEditorTab={ws.handleSelectEditorTab}
          onSelectRunTab={ws.handleSelectRunTab}
          onCloseTab={ws.handleCloseTab}
          onRenameRun={ws.handleRenameRun}
          onNewRun={ws.handleNewRun}
          onSelectIssueTab={ws.handleSelectIssueTab}
          onCloseIssueTab={ws.handleCloseIssueTab}
          onSelectSignalTab={ws.handleSelectSignalTab}
          onCloseSignalTab={ws.handleCloseSignalTab}
          onSelectNoteTab={ws.handleSelectNoteTab}
          onCloseNoteTab={ws.handleCloseNoteTab}
          onCloseEditorTab={ws.handleCloseEditorTab}
          showNewRunTab={ws.showNewRunTab}
          onSelectNewRunTab={ws.handleSelectNewRunTab}
          onCloseNewRunTab={ws.handleCloseNewRunTab}
        />
      ),
    [
      variant,
      modeConfig.showTabs,
      ws.showEmptyState,
      ws.isEmptyStatePending,
      ws.runs,
      ws.activeTab,
      ws.selectedFile,
      ws.openIssueTabs,
      ws.openSignalTabs,
      ws.openNoteTabs,
      ws.reviewTabOpen,
      ws.handleSelectReviewTab,
      ws.handleCloseReviewTab,
      ws.handleSelectEditorTab,
      ws.handleSelectRunTab,
      ws.handleCloseTab,
      ws.handleRenameRun,
      ws.handleNewRun,
      ws.handleSelectIssueTab,
      ws.handleCloseIssueTab,
      ws.handleSelectSignalTab,
      ws.handleCloseSignalTab,
      ws.handleSelectNoteTab,
      ws.handleCloseNoteTab,
      ws.handleCloseEditorTab,
      ws.showNewRunTab,
      ws.handleSelectNewRunTab,
      ws.handleCloseNewRunTab,
    ],
  );

  const isFirstTabActive = isFirstWorkspaceTabActive({
    selectedFile: ws.selectedFile,
    activeTab: ws.activeTab,
    openIssueTabs: ws.openIssueTabs,
    openSignalTabs: ws.openSignalTabs,
    openNoteTabs: ws.openNoteTabs,
    reviewTabOpen: ws.reviewTabOpen,
    runs: ws.runs,
    showNewRunTab: ws.showNewRunTab,
  });

  const mainHeader = useMemo(
    () => modeConfig.showTabs
      ? tabBar
      : !ws.showEmptyState && !ws.isEmptyStatePending && ws.activeRunId
        ? <ChatHeader runId={ws.activeRunId} fallbackRun={ws.activeRun} variant={variant} />
        : null,
    [modeConfig.showTabs, tabBar, ws.showEmptyState, ws.isEmptyStatePending, ws.activeRunId, ws.activeRun, variant],
  );

  // Keep the full workspace strip until its run list is known, even when a
  // saved file/new-run tab already makes the destination non-empty.
  const headerPending = ws.isEmptyStatePending || (modeConfig.showTabs && !ws.runsLoaded);
  // An expanded browser owns the surface edge; workspace tabs must not square it.
  useSetMainHeader(
    mainHeader,
    !!mainHeader && !reviewExpanded && !browserPanel.isExpanded && (!modeConfig.showTabs || isFirstTabActive),
    headerPending,
  );

  const routeTopRounding = useWorkspaceRouteTopRounding();
  const floatingPanel = reviewVisible ? {
    isExpanded: true, chatVisible: reviewChatVisible, chatMode: reviewChatMode,
    chatHost: reviewChatHost, setChatMode: setReviewChatMode, nativeOverlay: false,
  } : mcpPanel?.isExpanded ? { ...mcpPanel, nativeOverlay: false } : browserPanel;
  useVoiceChatPresence(!browserChatOnly && !floatingPanel.isExpanded && !useCenteredPromptLayout
    && !ws.showEmptyState && !ws.isEmptyStatePending
    ? ws.activeRun?.id ?? null : null);
  const browserSelectedRun = reviewActive ? ws.composerRun ?? null : ws.activeRun?.id === ws.activeRunId
    ? ws.activeRun
    : null;
  const [browserStatusNowMs, setBrowserStatusNowMs] = useState(() => Date.now());
  const browserStatusClockActive = floatingPanel.isExpanded &&
    (browserChatOnly || !floatingPanel.nativeOverlay) &&
    floatingPanel.chatMode === "input" &&
    browserSelectedRun?.status === "running";
  useEffect(() => {
    if (!browserStatusClockActive) return;
    const timer = window.setInterval(() => setBrowserStatusNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [browserStatusClockActive]);
  const handleBrowserDraftChange = useCallback((draft: string) => {
    setChatDraft(draft);
    if (browserChatOnly) {
      void window.api.browserChat.postAction({
        type: "draft", ownerKey: browserOwnerKey, draft,
      });
    }
  }, [browserChatOnly, browserOwnerKey, setChatDraft]);
  const handleBrowserModelChange = useCallback((model: string, source?: SettingsChangeSource) => {
    if (!ws.conversationSettingsReady) return;
    changeChatModel(model, source);
    if (browserChatOnly) {
      void window.api.browserChat.postAction({ type: "model", providerId, ownerKey: browserOwnerKey, model, source });
    }
  }, [browserChatOnly, browserOwnerKey, providerId, changeChatModel, ws.conversationSettingsReady]);
  const handleBrowserSettingsChange = useCallback((patch: RunSettingConfig, source?: SettingsChangeSource) => {
    if (!ws.conversationSettingsReady) return false;
    const current = store.getState().workspace.conversationSettingsByKey[browserOwnerKey] ?? ws.conversationSettings;
    const next = { ...current, config: { ...current.config, ...patch } };
    if (browserChatOnly) {
      void ws.setConversationSettings(next, source);
      void window.api.browserChat.postAction({ type: "conversationSettings", ownerKey: browserOwnerKey, settings: next, source });
      return;
    }
    return ws.handleSettingsConfigChange(patch, source);
  }, [browserChatOnly, browserOwnerKey, ws]);
  const handleBrowserUploadsChange = useCallback((files: UploadedFile[]) => {
    setChatUploads(files);
    if (!browserChatOnly) return;
    const revision = ++uploadRevisionRef.current;
    void serializeAttachments(files).then((uploads) => {
      if (revision === uploadRevisionRef.current) {
        void window.api.browserChat.postAction({
          type: "uploads", ownerKey: browserOwnerKey, uploads,
        });
      }
    }).catch(() => { /* The file remains in the child composer for retry. */ });
  }, [browserChatOnly, browserOwnerKey, setChatUploads]);
  const handleBrowserDirectoriesChange = useCallback((directories: string[]) => {
    setChatDirectories(directories);
    if (browserChatOnly) void window.api.browserChat.postAction({ type: "directories", ownerKey: browserOwnerKey, directories });
  }, [browserChatOnly, browserOwnerKey, setChatDirectories]);
  const handleBrowserSubmit = useCallback(async () => {
    if (browserChatOnly && ws.runQueue && (ws.composerRun?.status === "running" || ws.composerRun?.status === "queued" || ws.runQueue.queue?.messages.length)) {
      if (browserQueueSubmitRef.current) return;
      browserQueueSubmitRef.current = true;
      setBrowserQueueSubmitting(true);
      const state = store.getState().workspace;
      const draft = state.draftTextByKey[browserOwnerKey] ?? "";
      const items = state.composerContextKey === browserOwnerKey ? state.contextItems : state.contextItemsByKey[browserOwnerKey] ?? [];
      const files = getTransientUploadsForOwner(browserOwnerKey);
      const editingId = ws.runQueue.queue?.editingId;
      try {
        const uploads = await serializeAttachments(files);
        const result = await window.api.browserChat.postAction({
          type: "queueSubmit", ownerKey: browserOwnerKey, draft, items, uploads, editingId,
          model: chatSelectedModel, additionalDirectories: ws.additionalDirectories,
          conversationSettings: ws.conversationSettings,
        });
        if (result.success && !editingId) {
          // Parent enqueues the frozen snapshot without replacing newer typing.
          const current = store.getState().workspace;
          if ((current.draftTextByKey[browserOwnerKey] ?? "") === draft) handleBrowserDraftChange("");
          const currentItems = current.composerContextKey === browserOwnerKey ? current.contextItems : current.contextItemsByKey[browserOwnerKey] ?? [];
          if (currentItems === items) {
            dispatch(setContextItemsForKey({ key: browserOwnerKey, items: [] }));
            void window.api.browserChat.postAction({ type: "contextItems", ownerKey: browserOwnerKey, items: [] });
          }
          if (getTransientUploadsForOwner(browserOwnerKey) === files) handleBrowserUploadsChange([]);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "The message could not be queued.");
      } finally {
        browserQueueSubmitRef.current = false;
        setBrowserQueueSubmitting(false);
      }
      return;
    }
    const submittedRunId = await executeChat();
    if (!browserChatOnly) return;
    const currentDraft = store.getState().workspace.draftTextByKey[browserOwnerKey] ?? "";
    void window.api.browserChat.postAction({
      type: "draft", ownerKey: browserOwnerKey, draft: currentDraft,
    });
    const remainingUploads = getTransientUploadsForOwner(browserOwnerKey);
    void serializeAttachments(remainingUploads).then((uploads) => {
      void window.api.browserChat.postAction({
        type: "uploads", ownerKey: browserOwnerKey, uploads,
      });
    }).catch(() => { /* The existing parent copy remains available. */ });
    // Parent context echoes can change the child's tab while execute awaits
    // IPC. Report the operation's result instead of inspecting that UI state.
    if (submittedRunId) {
      void window.api.browserChat.postAction({
        type: "selectRun", ownerKey: browserOwnerKey, runId: submittedRunId,
      });
    }
  }, [browserChatOnly, browserOwnerKey, executeChat, ws.runQueue, ws.composerRun?.status,
    ws.additionalDirectories, ws.conversationSettings, chatSelectedModel, handleBrowserDraftChange, handleBrowserUploadsChange, dispatch]);
  const handleBrowserComposerHeight = useCallback((height: number) => {
    if (browserChatOnly) {
      void window.api.browserChat.postAction({ type: "composerHeight", height });
    }
  }, [browserChatOnly]);
  const browserRunQueue = browserChatOnly && ws.runQueue ? {
    ...ws.runQueue,
    onSteer: (id: string) => { void window.api.browserChat.postAction({ type: "queueAction", ownerKey: browserOwnerKey, action: "steer", id }); },
    onEdit: (id: string) => { void window.api.browserChat.postAction({ type: "queueAction", ownerKey: browserOwnerKey, action: "edit", id }); },
    onRemove: (id: string) => { void window.api.browserChat.postAction({ type: "queueAction", ownerKey: browserOwnerKey, action: "remove", id }); },
    onCancelEdit: () => { void window.api.browserChat.postAction({ type: "queueAction", ownerKey: browserOwnerKey, action: "cancelEdit" }); },
    onResume: () => { void window.api.browserChat.postAction({ type: "queueAction", ownerKey: browserOwnerKey, action: "resume" }); },
    onModeChange: (mode: "queue" | "steer") => { void window.api.browserChat.postAction({ type: "queueAction", ownerKey: browserOwnerKey, action: mode === "queue" ? "queueMode" : "steerMode" }); },
    onReorder: (orderedIds: string[]) => { void window.api.browserChat.postAction({ type: "queueReorder", ownerKey: browserOwnerKey, orderedIds }); },
  } : ws.runQueue;
  const browserComposer = (browserChatOnly || !floatingPanel.nativeOverlay) && onboardingCompleted && !ws.isEmptyStatePending ? (
    <WorkspaceInput
      runQueue={browserRunQueue}
      goal={ws.goal}
      onGoalChange={handleBrowserDraftChange}
      onSubmit={handleBrowserSubmit}
      isLoading={ws.isLoading || browserQueueSubmitting}
      activeRun={ws.composerRun}
      canResume={ws.canResume ?? false}
      providerId={providerId}
      selectedModel={ws.selectedModel}
      onModelChange={handleBrowserModelChange}
      settingsConfig={ws.conversationSettings.config}
      settingsReady={ws.conversationSettingsReady}
      onSettingsConfigChange={handleBrowserSettingsChange}
      workspacePath={ws.currentWorkspace?.rootPath}
      projectId={ws.currentWorkspace?.projectId ?? undefined}
      uploadedFiles={ws.uploadedFiles}
      onUploadedFilesChange={handleBrowserUploadsChange}
      additionalDirectories={ws.additionalDirectories}
      onAdditionalDirectoriesChange={handleBrowserDirectoriesChange}
      onStop={handleStop}
      isNewRunTabActive={false}
      layout="floating"
      floatingChatMode={floatingPanel.chatMode}
      floatingStatusPlaceholder={floatingPanel.chatMode === "input"
        ? floatingChatRunStatus(ws.currentEvents, browserSelectedRun, browserStatusNowMs)
        : null}
      floatingAutoFocus={floatingPanel.chatMode === "details"}
      onFloatingFocus={() => floatingPanel.setChatMode("details")}
    />
  ) : null;

  const browserChat = floatingPanel.isExpanded && floatingPanel.chatVisible && floatingPanel.chatHost &&
    (browserChatOnly || !floatingPanel.nativeOverlay)
    ? createPortal(
        <FloatingChatOverlay
          title={browserSelectedRun?.title?.trim() || browserSelectedRun?.goal?.trim() || "New chat"}
          titleControl={reviewActive && ws.sendTarget
            ? <ComposerSendTargetSelect key={floatingPanel.chatMode} target={ws.sendTarget} onChange={ws.handleSendTargetChange} variant="title" />
            : undefined}
          iconTooltip={browserSelectedRun?.title?.trim() || "New run"}
          activity={browserSelectedRun?.status === "running" || browserSelectedRun?.status === "queued"
            ? browserSelectedRun.status : null}
          mode={floatingPanel.chatMode}
          onShowDetails={() => floatingPanel.setChatMode("details")}
          onMinimize={() => floatingPanel.setChatMode("icon")}
          onComposerHeightChange={browserChatOnly ? handleBrowserComposerHeight : undefined}
          composer={browserComposer}
        >
          {(browserSelectedRun || ws.isSubmitting) && (
            <>
              <div className="min-h-0 flex-1 overflow-hidden">
                <WorkspaceEvents
                  runs={ws.runs}
                  activeTab={reviewActive && browserSelectedRun ? browserSelectedRun.id : ws.activeTab}
                  currentEvents={ws.currentEvents}
                  isSubmitting={ws.isSubmitting}
                  currentWorkspace={ws.currentWorkspace}
                  eventsEndRef={ws.eventsEndRef as RefObject<HTMLDivElement>}
            history={ws.history}
                  issueTabs={ws.openIssueTabs}
                  signalTabs={ws.openSignalTabs}
                  turns={ws.currentTurns}
                  variant={variant}
                  onForkRun={enableForkRun ? ws.handleForkRun : undefined}
                  onSuggestionSelect={enableSuggestions ? handleSuggestionSelect : undefined}
                  onApplyPlan={handleApplyPlan}
                  onDismissPlan={handleDismissPlan}
                  hasPendingPlanApproval={!!currentPlanApproval}
                  floatingChat
                />
              </div>
              {currentApproval && !currentPlanApproval && (
                <div className="shrink-0 px-3">
                  <ToolApprovalDialog
                    request={currentApproval}
                    onRespond={respondToolApproval}
                    variant={variant}
                    maxHeight="40dvh"
                  />
                </div>
              )}
              {ws.currentWorkspace && !ws.showEmptyState && !ws.showNewRunTab && (
                <div className="shrink-0 px-3">
                  <GoalSummaryBar
                    providerId={providerId}
                    runId={browserSelectedRun?.id}
                    isRunning={browserSelectedRun?.status === "running"}
                    enabled={getProviderVariant(variant).supportsGoalMode}
                    rootPath={ws.currentWorkspace.rootPath}
                  />
                </div>
              )}
            </>
          )}
        </FloatingChatOverlay>,
        floatingPanel.chatHost,
      )
    : null;

  if (browserChatOnly) {
    return <PluginLogoProvider providerId={providerId}>{browserChat}</PluginLogoProvider>;
  }

  return (
    <PluginLogoProvider providerId={providerId}>
    {browserChat}
    {/* `relative` anchors the absolutely-positioned TodoSummaryBar toast so it
        centers over this content column (not the whole window — the embedded
        browser panel is a native view layered above the renderer). */}
    <div
      data-workspace-route=""
      className={`relative flex flex-col h-full ${routeTopRounding} overflow-hidden`}
    >
      {/* Separate painted panes leave the translucent shell visible between chat and terminal. */}
      <div className="flex min-h-0 flex-1 flex-col rounded-b-2xl bg-primary dark:bg-primary-950">
      {/* `content-inset` on the transcript and composer, but not on the
          terminal below them: the session box only covers the top-right of the
          content, so the terminal keeps the full width. */}
      <div className="content-inset flex-1 overflow-hidden noscrollbar min-h-0">
        {reviewVisible && ws.currentWorkspace ? <WorkspaceReview key={ws.currentWorkspace.id}
          workspaceId={ws.currentWorkspace.id} rootPath={ws.currentWorkspace.rootPath}
          isExpanded={reviewExpanded} onToggleExpanded={() => setExpandedReviewWorkspace(reviewExpanded ? null : ws.currentWorkspace!.id)}
          chatVisible={reviewChatVisible} onToggleChat={() => setReviewChatVisible(!reviewChatVisible)}
          setChatHost={setReviewChatHost} onCommentAdded={showReviewChat} />
          : floatingPanel.isExpanded ? null : useCenteredPromptLayout ? (
          <div
            className={`flex h-full min-h-0 flex-col items-center justify-center-safe gap-4 overflow-y-auto py-10 noscrollbar ${CONTENT_COLUMN_GUTTER}`}
          >
            <WorkspaceEmptyState />
            <div className="w-full flex flex-col items-center gap-2">
              <div className="mx-auto w-full max-w-210 ">
                <NewConversationContextSelect
                  workspace={ws.currentWorkspace}
                  project={newChatProject}
                  onChange={ws.handleNewConversationContextChange}
                  disabled={ws.isLoading}
                />
              </div>
              <WorkspaceInput
                runQueue={ws.runQueue}
                goal={ws.goal}
                onGoalChange={ws.setGoal}
                onSubmit={ws.handleExecute}
                onCreateVoiceConversation={ws.handleCreateVoiceConversation}
                isLoading={ws.isLoading}
                activeRun={ws.activeRun}
                canResume={ws.canResume ?? false}
                providerId={providerId}
                selectedModel={ws.selectedModel}
                onModelChange={ws.handleModelChange}
                settingsConfig={ws.conversationSettings.config}
                settingsReady={ws.conversationSettingsReady}
                onSettingsConfigChange={ws.handleSettingsConfigChange}
                workspacePath={ws.currentWorkspace?.rootPath}
                projectId={ws.currentWorkspace?.projectId ?? undefined}
                uploadedFiles={ws.uploadedFiles}
                onUploadedFilesChange={ws.setUploadedFiles}
                additionalDirectories={ws.additionalDirectories}
                onAdditionalDirectoriesChange={ws.setAdditionalDirectories}
                onStop={handleStop}
                isNewRunTabActive={ws.showNewRunTab}
                layout="centered"
              />
            </div>
          </div>
        ) : ws.showEmptyState || ws.isEmptyStatePending ? null : (
          <WorkspaceEvents
            runs={ws.runs}
            activeTab={ws.activeTab}
            currentEvents={ws.currentEvents}
            isSubmitting={ws.isSubmitting}
            currentWorkspace={ws.currentWorkspace}
            eventsEndRef={ws.eventsEndRef as RefObject<HTMLDivElement>}
            history={ws.history}
            issueTabs={ws.openIssueTabs}
            signalTabs={ws.openSignalTabs}
            turns={ws.currentTurns}
            variant={variant}
            onForkRun={enableForkRun ? ws.handleForkRun : undefined}
            onSuggestionSelect={
              enableSuggestions ? handleSuggestionSelect : undefined
            }
            onApplyPlan={handleApplyPlan}
            onDismissPlan={handleDismissPlan}
            hasPendingPlanApproval={!!currentPlanApproval}
          />
        )}
      </div>

      {/* Pinned just above the input rather than inline in the transcript:
          the transcript fills all remaining height, so an inline dialog left a
          large empty gap below it (short runs) or floated mid-scroll (long
          runs). Anchoring it here keeps it directly above the input and always
          reachable regardless of scroll position or conversation length. */}

      {/* Two boxes, not one: `content-inset` sets `padding-right` and wins the
          cascade over a `px-*` on the same element, so sharing them zeroes the
          composer's right gutter whenever no session box is docked — the column
          then hangs off the right edge while the left keeps its padding. */}
      <div className="content-inset">
      <div className={CONTENT_COLUMN_GUTTER}>
      {!floatingPanel.isExpanded && currentApproval &&
        !currentPlanApproval &&
        !ws.showEmptyState &&
        !ws.showNewRunTab && (
        <div className="w-full max-w-210 mx-auto">
          <ToolApprovalDialog
            request={currentApproval}
            onRespond={respondToolApproval}
            variant={variant}
          />
        </div>
      )}
      {/* Renders as a fixed toast-style pill at the top of the viewport (it
          positions itself; mounting here only controls gating). Shown only
          while the active run is running, so it disappears on completion.
          Gated on the run's status (which stays "running" for the whole run)
          rather than `isLoading` (which only tracks the brief start/continue
          IPC call, making the bar flash and vanish mid-run). */}
      {floatingPanel.isExpanded || ws.showEmptyState || ws.showNewRunTab || ws.activeRun?.status !== "running" ? null : (
        <TodoSummaryBar
          events={ws.currentEvents}
          structuralPlan={currentStructuralPlan}
          variant={variant}
        />
      )}

      {!floatingPanel.isExpanded && ws.currentWorkspace && !ws.showEmptyState && !ws.showNewRunTab && (
        <GoalSummaryBar
          providerId={providerId}
          runId={ws.activeRun?.id}
          isRunning={ws.activeRun?.status === "running"}
          enabled={getProviderVariant(variant).supportsGoalMode}
          rootPath={ws.currentWorkspace.rootPath}
        />
      )}

      {!floatingPanel.isExpanded && onboardingCompleted && !ws.showEmptyState && !ws.showNewRunTab && !ws.isEmptyStatePending ? (
        <WorkspaceInput
          runQueue={ws.runQueue}
          goal={ws.goal}
          onGoalChange={ws.setGoal}
          onSubmit={ws.handleExecute}
          onCreateVoiceConversation={ws.handleCreateVoiceConversation}
          isLoading={ws.isLoading}
          activeRun={ws.composerRun}
          canResume={ws.canResume ?? false}
          providerId={providerId}
          selectedModel={ws.selectedModel}
          onModelChange={ws.handleModelChange}
          settingsConfig={ws.conversationSettings.config}
          settingsReady={ws.conversationSettingsReady}
          onSettingsConfigChange={ws.handleSettingsConfigChange}
          sendTarget={ws.sendTarget}
          onSendTargetChange={ws.handleSendTargetChange}
          workspacePath={ws.currentWorkspace?.rootPath}
          projectId={ws.currentWorkspace?.projectId ?? undefined}
          uploadedFiles={ws.uploadedFiles}
          onUploadedFilesChange={ws.setUploadedFiles}
          additionalDirectories={ws.additionalDirectories}
          onAdditionalDirectoriesChange={ws.setAdditionalDirectories}
          onStop={handleStop}
          isNewRunTabActive={ws.showNewRunTab}
        />
      ) : null}
      </div>
      </div>
      </div>

      {(activeAuthTerminal || showWorkspaceTerminal) && (
        <TerminalSection
          id={
            activeAuthTerminal
              ? `auth-${providerId}`
              : ws.currentWorkspace!.id
          }
          rootPath={
            activeAuthTerminal
              ? undefined
              : ws.currentWorkspace!.rootPath
          }
          isOpen={activeAuthTerminal ? true : bottomTerminal.isOpen}
          title={
            activeAuthTerminal
              ? `Sign in to ${providerLabel}`
              : "Terminal"
          }
          pendingCommand={activeAuthTerminal?.pendingCommand}
          onPendingCommandSent={authTerminal.markCommandSent}
          onClose={
            activeAuthTerminal ? authTerminal.close : bottomTerminal.close
          }
        />
      )}
    </div>
    </PluginLogoProvider>
  );
}
