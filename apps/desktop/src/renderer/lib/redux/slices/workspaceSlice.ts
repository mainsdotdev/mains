import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { FileNode, FileContentResponse } from "@/features/workspace/types/file-explorer";
import type { IssueWithEntity } from "@/lib/redux/api/entitiesApi";
import type { SignalWithEntity } from "@/lib/redux/api/signalsApi";
import {
  contextItemKey,
  isSameContextItem,
  type ContextItem,
  type ContextKind,
} from "@/features/workspace/lib/composer-context";
import { PROVIDER_IDS } from "../../../../shared/provider-ids";

export interface ReviewTab {
  id: string;
  title: string;
  status: string;
}

export interface ProviderAuthTerminalState {
  providerId: string;
  /** Cleared after XtermTerminal writes it into the ready PTY. */
  pendingCommand: string | null;
}

export type WorkspaceSidebarTab = "files" | "changes" | "reviews";

interface WorkspaceViewSnapshot {
  selectedFile: FileNode | null;
  explorerExpandedPaths: string[];
  activeTab: string;
  previousNonEditorTab: string | null;
  openIssueTabs: IssueWithEntity[];
  openSignalTabs: SignalWithEntity[];
  openNoteTabs: ReviewTab[];
  sidebarTab: WorkspaceSidebarTab;
}

export interface WorkspaceState {
  activeWorkspaceId: string | null;
  /** The currently loaded local UI snapshot, distinct from the domain workspace. */
  workspaceViewKey: string | null;
  workspaceViews: Record<string, WorkspaceViewSnapshot>;
  /** A new workspace may land on its newest run; restored views keep their tab. */
  workspaceViewNeedsDefaultRun: boolean;
  activeWorkspaceIdByProvider: Record<string, string>;
  selectedModelByProvider: Record<string, string>;
  selectedProviderId: string;
  thinkingEnabled: boolean;
  selectedFile: FileNode | null;
  selectedFileContent: FileContentResponse | null;
  isLoadingFileContent: boolean;
  fileContentError: string | null;
  /**
   * Expanded directory paths in the Files tree. Lives here (not in the
   * component) so the tree survives tab switches and panel toggles, which
   * unmount the explorer.
   */
  explorerExpandedPaths: string[];
  sidebarTab: WorkspaceSidebarTab;
  activeTab: "editor" | string;
  /** Tab that was active before "editor" was opened — used to restore on editor close. */
  previousNonEditorTab: string | null;
  /**
   * What the next message carries besides its text — files, issues, signals,
   * skills, and browser/code selections in one insertion-ordered list. See
   * `features/workspace/lib/composer-context.ts` for the union and its identity
   * rules; read it through `useComposerContext()`.
   */
  contextItems: ContextItem[];
  composerContextKey: string;
  composerContextReady: boolean;
  contextItemsByKey: Record<string, ContextItem[]>;
  draftTextByKey: Record<string, string>;
  selectedSubagentIdByRun: Record<string, string>;
  openIssueTabs: IssueWithEntity[];
  openSignalTabs: SignalWithEntity[];
  openNoteTabs: ReviewTab[];
  pendingGoal: string | null;
  pendingAutoExecute: boolean;
  /**
   * Purpose-scoped provider login terminal. Unlike the general workspace
   * terminal this may be shown in every mode, but only after an explicit
   * Sign in action. It is intentionally not part of persisted renderer state.
   */
  providerAuthTerminal: ProviderAuthTerminalState | null;
  pendingReviewTarget: {
    type: "uncommittedChanges" | "baseBranch" | "commit" | "custom";
    branch?: string;
    sha?: string;
    title?: string;
    instructions?: string;
  } | null;
  /**
   * The run tab to select once the workspace page mounts, instead of the newest
   * one. Set when the user jumps to a specific run from outside the page — the
   * background-runs dock — and consumed once by the run hook.
   */
  pendingRunId: string | null;
  /** Work/Chat: Collection assigned to the next new run; null is standalone. */
  selectedCollectionId: string | null;
}

const initialState: WorkspaceState = {
  activeWorkspaceId: null,
  workspaceViewKey: null,
  workspaceViews: {},
  workspaceViewNeedsDefaultRun: false,
  activeWorkspaceIdByProvider: {},
  selectedModelByProvider: {},
  selectedProviderId: PROVIDER_IDS.claude,
  thinkingEnabled: false,
  selectedFile: null,
  selectedFileContent: null,
  isLoadingFileContent: false,
  fileContentError: null,
  explorerExpandedPaths: [],
  sidebarTab: "files",
  activeTab: "editor",
  previousNonEditorTab: null,
  contextItems: [],
  composerContextKey: "default",
  composerContextReady: false,
  contextItemsByKey: {},
  draftTextByKey: {},
  selectedSubagentIdByRun: {},
  openIssueTabs: [],
  openSignalTabs: [],
  openNoteTabs: [],
  pendingGoal: null,
  pendingAutoExecute: false,
  providerAuthTerminal: null,
  pendingReviewTarget: null,
  pendingRunId: null,
  selectedCollectionId: null,
};

function snapshotWorkspaceView(state: WorkspaceState): WorkspaceViewSnapshot {
  return {
    selectedFile: state.selectedFile?.extension === "diff" ? null : state.selectedFile,
    explorerExpandedPaths: state.explorerExpandedPaths,
    activeTab: state.activeTab,
    previousNonEditorTab: state.previousNonEditorTab,
    openIssueTabs: state.openIssueTabs,
    openSignalTabs: state.openSignalTabs,
    openNoteTabs: state.openNoteTabs,
    sidebarTab: state.sidebarTab,
  };
}

function restoreWorkspaceView(state: WorkspaceState, view?: WorkspaceViewSnapshot): void {
  state.selectedFile = view?.selectedFile ?? null;
  state.selectedFileContent = null;
  state.fileContentError = null;
  state.isLoadingFileContent = false;
  state.explorerExpandedPaths = view?.explorerExpandedPaths ?? [];
  state.sidebarTab = view?.sidebarTab ?? "files";
  state.activeTab = view?.activeTab ?? "editor";
  state.previousNonEditorTab = view?.previousNonEditorTab ?? null;
  state.openIssueTabs = view?.openIssueTabs ?? [];
  state.openSignalTabs = view?.openSignalTabs ?? [];
  state.openNoteTabs = view?.openNoteTabs ?? [];
}

const workspaceSlice = createSlice({
  name: "workspace",
  initialState,
  reducers: {
    activateWorkspaceView: (
      state,
      action: PayloadAction<{ key: string; workspaceId: string | null; providerId: string }>,
    ) => {
      const { key, workspaceId, providerId } = action.payload;
      if (state.workspaceViewKey !== key) {
        if (state.workspaceViewKey) {
          state.workspaceViews[state.workspaceViewKey] = snapshotWorkspaceView(state);
        }
        const savedView = state.workspaceViews[key];
        restoreWorkspaceView(state, savedView);
        state.workspaceViewNeedsDefaultRun = !savedView;
        state.workspaceViewKey = key;
      }
      if (state.selectedProviderId !== providerId) state.providerAuthTerminal = null;
      state.activeWorkspaceId = workspaceId;
      state.selectedProviderId = providerId;
      if (workspaceId) state.activeWorkspaceIdByProvider[providerId] = workspaceId;
    },
    setComposerContextKey: (state, action: PayloadAction<string>) => {
      state.composerContextReady = true;
      const next = action.payload;
      if (state.composerContextKey === next) return;
      // Appshots are captured outside a chat and follow the next message,
      // even if the user navigates before sending it.
      const appshots = state.contextItems.filter((item) => item.kind === "appshot");
      state.contextItemsByKey[state.composerContextKey] = state.contextItems
        .filter((item) => item.kind !== "appshot");
      state.composerContextKey = next;
      const owned = state.contextItemsByKey[next] ?? [];
      state.contextItems = [...owned];
      for (const appshot of appshots) {
        if (!state.contextItems.some((item) => isSameContextItem(item, appshot))) {
          state.contextItems.push(appshot);
        }
      }
      state.contextItemsByKey[next] = state.contextItems;
    },
    setDraftText: (state, action: PayloadAction<{ key: string; text: string }>) => {
      if (action.payload.text) state.draftTextByKey[action.payload.key] = action.payload.text;
      else delete state.draftTextByKey[action.payload.key];
    },
    setWorkspaceSidebarTab: (state, action: PayloadAction<WorkspaceSidebarTab>) => {
      state.sidebarTab = action.payload;
    },
    setSelectedSubagentForRun: (
      state,
      action: PayloadAction<{ runId: string; subagentId: string | null }>,
    ) => {
      if (action.payload.subagentId) {
        state.selectedSubagentIdByRun[action.payload.runId] = action.payload.subagentId;
      } else {
        delete state.selectedSubagentIdByRun[action.payload.runId];
      }
    },
    setWorkspaceModel: (state, action: PayloadAction<{ providerId: string; model: string }>) => {
      state.selectedModelByProvider[action.payload.providerId] = action.payload.model;
    },
    setWorkspaceThinkingEnabled: (state, action: PayloadAction<boolean>) => {
      state.thinkingEnabled = action.payload;
    },
    setSelectedFile: (state, action: PayloadAction<FileNode | null>) => {
      state.selectedFile = action.payload;
      if (action.payload) {
        state.selectedFileContent = null;
        state.fileContentError = null;
      }
    },
    setSelectedFileContent: (state, action: PayloadAction<FileContentResponse | null>) => {
      state.selectedFileContent = action.payload;
      state.isLoadingFileContent = false;
    },
    setFileContentLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoadingFileContent = action.payload;
    },
    setFileContentError: (state, action: PayloadAction<string | null>) => {
      state.fileContentError = action.payload;
      state.isLoadingFileContent = false;
    },
    clearSelectedFile: (state) => {
      state.selectedFile = null;
      state.selectedFileContent = null;
      state.fileContentError = null;
      state.isLoadingFileContent = false;
    },
    toggleExplorerPath: (state, action: PayloadAction<string>) => {
      const idx = state.explorerExpandedPaths.indexOf(action.payload);
      if (idx === -1) state.explorerExpandedPaths.push(action.payload);
      else state.explorerExpandedPaths.splice(idx, 1);
    },
    // Union merge — used to reveal a selected file by expanding its ancestors.
    expandExplorerPaths: (state, action: PayloadAction<string[]>) => {
      for (const path of action.payload) {
        if (!state.explorerExpandedPaths.includes(path)) {
          state.explorerExpandedPaths.push(path);
        }
      }
    },
    collapseAllExplorerPaths: (state) => {
      state.explorerExpandedPaths = [];
    },
    setActiveTab: (state, action: PayloadAction<"editor" | string>) => {
      state.workspaceViewNeedsDefaultRun = false;
      // Remember which tab the user was on before opening the editor so we can
      // return there when the editor tab is closed (rather than jumping to runs[0]).
      if (action.payload === "editor" && state.activeTab !== "editor") {
        state.previousNonEditorTab = state.activeTab;
      }
      state.activeTab = action.payload;
    },
    /** Attach an item, unless the same one is already attached. */
    addContextItem: (state, action: PayloadAction<ContextItem>) => {
      const incoming = action.payload;
      if (!state.contextItems.some((item) => isSameContextItem(item, incoming))) {
        state.contextItems.push(incoming);
        state.contextItemsByKey[state.composerContextKey] = state.contextItems;
      }
    },
    addContextItemForKey: (
      state,
      action: PayloadAction<{ key: string; item: ContextItem }>,
    ) => {
      const { key, item } = action.payload;
      const current = key === state.composerContextKey
        ? state.contextItems
        : state.contextItemsByKey[key] ?? [];
      if (current.some((existing) => isSameContextItem(existing, item))) return;
      const next = [...current, item];
      state.contextItemsByKey[key] = next;
      if (key === state.composerContextKey) state.contextItems = next;
    },
    /**
     * Detach by kind + key rather than by object identity: the caller usually
     * holds a copy from a render, not the instance in the store.
     */
    removeContextItem: (
      state,
      action: PayloadAction<{ kind: ContextKind; key: string }>,
    ) => {
      const { kind, key } = action.payload;
      state.contextItems = state.contextItems.filter(
        (item) => item.kind !== kind || contextItemKey(item) !== key,
      );
      state.contextItemsByKey[state.composerContextKey] = state.contextItems;
    },
    clearContextItems: (state) => {
      state.contextItems = [];
      state.contextItemsByKey[state.composerContextKey] = [];
    },
    openIssueTab: (state, action: PayloadAction<IssueWithEntity>) => {
      const entityId = action.payload.issue.entityId;
      if (!state.openIssueTabs.some((t) => t.issue.entityId === entityId)) {
        state.openIssueTabs.push(action.payload);
      }
      state.activeTab = `issue:${entityId}`;
    },
    closeIssueTab: (state, action: PayloadAction<string>) => {
      const entityId = action.payload;
      state.openIssueTabs = state.openIssueTabs.filter(
        (t) => t.issue.entityId !== entityId,
      );
      if (state.activeTab === `issue:${entityId}`) {
        state.activeTab = "editor";
      }
    },
    clearIssueTabs: (state) => {
      state.openIssueTabs = [];
    },
    openSignalTab: (state, action: PayloadAction<SignalWithEntity>) => {
      const entityId = action.payload.signal.entityId;
      if (!state.openSignalTabs.some((t) => t.signal.entityId === entityId)) {
        state.openSignalTabs.push(action.payload);
      }
      state.activeTab = `signal:${entityId}`;
    },
    closeSignalTab: (state, action: PayloadAction<string>) => {
      const entityId = action.payload;
      state.openSignalTabs = state.openSignalTabs.filter(
        (t) => t.signal.entityId !== entityId,
      );
      if (state.activeTab === `signal:${entityId}`) {
        state.activeTab = "editor";
      }
    },
    clearSignalTabs: (state) => {
      state.openSignalTabs = [];
    },
    openNoteTab: (state, action: PayloadAction<ReviewTab>) => {
      if (!state.openNoteTabs.some((t) => t.id === action.payload.id)) {
        state.openNoteTabs.push(action.payload);
      }
      state.activeTab = `note:${action.payload.id}`;
    },
    closeNoteTab: (state, action: PayloadAction<string>) => {
      const noteId = action.payload;
      state.openNoteTabs = state.openNoteTabs.filter((t) => t.id !== noteId);
      if (state.activeTab === `note:${noteId}`) {
        state.activeTab = "editor";
      }
    },
    clearNoteTabs: (state) => {
      state.openNoteTabs = [];
    },
    openNewRunTab: (state) => {
      state.activeTab = "new-run";
    },
    closeNewRunTab: (state) => {
      if (state.activeTab === "new-run") {
        state.activeTab = "editor";
      }
    },
    setPendingGoal: (state, action: PayloadAction<string>) => {
      state.pendingGoal = action.payload;
    },
    setPendingAutoExecute: (state, action: PayloadAction<boolean>) => {
      state.pendingAutoExecute = action.payload;
    },
    clearPendingGoal: (state) => {
      state.pendingGoal = null;
      state.pendingAutoExecute = false;
    },
    openProviderAuthTerminal: (
      state,
      action: PayloadAction<{ providerId: string; command: string }>,
    ) => {
      state.providerAuthTerminal = {
        providerId: action.payload.providerId,
        pendingCommand: action.payload.command,
      };
    },
    markProviderAuthCommandSent: (state) => {
      if (state.providerAuthTerminal) {
        state.providerAuthTerminal.pendingCommand = null;
      }
    },
    closeProviderAuthTerminal: (state) => {
      state.providerAuthTerminal = null;
    },
    setPendingReviewTarget: (state, action: PayloadAction<WorkspaceState["pendingReviewTarget"]>) => {
      state.pendingReviewTarget = action.payload;
    },
    clearPendingReviewTarget: (state) => {
      state.pendingReviewTarget = null;
    },
    setPendingRunId: (state, action: PayloadAction<string>) => {
      state.pendingRunId = action.payload;
    },
    clearPendingRunId: (state) => {
      state.pendingRunId = null;
    },
    setSelectedCollectionId: (state, action: PayloadAction<string | null>) => {
      state.selectedCollectionId = action.payload;
    },
  },
});

export const {
  activateWorkspaceView,
  setComposerContextKey,
  setDraftText,
  setWorkspaceSidebarTab,
  setSelectedSubagentForRun,
  setWorkspaceModel,
  setWorkspaceThinkingEnabled,
  setSelectedFile,
  setSelectedFileContent,
  setFileContentLoading,
  setFileContentError,
  clearSelectedFile,
  toggleExplorerPath,
  expandExplorerPaths,
  collapseAllExplorerPaths,
  setActiveTab,
  addContextItem,
  addContextItemForKey,
  removeContextItem,
  clearContextItems,
  openIssueTab,
  closeIssueTab,
  clearIssueTabs,
  openSignalTab,
  closeSignalTab,
  clearSignalTabs,
  openNoteTab,
  closeNoteTab,
  clearNoteTabs,
  openNewRunTab,
  closeNewRunTab,
  setPendingGoal,
  setPendingAutoExecute,
  clearPendingGoal,
  openProviderAuthTerminal,
  markProviderAuthCommandSent,
  closeProviderAuthTerminal,
  setPendingReviewTarget,
  clearPendingReviewTarget,
  setPendingRunId,
  clearPendingRunId,
  setSelectedCollectionId,
} = workspaceSlice.actions;

export default workspaceSlice.reducer;
