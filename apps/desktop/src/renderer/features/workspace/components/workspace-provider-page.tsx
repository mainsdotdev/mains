import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  useUpdateProviderMutation,
} from "@/lib/redux/api";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setContextItemsForKey } from "@/lib/redux/slices/workspaceSlice";
import { transferRightPaneContext } from "@/lib/redux/slices/appSettingsSlice";
import type { ContextItem } from "@/features/workspace/lib/composer-context";
import { useSetMainHeader } from "@/hooks/use-main-header";
import { useWorkspaceRouteTopRounding } from "@/hooks/use-workspace-route-top-rounding";
import { useBottomTerminal } from "@/hooks/use-bottom-terminal";
import { useBrowserPanel } from "@/hooks/use-browser-panel";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useModeConfig } from "@/hooks/use-mode-config";
import { ProjectIcon } from "@/components/layout/sidebar/project-icon";
import {
  isExitPlanApproval,
  respondToExitPlanApproval,
} from "@/features/workspace/lib/plan-approval";
import { FloatingChatOverlay } from "./floating-chat-overlay";
import { floatingChatRunStatus } from "../lib/floating-chat-run-status";
import { store } from "@/lib/redux";
import { baseApi } from "@/lib/redux/api/baseApi";
import { serializeAttachments } from "@/features/workspace/lib/run-helpers";
import { deserializeBrowserChatUploads } from "@/features/workspace/lib/upload-bridge";
import type { UploadedFile } from "@/components/ui";
import type { BrowserChatUpload } from "../../../../shared/browser-chat-window";
import { getTransientUploadsForOwner } from "@/features/workspace/hooks/use-transient-uploads";
import { runOwnerKey } from "../../../../shared/ui-state-keys";

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
  const ws = useWorkspacePage(providerId);
  const { activeSpace } = useActiveSpace();
  const [abortRun] = useAbortRunMutation();
  const { data: providerData } = useGetProviderByIdQuery(providerId);
  useEffect(() => {
    if (browserChatOnly && providerData) {
      void window.api.browserChat.postAction({ type: "providerChanged", providerId });
    }
  }, [browserChatOnly, providerData, providerId]);
  const [updateProvider] = useUpdateProviderMutation();
  const bottomTerminal = useBottomTerminal();
  const browserPanel = useBrowserPanel();
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
  const [uploadSnapshot, setUploadSnapshot] = useState<{
    ownerKey: string;
    version: number;
    uploads: BrowserChatUpload[];
  }>({ ownerKey: "", version: 0, uploads: [] });

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
        selectedCollectionId,
        contextItems: chatContextItems,
        uploadsVersion: uploadSnapshot.version,
        uploads: uploadSnapshot.ownerKey === browserOwnerKey ? uploadSnapshot.uploads : [],
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
    activeSpace, providerId, selectedCollectionId, uploadSnapshot,
  ]);

  useEffect(() => {
    if (browserChatOnly || !nativeOverlay) return;
    return window.api.browserChat.onAction((action) => {
      // A submission can finish after the browser was collapsed. Its run and
      // composer updates still belong to the parent; only presentation needs
      // an expanded browser.
      if (!browserExpanded && (action.type === "mode" || action.type === "pagePointerDown")) return;
      switch (action.type) {
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
          if (action.providerId === providerId) changeChatModel(action.model);
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
    setChatUploads, dispatch,
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
    // On the editor tab there's no active run tab — stop the composer's
    // target run instead (the one whose running state the input reflects).
    const stopId = ws.activeRunId ?? ws.composerRun?.id;
    if (stopId) {
      abortRun(stopId);
    }
  }, [ws.activeRunId, ws.composerRun?.id, abortRun]);

  const handleSuggestionSelect = useCallback(
    (suggestion: string) => {
      ws.setGoal(suggestion);
      ws.setAutoExecute(true);
    },
    [ws],
  );

  const handleApplyPlan = useCallback(async () => {
    if (providerData && planExitConfig) {
      const currentConfig = providerData.config ?? {};
      if (
        (currentConfig as Record<string, unknown>)[planExitConfig.key] ===
        planExitConfig.planValue
      ) {
        await updateProvider({
          id: providerId,
          payload: {
            config: {
              ...currentConfig,
              [planExitConfig.key]: planExitConfig.nextValue,
            },
          },
        });
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
    if (ws.activeRun?.status === "running" || ws.activeRun?.status === "queued") {
      return;
    }

    ws.setGoal("Execute the plan above.");
    ws.setAutoExecute(true);
  }, [
    ws,
    providerData,
    planExitConfig,
    providerId,
    updateProvider,
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
      // Chat/work render a single conversation with no tab strip; a null
      // header removes the whole header row (main-content degrades cleanly).
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
    runs: ws.runs,
    showNewRunTab: ws.showNewRunTab,
  });

  useSetMainHeader(tabBar, !ws.showEmptyState && !ws.isEmptyStatePending && isFirstTabActive);

  const routeTopRounding = useWorkspaceRouteTopRounding();
  const browserSelectedRun = ws.activeRun?.id === ws.activeRunId
    ? ws.activeRun
    : null;
  const [browserStatusNowMs, setBrowserStatusNowMs] = useState(() => Date.now());
  const browserStatusClockActive = browserPanel.isExpanded &&
    (browserChatOnly || !browserPanel.nativeOverlay) &&
    browserPanel.chatMode === "input" &&
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
  const handleBrowserModelChange = useCallback((model: string) => {
    changeChatModel(model);
    if (browserChatOnly) {
      void window.api.browserChat.postAction({ type: "model", providerId, model });
    }
  }, [browserChatOnly, providerId, changeChatModel]);
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
  const handleBrowserSubmit = useCallback(async () => {
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
  }, [browserChatOnly, browserOwnerKey, executeChat]);
  const handleBrowserComposerHeight = useCallback((height: number) => {
    if (browserChatOnly) {
      void window.api.browserChat.postAction({ type: "composerHeight", height });
    }
  }, [browserChatOnly]);
  const browserComposer = (browserChatOnly || !browserPanel.nativeOverlay) && onboardingCompleted && !ws.isEmptyStatePending ? (
    <WorkspaceInput
      goal={ws.goal}
      onGoalChange={handleBrowserDraftChange}
      onSubmit={handleBrowserSubmit}
      isLoading={ws.isLoading}
      activeRun={ws.composerRun}
      canResume={ws.canResume ?? false}
      providerId={providerId}
      selectedModel={ws.selectedModel}
      onModelChange={handleBrowserModelChange}
      sendTarget={null}
      workspacePath={ws.currentWorkspace?.rootPath}
      projectId={ws.currentWorkspace?.projectId ?? undefined}
      uploadedFiles={ws.uploadedFiles}
      onUploadedFilesChange={handleBrowserUploadsChange}
      onStop={handleStop}
      isNewRunTabActive={false}
      newChatProjectName={newChatProject?.name}
      newChatProjectIcon={newChatProject ? (
        <ProjectIcon icon={newChatProject.icon} projectName={newChatProject.name} />
      ) : undefined}
      layout="floating"
      floatingChatMode={browserPanel.chatMode}
      floatingStatusPlaceholder={browserPanel.chatMode === "input"
        ? floatingChatRunStatus(ws.currentEvents, browserSelectedRun, browserStatusNowMs)
        : null}
      floatingAutoFocus={browserPanel.chatMode === "details"}
      onFloatingFocus={() => browserPanel.setChatMode("details")}
    />
  ) : null;

  const browserChat = browserPanel.isExpanded && browserPanel.chatHost &&
    (browserChatOnly || !browserPanel.nativeOverlay)
    ? createPortal(
        <FloatingChatOverlay
          title={browserSelectedRun?.title?.trim() || browserSelectedRun?.goal?.trim() || "New chat"}
          iconTooltip={browserSelectedRun?.title?.trim() || "New run"}
          activity={browserSelectedRun?.status === "running" || browserSelectedRun?.status === "queued"
            ? browserSelectedRun.status : null}
          mode={browserPanel.chatMode}
          onShowDetails={() => browserPanel.setChatMode("details")}
          onMinimize={() => browserPanel.setChatMode("icon")}
          onComposerHeightChange={browserChatOnly ? handleBrowserComposerHeight : undefined}
          composer={browserComposer}
        >
          {browserSelectedRun && (
            <>
              <div className="min-h-0 flex-1 overflow-hidden">
                <WorkspaceEvents
                  runs={ws.runs}
                  activeTab={ws.activeTab}
                  currentEvents={ws.currentEvents}
                  isTranscriptLoading={ws.isTranscriptLoading}
                  currentWorkspace={ws.currentWorkspace}
                  eventsEndRef={ws.eventsEndRef as RefObject<HTMLDivElement>}
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
                <div className="max-h-[40vh] shrink-0 overflow-y-auto px-3">
                  <ToolApprovalDialog
                    request={currentApproval}
                    onRespond={respondToolApproval}
                    variant={variant}
                  />
                </div>
              )}
              {ws.currentWorkspace && !ws.showEmptyState && !ws.showNewRunTab && (
                <div className="shrink-0 px-3">
                  <GoalSummaryBar
                    providerId={providerId}
                    runId={ws.activeRun?.id}
                    isRunning={ws.activeRun?.status === "running"}
                    enabled={getProviderVariant(variant).supportsGoalMode}
                    rootPath={ws.currentWorkspace.rootPath}
                  />
                </div>
              )}
            </>
          )}
        </FloatingChatOverlay>,
        browserPanel.chatHost,
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
      className={`relative flex flex-col h-full ${routeTopRounding} overflow-hidden`}
    >
      {/* Separate painted panes leave the translucent shell visible between chat and terminal. */}
      <div className="flex min-h-0 flex-1 flex-col rounded-b-2xl bg-primary dark:bg-primary-950">
      {/* `content-inset` on the transcript and composer, but not on the
          terminal below them: the session box only covers the top-right of the
          content, so the terminal keeps the full width. */}
      <div className="content-inset flex-1 overflow-hidden noscrollbar min-h-0">
        {browserPanel.isExpanded ? null : useCenteredPromptLayout ? (
          <div
            className={`flex h-full min-h-0 flex-col items-center justify-center-safe gap-8 overflow-y-auto py-10 noscrollbar ${CONTENT_COLUMN_GUTTER}`}
          >
            <WorkspaceEmptyState
              workspace={ws.currentWorkspace}
              presentation="headline"
            />
            <div className="w-full flex flex-col items-center gap-3">
              <WorkspaceInput
                goal={ws.goal}
                onGoalChange={ws.setGoal}
                onSubmit={ws.handleExecute}
                isLoading={ws.isLoading}
                activeRun={ws.activeRun}
                canResume={ws.canResume ?? false}
                providerId={providerId}
                selectedModel={ws.selectedModel}
                onModelChange={ws.handleModelChange}
                workspacePath={ws.currentWorkspace?.rootPath}
                projectId={ws.currentWorkspace?.projectId ?? undefined}
                uploadedFiles={ws.uploadedFiles}
                onUploadedFilesChange={ws.setUploadedFiles}
                additionalDirectories={ws.additionalDirectories}
                onAdditionalDirectoriesChange={ws.setAdditionalDirectories}
                onStop={handleStop}
                isNewRunTabActive={ws.showNewRunTab}
                newChatProjectName={newChatProject?.name}
                newChatProjectIcon={
                  newChatProject ? (
                    <ProjectIcon
                      icon={newChatProject.icon}
                      projectName={newChatProject.name}
                    />
                  ) : undefined
                }
                layout="centered"
              />
            </div>
          </div>
        ) : ws.showEmptyState ? (
          <WorkspaceEmptyState workspace={ws.currentWorkspace} />
        ) : ws.isEmptyStatePending ? null : (
          <WorkspaceEvents
            runs={ws.runs}
            activeTab={ws.activeTab}
            currentEvents={ws.currentEvents}
            isTranscriptLoading={ws.isTranscriptLoading}
            currentWorkspace={ws.currentWorkspace}
            eventsEndRef={ws.eventsEndRef as RefObject<HTMLDivElement>}
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
      {!browserPanel.isExpanded && currentApproval &&
        !currentPlanApproval &&
        !ws.showEmptyState &&
        !ws.showNewRunTab && (
        <div className="w-full max-w-210 mx-auto max-h-[55vh] overflow-y-auto noscrollbar">
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
      {browserPanel.isExpanded || ws.showEmptyState || ws.showNewRunTab || ws.activeRun?.status !== "running" ? null : (
        <TodoSummaryBar
          events={ws.currentEvents}
          structuralPlan={currentStructuralPlan}
          variant={variant}
        />
      )}

      {!browserPanel.isExpanded && ws.currentWorkspace && !ws.showEmptyState && !ws.showNewRunTab && (
        <GoalSummaryBar
          providerId={providerId}
          runId={ws.activeRun?.id}
          isRunning={ws.activeRun?.status === "running"}
          enabled={getProviderVariant(variant).supportsGoalMode}
          rootPath={ws.currentWorkspace.rootPath}
        />
      )}

      {!browserPanel.isExpanded && onboardingCompleted && !ws.showEmptyState && !ws.showNewRunTab && !ws.isEmptyStatePending ? (
        <WorkspaceInput
          goal={ws.goal}
          onGoalChange={ws.setGoal}
          onSubmit={ws.handleExecute}
          isLoading={ws.isLoading}
          activeRun={ws.composerRun}
          canResume={ws.canResume ?? false}
          providerId={providerId}
          selectedModel={ws.selectedModel}
          onModelChange={ws.handleModelChange}
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
