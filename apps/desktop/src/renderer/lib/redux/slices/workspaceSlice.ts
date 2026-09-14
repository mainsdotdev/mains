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

export interface WorkspaceState {
  activeWorkspaceId: string | null;
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
  activeWorkspaceIdByProvider: {},
  selectedModelByProvider: {},
  selectedProviderId: PROVIDER_IDS.claude,
  thinkingEnabled: false,
  selectedFile: null,
  selectedFileContent: null,
  isLoadingFileContent: false,
  fileContentError: null,
  explorerExpandedPaths: [],
  activeTab: "editor",
  previousNonEditorTab: null,
  contextItems: [],
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

const workspaceSlice = createSlice({
  name: "workspace",
  initialState,
  reducers: {
    setActiveWorkspaceId: (state, action: PayloadAction<string | null>) => {
      // Switching workspaces invalidates any cached file content — drop it so
      // large text buffers (multi-MB source files) don't linger in Redux.
      if (state.activeWorkspaceId !== action.payload) {
        state.selectedFile = null;
        state.selectedFileContent = null;
        state.fileContentError = null;
        state.isLoadingFileContent = false;
        state.explorerExpandedPaths = [];
        state.previousNonEditorTab = null;
        // The tab is a single global field, so it would otherwise still name a
        // run belonging to the workspace being left. "editor" is the neutral
        // tab, and the page picks the newest run from there when there is one.
        state.activeTab = "editor";
      }
      state.activeWorkspaceId = action.payload;
    },
    setActiveWorkspaceForProvider: (state, action: PayloadAction<{ providerId: string; workspaceId: string }>) => {
      const prev = state.activeWorkspaceIdByProvider[action.payload.providerId];
      if (prev !== action.payload.workspaceId) {
        state.selectedFile = null;
        state.selectedFileContent = null;
        state.fileContentError = null;
        state.isLoadingFileContent = false;
        state.explorerExpandedPaths = [];
        state.previousNonEditorTab = null;
        state.activeTab = "editor";
      }
      state.activeWorkspaceIdByProvider[action.payload.providerId] = action.payload.workspaceId;
    },
    setWorkspaceModel: (state, action: PayloadAction<{ providerId: string; model: string }>) => {
      state.selectedModelByProvider[action.payload.providerId] = action.payload.model;
    },
    setWorkspaceProvider: (state, action: PayloadAction<string>) => {
      // A space switch can land on the SAME workspace, so the workspace-switch
      // resets above never fire — the tab (or its editor fallback) would keep
      // naming a run from the provider being left.
      if (state.selectedProviderId !== action.payload) {
        state.previousNonEditorTab = null;
        state.activeTab = "editor";
        // A login PTY belongs to the provider that opened it. Never carry its
        // prompt or a not-yet-written command into the next space.
        state.providerAuthTerminal = null;
      }
      state.selectedProviderId = action.payload;
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
      }
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
    },
    clearContextItems: (state) => {
      state.contextItems = [];
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
  setActiveWorkspaceId,
  setActiveWorkspaceForProvider,
  setWorkspaceModel,
  setWorkspaceProvider,
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
