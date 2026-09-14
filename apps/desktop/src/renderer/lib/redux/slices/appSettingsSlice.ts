import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import {
  SIDEBAR_WIDTH_DEFAULT,
  PANEL_WIDTH_DEFAULT,
  BROWSER_PANEL_WIDTH_DEFAULT,
  DOC_VIEWER_PANEL_WIDTH_DEFAULT,
  TASKS_DETAIL_WIDTH_DEFAULT,
} from "@/lib/layout";
import {
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_INTERFACE_FONT_SIZE,
  clampCodeFontSize,
  clampInterfaceFontSize,
} from "@/lib/appearance-fonts";
import type { DocType } from "@/lib/document-viewer";
import { isNewRunTab } from "@/features/workspace/lib/repo-utils";
import { openNewRunTab, setActiveTab } from "./workspaceSlice";

/** The document currently shown in the document viewer panel. */
export interface DocumentViewerDoc {
  path: string;
  fileName: string;
  docType: DocType;
}

export type ThemePreference = "light" | "dark" | "system";

export type WorkspaceGrouping = "none" | "status" | "project";

export const isThemePreference = (value: unknown): value is ThemePreference =>
  value === "light" || value === "dark" || value === "system";

export interface AppSettingsState {
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  browserPanelOpen: boolean;
  /**
   * Whether the session panel (changes / git actions / subagents) is open.
   * Deliberately not persisted: it reads the run open in the workspace, and
   * that isn't restored on boot — reopening onto an empty panel would confuse.
   */
  sessionPanelOpen: boolean;
  /**
   * Pill-vs-list preference of the bottom-right subagent panel. Persisted:
   * whether the panel shows at all tracks the run's agents automatically, but
   * its shape is the user's lasting choice — a new spawn must not force the
   * list open on someone who parked it as a pill.
   */
  subagentPanelCollapsed: boolean;
  onboardingCompleted: boolean;
  sidebarWidth: number;
  /** Right panel width in pixels. Mirrored onto `--panel-width`. */
  rightPanelWidth: number;
  /** Embedded browser panel width in pixels. Mirrored onto `--browser-panel-width`. */
  browserPanelWidth: number;
  /** Whether the in-app document viewer panel is open. */
  documentViewerOpen: boolean;
  /** Document viewer panel width in pixels. Mirrored onto `--doc-viewer-panel-width`. */
  documentViewerWidth: number;
  /** The document currently loaded in the viewer (not persisted — avoids stale auto-reopen). */
  documentViewerDoc: DocumentViewerDoc | null;
  /** Width of the /tasks detail drawer in pixels. */
  tasksDetailWidth: number;
  /** Light / dark / follow-the-OS. Applied to `<html class="dark">`. */
  theme: ThemePreference;
  /** Root font size in pixels. Rescales every rem-based dimension. */
  interfaceFontSize: number;
  /** Code / diff font size in pixels. Absolute so it never scales twice. */
  codeFontSize: number;
  /** Whether the bottom terminal drawer is open. */
  bottomTerminalOpen: boolean;
  /** How the sidebar workspace list is grouped. */
  workspaceListGrouping: WorkspaceGrouping;
  /** Sidebar group key → expanded. Absent means expanded (the default). */
  workspaceGroupExpanded: Record<string, boolean>;
  /** Onboarding ran its one-time "disable agents whose CLI is missing" pass. */
  onboardingCliAutoSelectApplied: boolean;
}

const initialState: AppSettingsState = {
  sidebarCollapsed: false,
  rightPanelOpen: false,
  browserPanelOpen: false,
  sessionPanelOpen: false,
  subagentPanelCollapsed: false,
  onboardingCompleted: false,
  sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
  rightPanelWidth: PANEL_WIDTH_DEFAULT,
  browserPanelWidth: BROWSER_PANEL_WIDTH_DEFAULT,
  documentViewerOpen: false,
  documentViewerWidth: DOC_VIEWER_PANEL_WIDTH_DEFAULT,
  documentViewerDoc: null,
  tasksDetailWidth: TASKS_DETAIL_WIDTH_DEFAULT,
  theme: "system",
  interfaceFontSize: DEFAULT_INTERFACE_FONT_SIZE,
  codeFontSize: DEFAULT_CODE_FONT_SIZE,
  bottomTerminalOpen: false,
  workspaceListGrouping: "none",
  workspaceGroupExpanded: {},
  onboardingCliAutoSelectApplied: false,
};

const appSettingsSlice = createSlice({
  name: "appSettings",
  initialState,
  reducers: {
    setSidebarCollapsed: (state, action: PayloadAction<boolean>) => {
      state.sidebarCollapsed = action.payload;
    },
    setBrowserPanelOpen: (state, action: PayloadAction<boolean>) => {
      state.browserPanelOpen = action.payload;
    },
    setRightPanelOpen: (state, action: PayloadAction<boolean>) => {
      state.rightPanelOpen = action.payload;
    },
    setSessionPanelOpen: (state, action: PayloadAction<boolean>) => {
      state.sessionPanelOpen = action.payload;
    },
    setSubagentPanelCollapsed: (state, action: PayloadAction<boolean>) => {
      state.subagentPanelCollapsed = action.payload;
    },
    setOnboardingCompleted: (state, action: PayloadAction<boolean>) => {
      state.onboardingCompleted = action.payload;
    },
    setSidebarWidth: (state, action: PayloadAction<number>) => {
      state.sidebarWidth = action.payload;
    },
    setRightPanelWidth: (state, action: PayloadAction<number>) => {
      state.rightPanelWidth = action.payload;
    },
    setBrowserPanelWidth: (state, action: PayloadAction<number>) => {
      state.browserPanelWidth = action.payload;
    },
    setDocumentViewerOpen: (state, action: PayloadAction<boolean>) => {
      state.documentViewerOpen = action.payload;
    },
    setDocumentViewerPanelWidth: (state, action: PayloadAction<number>) => {
      state.documentViewerWidth = action.payload;
    },
    setTasksDetailWidth: (state, action: PayloadAction<number>) => {
      state.tasksDetailWidth = action.payload;
    },
    setDocumentViewerDoc: (
      state,
      action: PayloadAction<DocumentViewerDoc | null>,
    ) => {
      state.documentViewerDoc = action.payload;
    },
    setTheme: (state, action: PayloadAction<ThemePreference>) => {
      state.theme = action.payload;
    },
    setInterfaceFontSize: (state, action: PayloadAction<number>) => {
      state.interfaceFontSize = clampInterfaceFontSize(action.payload);
    },
    setCodeFontSize: (state, action: PayloadAction<number>) => {
      state.codeFontSize = clampCodeFontSize(action.payload);
    },
    setBottomTerminalOpen: (state, action: PayloadAction<boolean>) => {
      state.bottomTerminalOpen = action.payload;
    },
    setWorkspaceListGrouping: (
      state,
      action: PayloadAction<WorkspaceGrouping>,
    ) => {
      state.workspaceListGrouping = action.payload;
    },
    setWorkspaceGroupExpanded: (
      state,
      action: PayloadAction<{ groupKey: string; expanded: boolean }>,
    ) => {
      state.workspaceGroupExpanded[action.payload.groupKey] =
        action.payload.expanded;
    },
    setOnboardingCliAutoSelectApplied: (
      state,
      action: PayloadAction<boolean>,
    ) => {
      state.onboardingCliAutoSelectApplied = action.payload;
    },
  },
  // A new-run tab has no session yet: no run, no subagents, and whatever the
  // panel was showing belonged to the tab the user just left. Closing it here
  // rather than at the call sites covers every way in (the "+" button, picking
  // the tab, restoring it after a close) with one rule. Reopening it by hand on
  // a new-run tab still works — this reacts to the switch, not to the tab.
  extraReducers: (builder) => {
    builder
      .addCase(openNewRunTab, (state) => {
        state.sessionPanelOpen = false;
      })
      .addCase(setActiveTab, (state, action) => {
        if (isNewRunTab(action.payload)) state.sessionPanelOpen = false;
      });
  },
});

export const {
  setSidebarCollapsed,
  setBrowserPanelOpen,
  setRightPanelOpen,
  setSessionPanelOpen,
  setSubagentPanelCollapsed,
  setOnboardingCompleted,
  setSidebarWidth,
  setRightPanelWidth,
  setBrowserPanelWidth,
  setDocumentViewerOpen,
  setDocumentViewerPanelWidth,
  setTasksDetailWidth,
  setDocumentViewerDoc,
  setTheme,
  setInterfaceFontSize,
  setCodeFontSize,
  setBottomTerminalOpen,
  setWorkspaceListGrouping,
  setWorkspaceGroupExpanded,
  setOnboardingCliAutoSelectApplied,
} = appSettingsSlice.actions;
export default appSettingsSlice.reducer;
