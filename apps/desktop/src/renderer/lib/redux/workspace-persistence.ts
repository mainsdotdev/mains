import { createMigrate, createTransform, type PersistedState } from "redux-persist";
import storage from "redux-persist/lib/storage";
import type { FileNode } from "@/features/workspace/types/file-explorer";
import type { ConversationSettings } from "@mains/contracts/run-settings";
import type { ReviewFileState } from "./slices/workspaceSlice";

// Conversation preferences are canonical backend data; drafts and the last-used
// new-run defaults also survive renderer restarts locally.
function draftSettingsOnly(settings: Record<string, ConversationSettings>) {
  return Object.fromEntries(Object.entries(settings).filter(([key]) => {
    try { return JSON.parse(key)?.[1] === "draft"; } catch { return false; }
  }));
}
const conversationSettingsTransform = createTransform(
  draftSettingsOnly, draftSettingsOnly, { whitelist: ["conversationSettingsByKey"] },
);

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
  1: (state: PersistedState): PersistedState => {
    if (!state) return state;
    const next = { ...state } as NonNullable<PersistedState> & {
      reviewedFilesByWorkspace?: Record<string, Record<string, string>>;
      reviewFileStatesByWorkspace?: Record<string, Record<string, ReviewFileState>>;
    };
    next.reviewFileStatesByWorkspace ??= Object.fromEntries(
      Object.entries(next.reviewedFilesByWorkspace ?? {}).map(([key, files]) => [key,
        Object.fromEntries(Object.entries(files).map(([path, patchId]) => [path, { patchId, reviewed: true, collapsed: true }])),
      ]),
    );
    delete next.reviewedFilesByWorkspace;
    return next;
  },
};

export const workspacePersistConfig = {
  key: "workspace",
  storage,
  version: 1,
  migrate: createMigrate(workspaceMigrations),
  transforms: [selectedFileTransform, conversationSettingsTransform],
  whitelist: [
    "selectedModelByProvider",
    "conversationSettingsByKey",
    "lastRunSettingsByProvider",
    "selectedProviderId",
    "thinkingEnabled",
    "activeWorkspaceIdByProvider",
    "workspaceViewKey",
    "workspaceViews",
    "reviewFileStatesByWorkspace",
    "selectedFile",
    "explorerExpandedPaths",
    "sidebarTab",
    "activeTab",
    "previousNonEditorTab",
    "openIssueTabs",
    "openSignalTabs",
    "openNoteTabs",
    "reviewTabOpen",
    "reviewRunId",
    "composerContextKey",
    "draftTextByKey",
    "mcpAppRunIdByKey",
    "selectedCollectionId",
  ],
};
