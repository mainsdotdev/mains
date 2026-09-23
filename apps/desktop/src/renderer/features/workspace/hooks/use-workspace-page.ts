import { useState, useCallback, useEffect, useLayoutEffect, useMemo } from "react";
import { toast } from "@/components/ui";
import { useNavigate, useParams } from "react-router-dom";
import { useAppSelector, useAppDispatch } from "@/lib/redux/hooks";
import {
  setWorkspaceModel,
  setActiveTab,
  activateWorkspaceView,
  setComposerContextKey,
  setDraftText,
  clearPendingGoal,
  clearPendingReviewTarget,
  openNewRunTab,
  setSelectedCollectionId,
} from "@/lib/redux/slices/workspaceSlice";
import { isRunTab, isNewRunTab } from "@/features/workspace/lib/repo-utils";
import { useModeConfig } from "@/hooks/use-mode-config";
import { useComposerContext } from "./use-composer-context";
import { useTransientUploads } from "./use-transient-uploads";
import { composerOwnerKey, workspaceViewKey } from "../lib/ui-context";
import { useActiveSpace } from "@/hooks/use-active-space";
import { setRightPaneContextKey } from "@/lib/redux/slices/appSettingsSlice";
import { useWorkspaceData } from "./use-workspace-data";
import { useWorkspaceRuns } from "./use-workspace-runs";
import { useFileContentLoader } from "./use-file-content-loader";
import { useTabHandlers } from "./use-tab-handlers";
import { serializeAttachments } from "@/features/workspace/lib/run-helpers";
import { collectionIdForVisibleRun } from "@/features/workspace/lib/run-collection-context";

export function useWorkspacePage(providerId: string) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { runId: routeRunId } = useParams<{ runId?: string }>();

  const selectedModel = useAppSelector(
    (state) =>
      state.workspace.selectedModelByProvider[providerId] || "",
  );
  const activeTab = useAppSelector(
    (state) => state.workspace.activeTab,
  );
  const selectedFile = useAppSelector(
    (state) => state.workspace.selectedFile,
  );
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
  const [composeTargetOverride, setComposeTargetOverride] = useState<{
    tab: string;
    workspace: string | undefined;
    value: string | "new";
  } | null>(null);

  const handleModelChange = useCallback(
    (model: string) => {
      dispatch(setWorkspaceModel({ providerId, model }));
    },
    [dispatch, providerId],
  );

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

  const {
    runs,
    runsLoaded,
    activeRun,
    currentEvents,
    isTranscriptLoading,
    currentTurns,
    isLoading,
    eventsEndRef,
    setActiveRunId,
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
    routeRunId,
    switchableWorkspaceIds,
  );

  // Resolve the conversation that owns the composer and browser. An editor
  // opened from a run stays with that run unless the target pill chooses new.
  const overrideValue =
    composeTargetOverride &&
    composeTargetOverride.tab === activeTab &&
    composeTargetOverride.workspace === workspaceId
      ? composeTargetOverride.value
      : null;
  const isRetargetable = activeTab === "editor" && runs.length > 0;
  const fallbackTargetRunId =
    previousNonEditorTab &&
    isRunTab(previousNonEditorTab) &&
    runs.some((r) => r.id === previousNonEditorTab)
      ? previousNonEditorTab
      : null;
  const composeTargetRunId = isRunTab(activeTab)
    ? activeTab
    : !isRetargetable || overrideValue === "new"
      ? null
      : overrideValue && runs.some((r) => r.id === overrideValue)
        ? overrideValue
        : fallbackTargetRunId;
  const composeTargetRun = composeTargetRunId
    ? runs.find((r) => r.id === composeTargetRunId)
    : undefined;
  const ownerKey = composerOwnerKey(contextParts, composeTargetRunId);
  const goal = useAppSelector((state) => state.workspace.draftTextByKey[ownerKey] ?? "");
  const setGoal = useCallback((text: string) => {
    dispatch(setDraftText({ key: ownerKey, text }));
  }, [dispatch, ownerKey]);
  const [uploadedFiles, setUploadedFiles] = useTransientUploads(ownerKey);

  useLayoutEffect(() => {
    if (activeViewKey !== viewKey) return;
    dispatch(setComposerContextKey(ownerKey));
    dispatch(setRightPaneContextKey(ownerKey));
  }, [activeViewKey, viewKey, ownerKey, dispatch]);

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
    if (activeViewKey !== viewKey || !showTabs || !pendingReviewTarget || !workspaceId || !selectedWorkspace) return;
    dispatch(clearPendingReviewTarget());

    const run = async () => {
      const newRunId = await executeReview(selectedWorkspace, providerId, pendingReviewTarget, selectedModel);
      if (newRunId) {
        dispatch(setActiveTab(newRunId));
      }
    };
    run();
  }, [activeViewKey, viewKey, showTabs, pendingReviewTarget, workspaceId, selectedWorkspace, providerId, selectedModel, executeReview, dispatch]);

  useLayoutEffect(() => {
    if (activeViewKey !== viewKey || !showTabs) return; // tab-less neutral state is the new-chat screen
    if (isRunTab(activeTab) && runs.some((r) => r.id === activeTab)) {
      if (activeRun?.id !== activeTab) selectTab(activeTab);
      return;
    }
    if (workspaceViewNeedsDefaultRun && runs.length > 0 && !selectedFile && activeTab === "editor") {
      // A jump into another workspace names its run; landing on the newest
      // first would flash it before the jump is consumed.
      const target = runs.find((r) => r.id === pendingRunId) ?? runs[0];
      dispatch(setActiveTab(target.id));
      selectTab(target.id);
    }
  }, [activeViewKey, viewKey, showTabs, runs, selectedFile, activeTab, activeRun?.id, pendingRunId, workspaceViewNeedsDefaultRun, dispatch, selectTab]);

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

  const activeRunId = isRunTab(activeTab) ? activeTab : null;

  // ── Composer send target ──
  // On the editor tab the composer has no run context of its own, so every
  // send used to start a fresh run. Default the target to the run tab the
  // user came from (previousNonEditorTab); the target pill in the composer
  // lets them retarget to another run or an explicit new chat. On run tabs
  // the target is simply that run, as before.
  // The override is stamped with the tab/workspace it was chosen on and
  // simply ignored once either changes — no reset effect needed.
  useEffect(() => {
    const checkResume = async () => {
      if (
        composeTargetRunId &&
        composeTargetRun &&
        composeTargetRun.status !== "running" &&
        composeTargetRun.status !== "queued"
      ) {
        const resumable = await checkCanResume(composeTargetRunId);
        setCanResume(resumable);
      } else {
        setCanResume(false);
      }
    };
    checkResume();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeTargetRunId, composeTargetRun?.status, checkCanResume]);

  const clearInputState = useCallback(() => {
    setGoal("");
    setUploadedFiles([]);
    clearContext();
  }, [setGoal, setUploadedFiles, clearContext]);

  const handleExecute = useCallback(async () => {
    if (mode === "developer" && !workspaceId) {
      toast.error("Select a workspace before sending a prompt.");
      return;
    }
    // A run still working can take no second prompt — and must not become a
    // new run either. The send button already reads Stop; Enter in the editor
    // reaches here all the same, so the submit itself has to say no.
    if (
      composeTargetRun &&
      (composeTargetRun.status === "running" || composeTargetRun.status === "queued")
    ) {
      return;
    }

    const attachments = uploadedFiles.length > 0
      ? await serializeAttachments(uploadedFiles)
      : undefined;

    if (
      composeTargetRunId &&
      canResume &&
      composeTargetRun &&
      composeTargetRun.status !== "running"
    ) {
      // Jump to the target chat right away so the message lands in view
      // (sending from the editor tab targets the run you came from).
      if (activeTab !== composeTargetRunId) {
        dispatch(setActiveTab(composeTargetRunId));
        selectTab(composeTargetRunId);
      }
      const success =
        (await continueRun(
          composeTargetRunId,
          goal,
          selectedModel,
          attachments,
          contextItems,
        )) ?? false;
      if (success) clearInputState();
    } else {
      const newRunId = await executeRun(
        goal,
        selectedWorkspace,
        providerId,
        selectedModel,
        attachments,
        contextItems,
        selectedCollectionId,
      );
      if (newRunId) {
        if (!composeTargetRunId) {
          await (window as any).api?.browser?.reassignTabs?.(
            ownerKey,
            composerOwnerKey(contextParts, newRunId),
          );
        }
        clearInputState();
        dispatch(setActiveTab(newRunId));
        if (mode !== "developer") {
          navigate(`/code/runs/${newRunId}`);
        }
      }
    }
  }, [
    goal,
    uploadedFiles,
    contextItems,
    mode,
    workspaceId,
    selectedWorkspace,
    selectedModel,
    executeRun,
    continueRun,
    composeTargetRunId,
    composeTargetRun,
    activeTab,
    selectTab,
    canResume,
    clearInputState,
    dispatch,
    providerId,
    selectedCollectionId,
    navigate,
    ownerKey,
    contextParts,
  ]);

  // Auto-execute when pendingAutoExecute was set (e.g. "Review Changes" button, suggestion chips)
  useEffect(() => {
    if (autoExecute && goal) {
      queueMicrotask(() => setAutoExecute(false));
      if (mode === "developer" && !workspaceId) return;
      // Same rule as handleExecute: a live run is not a place to start another.
      if (activeRun && (activeRun.status === "running" || activeRun.status === "queued")) return;
      const run = async () => {
        if (activeRunId && canResume && activeRun && activeRun.status !== "running") {
          const success =
            (await continueRun(activeRunId, goal, selectedModel)) ?? false;
          if (success) clearInputState();
        } else {
          const newRunId = await executeRun(
            goal,
            selectedWorkspace,
            providerId,
            selectedModel,
            undefined,
            undefined,
            selectedCollectionId,
          );
          if (newRunId) {
            await (window as any).api?.browser?.reassignTabs?.(
              ownerKey,
              composerOwnerKey(contextParts, newRunId),
            );
            clearInputState();
            dispatch(setActiveTab(newRunId));
            if (mode !== "developer") navigate(`/code/runs/${newRunId}`);
          }
        }
      };
      run();
    }
  }, [autoExecute, goal, executeRun, continueRun, mode, workspaceId, selectedWorkspace, providerId, selectedModel, selectedCollectionId, navigate, dispatch, activeRunId, canResume, activeRun, clearInputState, ownerKey, contextParts]);

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
      setComposeTargetOverride({
        tab: activeTab,
        workspace: workspaceId,
        value: runId ?? "new",
      });
    },
    [activeTab, workspaceId],
  );

  // The run the composer acts on — the retarget target on the editor tab,
  // otherwise the active tab's run. Drives the input's running/stop state and
  // context-usage ring.
  const composerRun = isRetargetable ? composeTargetRun : activeRun;

  const showNewRunTab = isNewRunTab(activeTab);

  // Only once the list is known: a workspace whose runs are still loading is
  // not an empty one, and flashing the empty state would drop the tab strip.
  const showEmptyState =
    runsLoaded &&
    runs.length === 0 &&
    !selectedFile &&
    openIssueTabs.length === 0 &&
    openSignalTabs.length === 0 &&
    openNoteTabs.length === 0 &&
    !showNewRunTab;

  const showInput =
    showEmptyState || isRunTab(activeTab) || isNewRunTab(activeTab);

  return {
    // State
    goal,
    setGoal,
    uploadedFiles,
    setUploadedFiles,
    canResume,
    selectedModel,
    activeTab,
    selectedFile,
    openIssueTabs,
    openSignalTabs,
    openNoteTabs,
    runs,
    activeRun,
    activeRunId,
    composerRun,
    sendTarget,
    currentEvents,
    isTranscriptLoading,
    currentTurns,
    isLoading,
    eventsEndRef,
    currentWorkspace,
    showEmptyState,
    showInput,
    showNewRunTab,
    // Handlers
    handleModelChange,
    handleExecute,
    handleSendTargetChange,
    setAutoExecute,
    ...tabHandlers,
  };
}
