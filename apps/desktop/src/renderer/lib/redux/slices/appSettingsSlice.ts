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
  isFontFamily,
} from "@/lib/appearance-fonts";
import type { DocType } from "@/lib/document-viewer";
import {
  DEFAULT_APP_THEME_SETTINGS,
  applyThemeChoice,
  type AppThemeSettings,
  type ThemeChoiceChange,
} from "@/lib/app-themes";
import { isNewRunTab } from "@/features/workspace/lib/repo-utils";
import { openNewRunTab, setActiveTab } from "./workspaceSlice";
import { isWorkspaceDraftOwnerKey, runOwnerKey } from "../../../../shared/ui-state-keys";

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
  activeRightPaneContextKey: string;
  rightPaneByContext: Record<string, "none" | "workspace" | "browser" | "document">;
  /** Loaded documents only live for this app session. */
  documentViewerDocByContext: Record<string, DocumentViewerDoc>;
  /**
   * Whether the session panel (environment / sources / deliverables) is open.
   * Deliberately not persisted: it is a temporary overlay and closes when
   * the conversation changes.
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
  /** App themes — the default and per-provider overrides (`lib/app-themes.ts`). */
  appTheme: AppThemeSettings;
  /** Root font size in pixels. Rescales every rem-based dimension. */
  interfaceFontSize: number;
  /** Code / diff font size in pixels. Absolute so it never scales twice. */
  codeFontSize: number;
  /** UI font as a CSS family; `""` is Inter (`lib/appearance-fonts.ts`). */
  uiFontFamily: string;
  /** Code font as a CSS family; `""` is the system monospace. */
  codeFontFamily: string;
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
  activeRightPaneContextKey: "default",
  rightPaneByContext: {},
  documentViewerDocByContext: {},
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
  appTheme: DEFAULT_APP_THEME_SETTINGS,
  interfaceFontSize: DEFAULT_INTERFACE_FONT_SIZE,
  codeFontSize: DEFAULT_CODE_FONT_SIZE,
  uiFontFamily: "",
  codeFontFamily: "",
  bottomTerminalOpen: false,
  workspaceListGrouping: "none",
  workspaceGroupExpanded: {},
  onboardingCliAutoSelectApplied: false,
};

const appSettingsSlice = createSlice({
  name: "appSettings",
  initialState,
  reducers: {
    setRightPaneContextKey: (state, action: PayloadAction<string>) => {
      const next = action.payload;
      if (state.activeRightPaneContextKey === next) return;
      const previousPane = state.documentViewerOpen && state.documentViewerDoc
        ? "document"
        : state.browserPanelOpen
        ? "browser"
        : state.rightPanelOpen
          ? "workspace"
          : "none";
      state.rightPaneByContext[state.activeRightPaneContextKey] = previousPane;
      if (previousPane === "document" && state.documentViewerDoc) {
        state.documentViewerDocByContext[state.activeRightPaneContextKey] = state.documentViewerDoc;
      } else {
        delete state.documentViewerDocByContext[state.activeRightPaneContextKey];
      }
      state.activeRightPaneContextKey = next;
      const pane = state.rightPaneByContext[next] ?? "none";
      state.rightPanelOpen = pane === "workspace";
      state.browserPanelOpen = pane === "browser";
      state.documentViewerDoc = pane === "document"
        ? state.documentViewerDocByContext[next] ?? null
        : null;
      state.documentViewerOpen = !!state.documentViewerDoc;
      state.sessionPanelOpen = false;
    },
    forgetRunRightPane: (state, action: PayloadAction<{ backendId: string; runId: string }>) => {
      const key = runOwnerKey(action.payload.backendId, action.payload.runId);
      delete state.rightPaneByContext[key];
      delete state.documentViewerDocByContext[key];
      if (state.activeRightPaneContextKey === key) {
        state.activeRightPaneContextKey = "default";
        state.rightPanelOpen = false;
        state.browserPanelOpen = false;
        state.documentViewerOpen = false;
        state.documentViewerDoc = null;
        state.sessionPanelOpen = false;
      }
    },
    forgetWorkspaceRightPanes: (state, action: PayloadAction<{ backendId: string; workspaceId: string }>) => {
      const { backendId, workspaceId } = action.payload;
      for (const key of Object.keys(state.rightPaneByContext)) {
        if (isWorkspaceDraftOwnerKey(key, backendId, workspaceId)) delete state.rightPaneByContext[key];
      }
      for (const key of Object.keys(state.documentViewerDocByContext)) {
        if (isWorkspaceDraftOwnerKey(key, backendId, workspaceId)) delete state.documentViewerDocByContext[key];
      }
      if (isWorkspaceDraftOwnerKey(state.activeRightPaneContextKey, backendId, workspaceId)) {
        state.activeRightPaneContextKey = "default";
        state.rightPanelOpen = false;
        state.browserPanelOpen = false;
        state.documentViewerOpen = false;
        state.documentViewerDoc = null;
        state.sessionPanelOpen = false;
      }
    },
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
    setThemeChoice: (state, action: PayloadAction<ThemeChoiceChange>) => {
      state.appTheme = applyThemeChoice(state.appTheme, action.payload);
    },
    setInterfaceFontSize: (state, action: PayloadAction<number>) => {
      state.interfaceFontSize = clampInterfaceFontSize(action.payload);
    },
    setCodeFontSize: (state, action: PayloadAction<number>) => {
      state.codeFontSize = clampCodeFontSize(action.payload);
    },
    setFontFamily: (
      state,
      action: PayloadAction<{ target: "ui" | "code"; family: string }>,
    ) => {
      const { target, family } = action.payload;
      if (!isFontFamily(family)) return;
      if (target === "ui") state.uiFontFamily = family;
      else state.codeFontFamily = family;
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
  setRightPaneContextKey,
  forgetRunRightPane,
  forgetWorkspaceRightPanes,
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
  setThemeChoice,
  setInterfaceFontSize,
  setCodeFontSize,
  setFontFamily,
  setBottomTerminalOpen,
  setWorkspaceListGrouping,
  setWorkspaceGroupExpanded,
  setOnboardingCliAutoSelectApplied,
} = appSettingsSlice.actions;
export default appSettingsSlice.reducer;
