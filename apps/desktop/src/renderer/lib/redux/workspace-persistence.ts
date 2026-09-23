import { createMigrate, createTransform, type PersistedState } from "redux-persist";
import storage from "redux-persist/lib/storage";
import type { FileNode } from "@/features/workspace/types/file-explorer";

// Generated diffs have no file to reload: their content only lives in the
// current renderer. Apply on both save and restore for states saved before this
// transform existed.
const selectedFileTransform = createTransform<FileNode | null, FileNode | null>(
  (file) => file?.extension === "diff" ? null : file,
  (file) => file?.extension === "diff" ? null : file,
  { whitelist: ["selectedFile"] },
);

const workspaceMigrations = {
  // Older builds saved the selected subagent for each run. That selection is
  // now only component state, so remove existing entries during rehydration.
  0: (state: PersistedState): PersistedState => {
    if (!state) return state;
    const next = { ...state };
    delete (next as { selectedSubagentIdByRun?: unknown }).selectedSubagentIdByRun;
    return next;
  },
};

export const workspacePersistConfig = {
  key: "workspace",
  storage,
  version: 0,
  migrate: createMigrate(workspaceMigrations),
  transforms: [selectedFileTransform],
  whitelist: [
    "selectedModelByProvider",
    "selectedProviderId",
    "thinkingEnabled",
    "activeWorkspaceIdByProvider",
    "workspaceViewKey",
    "workspaceViews",
    "selectedFile",
    "explorerExpandedPaths",
    "sidebarTab",
    "activeTab",
    "previousNonEditorTab",
    "openIssueTabs",
    "openSignalTabs",
    "openNoteTabs",
    "composerContextKey",
    "draftTextByKey",
    "selectedCollectionId",
  ],
};
