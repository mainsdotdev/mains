import { useComposerRunQueue, type QueueMessageSnapshot } from "./use-composer-run-queue";
import { composerAnnotationPrompt, hasComposerMessage } from "../lib/composer-message";
import { runMessageQueue } from "../lib/run-message-queue";
import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { toast } from "@/components/ui";
import { useNavigate, useParams } from "react-router-dom";
import { useAppSelector, useAppDispatch } from "@/lib/redux/hooks";
import {
  transferConversationSettings,
  setConversationSettings as setRunConversationSettings,
  setActiveTab,
  setReviewRunId,
  activateWorkspaceView,
  setComposerContextKey,
  setDraftText,
  setContextItemsForKey,
  clearPendingGoal,
  clearPendingReviewTarget,
  openNewRunTab,
  setSelectedCollectionId,
} from "@/lib/redux/slices/workspaceSlice";
import { isRunTab, isNewRunTab, isReviewTab } from "@/features/workspace/lib/repo-utils";
import { useModeConfig } from "@/hooks/use-mode-config";
import { useComposerContext } from "./use-composer-context";
import { useTransientUploads, getTransientUploadsForOwner, moveTransientUploadsToOwner } from "./use-transient-uploads";
import { composerOwnerKey, workspaceViewKey, type NewConversationContext } from "../lib/ui-context";
import { WORKSPACE_BASE_PATH } from "@/lib/route-utils";
import { useActiveSpace } from "@/hooks/use-active-space";
import { getProviderVariantById } from "@/lib/provider-variants";
import { setRightPaneContextKey, transferRightPaneContext } from "@/lib/redux/slices/appSettingsSlice";
import { useWorkspaceData } from "./use-workspace-data";
import { useWorkspaceRuns } from "./use-workspace-runs";
import { useFileContentLoader } from "./use-file-content-loader";
import { useTabHandlers } from "./use-tab-handlers";
import { serializeAttachments } from "@/features/workspace/lib/run-helpers";
import { collectionIdForVisibleRun } from "@/features/workspace/lib/run-collection-context";
import { store } from "@/lib/redux";
import { useMcpAppPanel } from "@/hooks/use-mcp-app-panel";
import { contextItemKey } from "../lib/composer-context";
import type { McpAppMessageOptions } from "../lib/mcp-app-context";
import { workspaceBrowserExpansionKey } from "../../../../shared/ui-state-keys";
import { useConversationSettings } from "./use-conversation-settings";
import { useRealtimeVoice } from "./use-realtime-voice";
import { useSubmittedPrompts } from "./use-submitted-prompts";

const EMPTY_DIRECTORIES: string[] = [];


export function useWorkspacePage(providerId: string, mirrorOnly = false) {
  const dispatch = useAppDispatch();
  const voice = useRealtimeVoice();
  const mcpPanel = useMcpAppPanel();
  const attachAppRun = mcpPanel?.attachRun;
  const appContext = mcpPanel?.appContext;
  const sendingRef = useRef(false);
  const navigate = useNavigate();
  const { runId: routeRunId } = useParams<{ runId?: string }>();

  const activeTab = useAppSelector(
    (state) => state.workspace.activeTab,
  );
  const selectedFile = useAppSelector(
    (state) => state.workspace.selectedFile,
  );
  const { reviewTabOpen, reviewRunId } = useAppSelector((state) => state.workspace);
  const activeViewKey = useAppSelector((state) => state.workspace.workspaceViewKey);
  const workspaceViewNeedsDefaultRun = useAppSelector(
    (state) => state.workspace.workspaceViewNeedsDefaultRun,
  );
  const { items: contextItems, clear: clearContext } = useComposerContext();
  const openIssueTabs = useAppSelector(
    (state) => state.workspace.openIssueTabs,
  );
  const openSignalTabs = useAppSelector(
    (state) => state.workspace.openSignalTabs,
  );
  const openNoteTabs = useAppSelector(
    (state) => state.workspace.openNoteTabs,
  );
  const pendingGoal = useAppSelector(
    (state) => state.workspace.pendingGoal,
  );
  const pendingAutoExecute = useAppSelector(
    (state) => state.workspace.pendingAutoExecute,
  );
  const pendingReviewTarget = useAppSelector(
    (state) => state.workspace.pendingReviewTarget,
  );
  const previousNonEditorTab = useAppSelector(
    (state) => state.workspace.previousNonEditorTab,
  );
  const pendingRunId = useAppSelector(
    (state) => state.workspace.pendingRunId,
  );
  const selectedCollectionId = useAppSelector(
    (state) => state.workspace.selectedCollectionId,
  );
  const { mode, showTabs } = useModeConfig();
  const { activeSpaceId } = useActiveSpace();
  const backendId = useAppSelector((state) => state.backends.activeBackendId);

  const [canResume, setCanResume] = useState(false);
  const [autoExecute, setAutoExecute] = useState(false);
  const autoExecuteConsumed = useRef(false);
  const [composeTargetOverride, setComposeTargetOverride] = useState<{
    tab: string;
    workspace: string | undefined;
    value: string | "new";
  } | null>(null);

  const { workspaceId, selectedWorkspace, currentWorkspace, workspaces } =
    useWorkspaceData(providerId, mode);
  const switchableWorkspaceIds = useMemo(
    () => (mode === "developer" ? workspaces.map((w) => w.id) : []),
    [mode, workspaces],
  );

  const contextParts = useMemo(() => ({
    backendId,
    spaceId: activeSpaceId,
    providerId,
    mode,
    workspaceId,
    collectionId: selectedCollectionId,
  }), [backendId, activeSpaceId, providerId, mode, workspaceId, selectedCollectionId]);
  const viewKey = workspaceViewKey(contextParts);

  // Store one workspace view per backend/space/workspace, then restore it
  // before paint when navigation changes the active workspace.
  useLayoutEffect(() => {
    dispatch(activateWorkspaceView({ key: viewKey, workspaceId: workspaceId ?? null, providerId }));
  }, [viewKey, workspaceId, providerId, dispatch]);

  // Work/Chat runs have no workspace to reload from. When a space's saved view
  // restores its selected chat on /code, load that run just as a run URL would.
  // Wait for the matching view to be active so a departing space's tab cannot
  // be fetched under the incoming provider.
  const visibleRunId = routeRunId ?? (
    !showTabs && activeViewKey === viewKey && isRunTab(activeTab)
      ? activeTab
      : undefined
  );

  const {
    runs,
    runsLoaded,
    activeRunId: selectedRunId,
    currentEvents,
    isTranscriptLoading,
    currentTurns,
    runTurns,
    isRunDetailsLoaded,
    loadRunDetails,
    isLoading,
    eventsEndRef,
    history,
    setActiveRunId,
    createVoiceConversation,
    executeRun,
    continueRun,
    forkRun,
    executeReview,
    checkCanResume,
    closeTab,
    selectTab,
    setRuns,
  } = useWorkspaceRuns(
    workspaceId,
    providerId,
    mode,
    visibleRunId,
    switchableWorkspaceIds,
  );

  // The tab is authoritative. The run hook can still retain the previous
  // selection while a New Run tab is visible or a synced run is loading.
  const activeRun = isRunTab(activeTab)
    ? runs.find((run) => run.id === activeTab)
    : undefined;

  // Resolve the conversation that owns the composer and browser. An editor
  // opened from a run stays with that run unless the target pill chooses new.
  const overrideValue =
    composeTargetOverride &&
    composeTargetOverride.tab === activeTab &&
    composeTargetOverride.workspace === workspaceId
      ? composeTargetOverride.value
      : null;
  const isRetargetable = (activeTab === "editor" || isReviewTab(activeTab)) && runs.length > 0;
  const fallbackTargetRunId =
    previousNonEditorTab &&
    isRunTab(previousNonEditorTab) &&
    runs.some((r) => r.id === previousNonEditorTab)
      ? previousNonEditorTab
      : null;
  const composeTargetRunId = isRunTab(activeTab)
    ? activeTab
    : isReviewTab(activeTab)
      ? runs.some((run) => run.id === reviewRunId) ? reviewRunId : null
    : !isRetargetable || overrideValue === "new"
      ? null
      : overrideValue && runs.some((r) => r.id === overrideValue)
        ? overrideValue
        : fallbackTargetRunId;
  const composeTargetRun = composeTargetRunId
    ? runs.find((r) => r.id === composeTargetRunId)
    : undefined;
  const ownerKey = composerOwnerKey(contextParts, composeTargetRunId);
  const conversation = useConversationSettings({
    backendId, providerId, ownerKey, runId: composeTargetRunId, run: composeTargetRun, mirrorOnly,
    latestModel: composeTargetRunId
      ? runTurns[composeTargetRunId]?.slice().reverse().find((turn) => turn.model)?.model : undefined,
    loadingRun: !!composeTargetRunId && !isRunDetailsLoaded(composeTargetRunId),
  });
  useEffect(() => {
    if (composeTargetRunId && composeTargetRun && !conversation.ready) void loadRunDetails(composeTargetRunId);
  }, [composeTargetRunId, composeTargetRun, conversation.ready, loadRunDetails]);
  const conversationSettings = conversation.settings;
  const saveDraftSettingsToRun = conversation.saveDraftSettingsToRun;
  const beginSettingsIntent = conversation.beginSettingsIntent;
  const rememberSettings = conversation.rememberSettings;
  // A new conversation requested from an existing run has no fresh composer
  // in which to reset these toggles. Explicit choices in a new draft survive.
  const newRunSettings = useMemo(() => composeTargetRunId
    ? { ...conversationSettings, config: { ...conversationSettings.config, goalMode: false, planMode: false } }
    : conversationSettings, [composeTargetRunId, conversationSettings]);
  const selectedModel = conversationSettings.model;
  const handleModelChange = conversation.changeModel;
  const browserExpansionKey = mode === "developer" && workspaceId
    ? workspaceBrowserExpansionKey(backendId, workspaceId)
    : ownerKey;
  const goal = useAppSelector((state) => state.workspace.draftTextByKey[ownerKey] ?? "");
  const setGoal = useCallback((text: string) => {
    dispatch(setDraftText({ key: ownerKey, text }));
  }, [dispatch, ownerKey]);
  const [uploadedFiles, setUploadedFiles] = useTransientUploads(ownerKey);
  const [directoryDrafts, setDirectoryDrafts] = useState<Record<string, string[]>>({});
  const storedDirectories = composeTargetRun?.configSnapshot?.additionalDirectories;
  const additionalDirectories = useMemo(() => directoryDrafts[ownerKey] ??
    (Array.isArray(storedDirectories)
      ? storedDirectories.filter((value): value is string => typeof value === "string")
      : EMPTY_DIRECTORIES), [directoryDrafts, ownerKey, storedDirectories]);
  const runAdditionalDirectories = getProviderVariantById(providerId)?.supportsAdditionalDirectories
    ? additionalDirectories
    : undefined;
  const setAdditionalDirectories = useCallback((directories: string[]) => {
    setDirectoryDrafts((current) => ({ ...current, [ownerKey]: directories }));
  }, [ownerKey]);

  const supportsTurnSteer = getProviderVariantById(providerId)?.supportsTurnSteer ?? false;
  const runQueue = useComposerRunQueue({
    enabled: supportsTurnSteer, ownerKey, backendId, run: composeTargetRun,
    selectedModel, additionalDirectories, setModel: handleModelChange, setDirectories: setAdditionalDirectories,
    conversationSettings, setSettings: conversation.changeSettings,
  });
  const handleQueueSnapshot = (snapshot: QueueMessageSnapshot) => {
    const text = snapshot.text.trim() || composerAnnotationPrompt(snapshot.contextItems);
    if (!hasComposerMessage(text, snapshot.files.length, snapshot.contextItems)) return false;
    return runQueue.submitSnapshot({ ...snapshot, text,
      contextItems: [...snapshot.contextItems, ...(snapshot.editingId ? [] : appContext?.(ownerKey) ?? [])],
    });
  };

  const handleNewConversationContextChange = useCallback((selection: NewConversationContext) => {
    if ((mode === "developer") !== ("workspaceId" in selection)) return;
    const nextParts = { ...contextParts, ...selection };
    const nextOwnerKey = composerOwnerKey(nextParts, null);
    dispatch(transferConversationSettings({ fromKey: ownerKey, toKey: nextOwnerKey }));
    dispatch(setDraftText({ key: nextOwnerKey, text: goal }));
    moveTransientUploadsToOwner(ownerKey, nextOwnerKey);
    setDirectoryDrafts((current) => ({ ...current, [nextOwnerKey]: additionalDirectories }));
    // Workspace navigation normally restores its selected run. Choosing here
    // instead keeps the destination's new-run composer on screen.
    dispatch(activateWorkspaceView({
      key: workspaceViewKey(nextParts),
      workspaceId: nextParts.workspaceId ?? null,
      providerId,
    }));
    if ("collectionId" in selection) {
      dispatch(setContextItemsForKey({ key: nextOwnerKey, items: contextItems }));
      dispatch(setSelectedCollectionId(selection.collectionId));
    }
    dispatch(openNewRunTab());
    navigate("workspaceId" in selection
      ? `${WORKSPACE_BASE_PATH}/${selection.workspaceId}`
      : WORKSPACE_BASE_PATH);
  }, [mode, contextParts, dispatch, goal, ownerKey, additionalDirectories, contextItems, providerId, navigate]);

  useLayoutEffect(() => {
    if (activeViewKey !== viewKey) return;
    dispatch(setComposerContextKey(ownerKey));
    dispatch(setRightPaneContextKey({ ownerKey, browserExpansionKey }));
    return () => {
      if (mirrorOnly) return;
      const settings = store.getState().appSettings;
      if (settings.activeRightPaneContextKey !== ownerKey) return;
      if (!settings.documentViewerOpen && settings.rightPaneByContext.default !== "document") return;
      // Park this chat's document in its existing snapshot before leaving.
      // Atlas can then own its preview without replacing the chat's document.
      dispatch(setRightPaneContextKey({ ownerKey: "default", browserExpansionKey: "default" }));
    };
  }, [activeViewKey, viewKey, ownerKey, browserExpansionKey, dispatch, mirrorOnly]);

  // Quick actions target the currently visible composer, even after it was
  // unmounted while visiting Settings.
  useEffect(() => {
    if (activeViewKey !== viewKey || !pendingGoal) return;
    const nextGoal = pendingGoal;
    const runAuto = pendingAutoExecute;
    dispatch(clearPendingGoal());
    queueMicrotask(() => {
      setGoal(nextGoal);
      if (runAuto) setAutoExecute(true);
    });
  }, [activeViewKey, viewKey, pendingGoal, pendingAutoExecute, dispatch, setGoal]);

  // Handle pending review target (native code review) — developer-only UI,
  // gated defensively so a stale target can't hijack the tab-less view.
  useEffect(() => {
    if (activeViewKey !== viewKey || !showTabs || !pendingReviewTarget || !workspaceId || !selectedWorkspace || !conversation.ready) return;
    dispatch(clearPendingReviewTarget());

    const run = async () => {
      const revision = beginSettingsIntent();
      const newRunId = await executeReview(selectedWorkspace, providerId, pendingReviewTarget, selectedModel, newRunSettings);
      if (newRunId) {
        rememberSettings(newRunSettings, revision);
        dispatch(setRunConversationSettings({ key: composerOwnerKey(contextParts, newRunId), settings: newRunSettings }));
        dispatch(setActiveTab(newRunId));
      }
    };
    run();
  }, [activeViewKey, viewKey, showTabs, pendingReviewTarget, workspaceId, selectedWorkspace, providerId, selectedModel, newRunSettings, conversation.ready, beginSettingsIntent, rememberSettings, executeReview, dispatch, contextParts]);

  useLayoutEffect(() => {
    if (activeViewKey !== viewKey || !showTabs) return; // tab-less neutral state is the new-chat screen
    if (isReviewTab(activeTab)) {
      if (composeTargetRunId && selectedRunId !== composeTargetRunId) selectTab(composeTargetRunId);
      return;
    }
    if (isRunTab(activeTab)) {
      if (selectedRunId !== activeTab) selectTab(activeTab);
      return;
    }
    if (workspaceViewNeedsDefaultRun && runs.length > 0 && !selectedFile && activeTab === "editor") {
      // A jump into another workspace names its run; landing on the newest
      // first would flash it before the jump is consumed.
      const target = runs.find((r) => r.id === pendingRunId) ?? runs[0];
      dispatch(setActiveTab(target.id));
      selectTab(target.id);
    }
  }, [activeViewKey, viewKey, showTabs, runs, selectedFile, activeTab, composeTargetRunId, selectedRunId, pendingRunId, workspaceViewNeedsDefaultRun, dispatch, selectTab]);

  // Tab-less modes use "editor" as the neutral placeholder for a new chat.
  useEffect(() => {
    if (activeViewKey !== viewKey || showTabs) return;
    if (activeTab === "editor" && pendingRunId === null && !routeRunId) {
      dispatch(openNewRunTab());
    }
  }, [activeViewKey, viewKey, showTabs, activeTab, pendingRunId, routeRunId, dispatch]);

  useEffect(() => {
    const visibleCollectionId = collectionIdForVisibleRun(
      mode,
      activeTab,
      activeRun,
    );
    if (visibleCollectionId === undefined) return;
    dispatch(setSelectedCollectionId(visibleCollectionId));
  }, [mode, activeTab, activeRun, dispatch]);

  useFileContentLoader(selectedFile, currentWorkspace?.rootPath);

  const tabHandlers = useTabHandlers({
    activeTab,
    runs,
    closeTab,
    selectTab,
    setActiveRunId,
    forkRun,
    setGoal,
    setRuns,
  });

  const activeRunId = isReviewTab(activeTab) ? composeTargetRunId : isRunTab(activeTab) ? activeTab : null;
  const submittedPrompts = useSubmittedPrompts({ ownerKey, viewKey, activeRunId, events: currentEvents, runs, historical: history.historical });
  const { begin: beginPrompt, accept: acceptPrompt, reject: rejectPrompt } = submittedPrompts;

  // ── Composer send target ──
  // On the editor tab the composer has no run context of its own, so every
  // send used to start a fresh run. Default the target to the run tab the
  // user came from (previousNonEditorTab); the target pill in the composer
  // lets them retarget to another run or an explicit new chat. On run tabs
  // the target is simply that run, as before.
  // The override is stamped with the tab/workspace it was chosen on and
  // simply ignored once either changes — no reset effect needed.
  const composerVoicePhase = voice.state.runId === composeTargetRunId ? voice.state.phase : "idle";
  useEffect(() => {
    let canceled = false;
    const checkResume = async () => {
      if (
        composeTargetRunId &&
        composeTargetRun &&
        composeTargetRun.status !== "running" &&
        composeTargetRun.status !== "queued"
      ) {
        const resumable = await checkCanResume(composeTargetRunId);
        if (!canceled) setCanResume(resumable);
      } else {
        setCanResume(false);
      }
    };
    checkResume();
    return () => { canceled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeTargetRunId, composeTargetRun?.status, composerVoicePhase, checkCanResume]);

  const clearInputState = useCallback(() => {
    setGoal("");
    setUploadedFiles([]);
    clearContext();
    if (!composeTargetRunId) {
      setDirectoryDrafts((current) => {
        const next = { ...current };
        delete next[ownerKey];
        return next;
      });
    }
  }, [setGoal, setUploadedFiles, clearContext, composeTargetRunId, ownerKey]);

  const handleCreateVoiceConversation = useCallback(async () => {
    if (!conversation.ready || sendingRef.current) return null;
    if (mode === "developer" && !workspaceId) {
      toast.error("Select a workspace before starting voice chat.");
      return null;
    }
    sendingRef.current = true;
    try {
      const revision = beginSettingsIntent();
      const runId = await createVoiceConversation(selectedWorkspace, selectedCollectionId, runAdditionalDirectories, newRunSettings);
      if (!runId) return null;
      rememberSettings(newRunSettings, revision);
      if (!composeTargetRunId) void saveDraftSettingsToRun(runId, newRunSettings);
      const nextOwnerKey = composerOwnerKey(contextParts, runId);
      const state = store.getState().workspace;
      const items = state.composerContextKey === ownerKey ? state.contextItems : state.contextItemsByKey[ownerKey] ?? [];
      // Starting the microphone must not submit or discard the written draft.
      if (!composeTargetRunId) dispatch(transferConversationSettings({ fromKey: ownerKey, toKey: nextOwnerKey }));
      else dispatch(setRunConversationSettings({ key: nextOwnerKey, settings: newRunSettings }));
      dispatch(setContextItemsForKey({ key: ownerKey, items: [] }));
      dispatch(setContextItemsForKey({ key: nextOwnerKey, items }));
      dispatch(setDraftText({ key: ownerKey, text: "" }));
      dispatch(setDraftText({ key: nextOwnerKey, text: state.draftTextByKey[ownerKey] ?? "" }));
      moveTransientUploadsToOwner(ownerKey, nextOwnerKey);
      dispatch(transferRightPaneContext({ fromKey: ownerKey, toKey: nextOwnerKey }));
      await (window as any).api?.browser?.reassignTabs?.(ownerKey, nextOwnerKey);
      attachAppRun?.(ownerKey, runId, contextParts);
      const visible = store.getState().workspace;
      if (visible.workspaceViewKey !== viewKey ||
          (visible.composerContextKey !== ownerKey && visible.composerContextKey !== nextOwnerKey)) return null;
      dispatch(setActiveTab(runId));
      if (mode !== "developer") navigate(`/code/runs/${runId}`);
      return runId;
    } finally { sendingRef.current = false; }
  }, [conversation.ready, mode, workspaceId, createVoiceConversation, selectedWorkspace, selectedCollectionId,
    runAdditionalDirectories, newRunSettings, composeTargetRunId, beginSettingsIntent, rememberSettings, saveDraftSettingsToRun, contextParts, ownerKey, dispatch, attachAppRun, viewKey, navigate]);

  const handleExecute = useCallback(async (message?: string, options: McpAppMessageOptions = {}) => {
    if (!conversation.ready) return null;
    const currentState = store.getState().workspace;
    const draft = currentState.draftTextByKey[ownerKey] ?? goal;
    const files = getTransientUploadsForOwner(ownerKey);
    const items = currentState.composerContextKey === ownerKey ? currentState.contextItems : currentState.contextItemsByKey[ownerKey] ?? contextItems;
    const text = (message ?? draft).trim() || (message === undefined ? composerAnnotationPrompt(items) : "");
    if (!hasComposerMessage(text, files.length, items)) return null;
    if (mode === "developer" && !workspaceId) {
      toast.error("Select a workspace before sending a prompt.");
      return null;
    }
    const targetRunId = options.target === "new" ? null : composeTargetRunId;
    const targetRun = targetRunId ? composeTargetRun : undefined;
    if (targetRunId && !targetRun) return null;
    if (message === undefined && runQueue.controls?.editing) {
      runQueue.saveEdit(text, [...items]);
      return targetRunId;
    }
    const live = targetRun?.status === "running" || targetRun?.status === "queued";
    const queued = store.getState().runQueue?.byOwner[ownerKey];
    if (targetRunId && supportsTurnSteer && (live || !!queued?.messages.length)) {
      const id = runQueue.enqueue(text, [...items, ...(appContext?.(ownerKey) ?? [])], files);
      if (!id) return null;
      rememberSettings(conversationSettings, beginSettingsIntent());
      if (message === undefined) {
        dispatch(setDraftText({ key: ownerKey, text: "" }));
      }
      dispatch(setContextItemsForKey({ key: ownerKey, items: [] }));
      if (queued?.mode === "steer" && live) void runMessageQueue.send(ownerKey, id, "steer");
      return targetRunId;
    }
    if (sendingRef.current || live) {
      if (message !== undefined) throw new Error("Wait for the current response or stop it before sending another message");
      return null;
    }
    if (message !== undefined && targetRunId && !canResume) {
      throw new Error("This conversation cannot be resumed. Start a new chat.");
    }
    sendingRef.current = true;
    const submitted = [...items];
    let clientPromptId: string | undefined;
    let accepted = false;
    try {
      const revision = beginSettingsIntent();
      const runContext = [...submitted, ...(appContext?.(ownerKey) ?? [])];
      const continuing = !!targetRunId && canResume && !!targetRun;
      clientPromptId = beginPrompt(text, runContext, files, continuing ? targetRunId : null);
      if (continuing && history.historical) void history.loadLatest();
      const attachments = files.length > 0 ? await serializeAttachments(files) : undefined;
      let nextRunId: string | null;
      if (continuing) {
        const success = await continueRun(targetRunId!, text, selectedModel, attachments, runContext, runAdditionalDirectories, conversationSettings, clientPromptId);
        nextRunId = success ? targetRunId : null;
      } else {
        nextRunId = await executeRun(text, selectedWorkspace, providerId, selectedModel, attachments,
          runContext, selectedCollectionId, runAdditionalDirectories, newRunSettings, clientPromptId);
      }
      if (!nextRunId) return null;
      rememberSettings(continuing ? conversationSettings : newRunSettings, revision);
      acceptPrompt(clientPromptId, nextRunId);
      accepted = true;

      const nextOwnerKey = composerOwnerKey(contextParts, nextRunId);
      const state = store.getState().workspace;
      const current = state.composerContextKey === ownerKey ? state.contextItems : state.contextItemsByKey[ownerKey] ?? [];
      const remaining = current.filter((item) => !submitted.some((sent) =>
        item.kind === sent.kind && contextItemKey(item) === contextItemKey(sent) &&
        (item.kind !== "mcp-app" || sent.kind !== "mcp-app" || item.updateId === sent.updateId) &&
        (item.kind !== "browser" || sent.kind !== "browser" || item.comment === sent.comment) &&
        (item.kind !== "review" || sent.kind !== "review" || item.comment === sent.comment)));
      const draft = state.draftTextByKey[ownerKey] ?? "";
      const remainingDraft = message === undefined && draft.trim() === text ? "" : draft;
      dispatch(setContextItemsForKey({ key: ownerKey, items: remaining }));
      dispatch(setDraftText({ key: ownerKey, text: remainingDraft }));
      if (!composeTargetRunId) {
        void saveDraftSettingsToRun(nextRunId, conversationSettings);
        dispatch(transferConversationSettings({ fromKey: ownerKey, toKey: nextOwnerKey }));
        dispatch(setContextItemsForKey({ key: ownerKey, items: [] }));
        dispatch(setContextItemsForKey({ key: nextOwnerKey, items: remaining }));
        dispatch(setDraftText({ key: ownerKey, text: "" }));
        dispatch(setDraftText({ key: nextOwnerKey, text: remainingDraft }));
        dispatch(transferRightPaneContext({ fromKey: ownerKey, toKey: nextOwnerKey }));
        await (window as any).api?.browser?.reassignTabs?.(ownerKey, nextOwnerKey);
      } else if (!continuing) {
        dispatch(setRunConversationSettings({ key: nextOwnerKey, settings: newRunSettings }));
      }
      if (getTransientUploadsForOwner(ownerKey) === files) setUploadedFiles([]);
      attachAppRun?.(ownerKey, nextRunId, contextParts);
      const visible = store.getState().workspace;
      if (visible.workspaceViewKey !== viewKey ||
          (visible.composerContextKey !== ownerKey && visible.composerContextKey !== nextOwnerKey)) return nextRunId;
      if (isReviewTab(visible.activeTab)) {
        dispatch(setReviewRunId(nextRunId));
        selectTab(nextRunId);
      } else {
        dispatch(setActiveTab(nextRunId));
        if (continuing) selectTab(nextRunId);
      }
      if (mode !== "developer") navigate(`/code/runs/${nextRunId}`);
      return nextRunId;
    } finally {
      if (!accepted && clientPromptId) rejectPrompt(clientPromptId);
      sendingRef.current = false;
    }
  }, [goal, contextItems, runAdditionalDirectories, mode, workspaceId, selectedWorkspace,
    selectedModel, conversationSettings, newRunSettings, conversation.ready, beginSettingsIntent, rememberSettings, saveDraftSettingsToRun, executeRun, continueRun, composeTargetRunId, composeTargetRun, selectTab, canResume,
    setUploadedFiles, dispatch, providerId, selectedCollectionId, navigate, ownerKey, contextParts, appContext, attachAppRun, viewKey, supportsTurnSteer, runQueue, beginPrompt, acceptPrompt, rejectPrompt, history]);

  // Auto-execute when pendingAutoExecute was set (e.g. "Review Changes" button, suggestion chips)
  useEffect(() => {
    if (!autoExecute) { autoExecuteConsumed.current = false; return; }
    if (autoExecuteConsumed.current) return;
    if (autoExecute && goal && conversation.ready) {
      // Claim this request before dispatching intent: that dispatch can rerender
      // the page before the scheduled state update consumes autoExecute.
      autoExecuteConsumed.current = true;
      queueMicrotask(() => setAutoExecute(false));
      if (mode === "developer" && !workspaceId) return;
      // Same rule as handleExecute: a live run is not a place to start another.
      if (activeRun && (activeRun.status === "running" || activeRun.status === "queued")) return;
      const run = async () => {
        const revision = beginSettingsIntent();
        if (activeRunId && canResume && activeRun && activeRun.status !== "running") {
          const success = (await continueRun(
            activeRunId,
            goal,
            selectedModel,
            undefined,
            undefined,
            runAdditionalDirectories,
            conversationSettings,
          )) ?? false;
          if (success) {
            rememberSettings(conversationSettings, revision);
            clearInputState();
          }
        } else {
          const newRunId = await executeRun(
            goal,
            selectedWorkspace,
            providerId,
            selectedModel,
            undefined,
            undefined,
            selectedCollectionId,
            runAdditionalDirectories,
            newRunSettings,
          );
          if (newRunId) {
            rememberSettings(newRunSettings, revision);
            const nextOwnerKey = composerOwnerKey(contextParts, newRunId);
            if (!composeTargetRunId) {
              void saveDraftSettingsToRun(newRunId, newRunSettings);
              dispatch(transferConversationSettings({ fromKey: ownerKey, toKey: nextOwnerKey }));
            } else {
              dispatch(setRunConversationSettings({ key: nextOwnerKey, settings: newRunSettings }));
            }
            dispatch(transferRightPaneContext({ fromKey: ownerKey, toKey: nextOwnerKey }));
            await (window as any).api?.browser?.reassignTabs?.(
              ownerKey,
              nextOwnerKey,
            );
            clearInputState();
            dispatch(setActiveTab(newRunId));
            if (mode !== "developer") navigate(`/code/runs/${newRunId}`);
          }
        }
      };
      run();
    }
  }, [autoExecute, goal, executeRun, continueRun, mode, workspaceId, selectedWorkspace, providerId, selectedModel, conversationSettings, newRunSettings, conversation.ready, beginSettingsIntent, rememberSettings, saveDraftSettingsToRun, selectedCollectionId, runAdditionalDirectories, navigate, dispatch, activeRunId, canResume, activeRun, clearInputState, ownerKey, contextParts, composeTargetRunId]);

  const runLabel = (r: { title?: string; goal: string }) =>
    r.title?.trim() ? r.title : r.goal;

  // Pill data for the composer: only when retargeting is possible (editor tab
  // with existing runs). Null hides the pill entirely.
  const sendTarget = isRetargetable
    ? {
        runId: composeTargetRunId,
        label: composeTargetRun ? runLabel(composeTargetRun) : "New chat",
        options: [
          { runId: null as string | null, label: "New chat" },
          ...runs
            .slice(0, 10)
            .map((r) => ({ runId: r.id as string | null, label: runLabel(r) })),
        ],
      }
    : null;

  const handleSendTargetChange = useCallback(
    (runId: string | null) => {
      if (isReviewTab(activeTab)) { dispatch(setReviewRunId(runId)); return; }
      setComposeTargetOverride({
        tab: activeTab,
        workspace: workspaceId,
        value: runId ?? "new",
      });
    },
    [activeTab, workspaceId, dispatch],
  );

  // The run the composer acts on — the retarget target on the editor tab,
  // otherwise the active tab's run. Drives the input's running/stop state and
  // context-usage ring.
  const composerRun = composeTargetRun;

  const showNewRunTab = isNewRunTab(activeTab);

  // Until the list is known, this may be an empty workspace or one with runs.
  // Keep its chrome hidden during that unresolved frame instead of briefly
  // showing tabs and a pinned composer before the centered empty layout.
  const isEmptyViewCandidate =
    runs.length === 0 &&
    !selectedFile &&
    openIssueTabs.length === 0 &&
    openSignalTabs.length === 0 &&
    openNoteTabs.length === 0 &&
    !showNewRunTab && !reviewTabOpen;
  const showEmptyState = runsLoaded && isEmptyViewCandidate;
  const isEmptyStatePending = !runsLoaded && isEmptyViewCandidate;

  const showInput =
    showEmptyState || isRunTab(activeTab) || isNewRunTab(activeTab);

  return {
    // State
    runQueue: runQueue.controls,
    ownerKey,
    contextParts,
    goal,
    setGoal,
    uploadedFiles,
    contextItems,
    setUploadedFiles,
    additionalDirectories,
    setAdditionalDirectories,
    canResume,
    selectedModel,
    conversationSettings,
    conversationSettingsReady: conversation.ready,
    setConversationSettings: conversation.changeSettings,
    handleSettingsConfigChange: conversation.changeConfig,
    activeTab,
    selectedFile,
    openIssueTabs,
    openSignalTabs,
    openNoteTabs,
    reviewTabOpen,
    runs,
    runsLoaded,
    activeRun,
    activeRunId,
    composerRun,
    sendTarget,
    currentEvents: submittedPrompts.currentEvents,
    isTranscriptLoading,
    currentTurns,
    isLoading: isLoading || submittedPrompts.isSubmitting,
    isSubmitting: submittedPrompts.isSubmitting,
    eventsEndRef,
    history,
    currentWorkspace,
    showEmptyState: showEmptyState && !submittedPrompts.hasSubmittedPrompt,
    isEmptyStatePending: isEmptyStatePending && !submittedPrompts.hasSubmittedPrompt,
    showInput,
    showNewRunTab: showNewRunTab && !submittedPrompts.hasSubmittedPrompt,
    // Handlers
    handleModelChange,
    handleExecute,
    handleCreateVoiceConversation,
    handleQueueSnapshot,
    handleSendTargetChange,
    handleNewConversationContextChange,
    setAutoExecute,
    ...tabHandlers,
  };
}
