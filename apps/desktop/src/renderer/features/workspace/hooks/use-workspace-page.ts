import { useState, useCallback, useEffect } from "react";
import { toast, type UploadedFile } from "@/components/ui";
import { useNavigate, useParams } from "react-router-dom";
import { useAppSelector, useAppDispatch } from "@/lib/redux/hooks";
import {
  setWorkspaceModel,
  setActiveTab,
  clearSelectedFile,
  clearIssueTabs,
  clearSignalTabs,
  clearNoteTabs,
  setActiveWorkspaceId,
  setActiveWorkspaceForProvider,
  setWorkspaceProvider,
  clearPendingGoal,
  clearPendingReviewTarget,
  openNewRunTab,
  setSelectedCollectionId,
} from "@/lib/redux/slices/workspaceSlice";
import { isRunTab, isNewRunTab } from "@/features/workspace/lib/repo-utils";
import { useModeConfig } from "@/hooks/use-mode-config";
import { useComposerContext } from "./use-composer-context";
import { useWorkspaceData } from "./use-workspace-data";
import { useWorkspaceRuns } from "./use-workspace-runs";
import { useFileContentLoader } from "./use-file-content-loader";
import { useTabHandlers } from "./use-tab-handlers";
import { serializeAttachments } from "@/features/workspace/lib/run-helpers";

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

  const [goal, setGoal] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [canResume, setCanResume] = useState(false);
  const [autoExecute, setAutoExecute] = useState(false);

  const handleModelChange = useCallback(
    (model: string) => {
      dispatch(setWorkspaceModel({ providerId, model }));
    },
    [dispatch, providerId],
  );

  const { workspaceId, selectedWorkspace, currentWorkspace } =
    useWorkspaceData(providerId, mode);

  // A space switch can land on the same workspace, so the workspaceId-keyed
  // resets below never fire — sync the provider so the slice drops tab state
  // naming a run from the space being left.
  useEffect(() => {
    dispatch(setWorkspaceProvider(providerId));
  }, [providerId, dispatch]);

  useEffect(() => {
    dispatch(setActiveWorkspaceId(workspaceId ?? null));
    if (workspaceId) {
      dispatch(setActiveWorkspaceForProvider({ providerId, workspaceId }));
    }
  }, [workspaceId, providerId, dispatch]);

  useEffect(() => {
    dispatch(clearSelectedFile());
    clearContext();
    dispatch(clearIssueTabs());
    dispatch(clearSignalTabs());
    dispatch(clearNoteTabs());
    dispatch(setActiveTab("editor"));
    // `clearContext` is dispatch-stable, so listing it doesn't re-fire this.
  }, [workspaceId, routeRunId, dispatch, clearContext]);

  // Sync pendingGoal from Redux to local state
  useEffect(() => {
    if (!pendingGoal) return;
    const nextGoal = pendingGoal;
    const runAuto = pendingAutoExecute;
    dispatch(clearPendingGoal());
    queueMicrotask(() => {
      setGoal(nextGoal);
      if (runAuto) setAutoExecute(true);
    });
  }, [pendingGoal, pendingAutoExecute, dispatch]);

  const {
    runs,
    activeRun,
    currentEvents,
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
  } = useWorkspaceRuns(workspaceId, providerId, mode, routeRunId);

  // Handle pending review target (native code review) — developer-only UI,
  // gated defensively so a stale target can't hijack the tab-less view.
  useEffect(() => {
    if (!showTabs || !pendingReviewTarget || !workspaceId || !selectedWorkspace) return;
    dispatch(clearPendingReviewTarget());

    const run = async () => {
      const newRunId = await executeReview(selectedWorkspace, providerId, pendingReviewTarget, selectedModel);
      if (newRunId) {
        dispatch(setActiveTab(newRunId));
      }
    };
    run();
  }, [showTabs, pendingReviewTarget, workspaceId, selectedWorkspace, providerId, selectedModel, executeReview, dispatch]);

  useEffect(() => {
    if (!showTabs) return; // tab-less neutral state is the new-chat screen, not the newest run
    if (runs.length > 0 && !selectedFile && activeTab === "editor") {
      const firstRun = runs[0];
      dispatch(setActiveTab(firstRun.id));
      selectTab(firstRun.id);
    }
  }, [showTabs, runs, selectedFile, activeTab, dispatch, selectTab]);

  // Tab-less modes: "editor" is only ever the post-reset placeholder (workspace,
  // provider, and space switches all hard-reset to it). Promote it to the
  // new-chat screen — unless a sidebar chat click is about to claim the view.
  useEffect(() => {
    if (showTabs) return;
    if (activeTab === "editor" && pendingRunId === null && !routeRunId) {
      dispatch(openNewRunTab());
    }
  }, [showTabs, activeTab, pendingRunId, routeRunId, dispatch]);

  useEffect(() => {
    if (mode === "developer" || !activeRun) return;
    dispatch(setSelectedCollectionId(activeRun.collectionId ?? null));
  }, [mode, activeRun, dispatch]);

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
  const [composeTargetOverride, setComposeTargetOverride] = useState<{
    tab: string;
    workspace: string | undefined;
    value: string | "new";
  } | null>(null);
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
  }, [clearContext]);

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
            clearInputState();
            dispatch(setActiveTab(newRunId));
            if (mode !== "developer") navigate(`/code/runs/${newRunId}`);
          }
        }
      };
      run();
    }
  }, [autoExecute, goal, executeRun, continueRun, mode, workspaceId, selectedWorkspace, providerId, selectedModel, selectedCollectionId, navigate, dispatch, activeRunId, canResume, activeRun, clearInputState]);

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

  const showEmptyState =
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
