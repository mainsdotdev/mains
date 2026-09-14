// ─────────────────────────────────────────────────────────────
// Mode-config descriptor
//
// One table answering "what does the app look like in mode X?" — sidebar,
// right panel, default route. The sibling of `provider-variants.ts`: that
// table shapes the UI per agent *engine*, this one per *experience*
// (developer / work / chat, see `src/shared/modes.ts`).
//
// This is code, not data: the values were identical across every space row
// when they lived in the `spaces.uiConfig` JSON blob, so they moved here
// where a change shows up in a diff and a typo fails to compile. Anything
// that genuinely varies per space lives as a typed column on `spaces`
// (`providerId`, `mode`, `themeConfig`, ...).
// ─────────────────────────────────────────────────────────────

import { DEFAULT_MODE_ID, isModeId, type ModeId } from "../../shared/modes";

export type SidebarItemType = "workspace" | "chat";

export interface ModeSidebarConfig {
  /** Noun after the new-button prefix ("Add Project", "New chat"). */
  title: string;
  /** What the sidebar lists: workspaces (developer) or chats (= runs). */
  itemType: SidebarItemType;
  /** New-button verb: developer "Add", chat/work "New". */
  actionPrefix: string;
  defaultRoute: string;
}

export interface ModeRightPanelConfig {
  /** Key into `PANEL_COMPONENTS` (right-panel/panel-components.ts). */
  component: string;
}

export interface ModeComposerPlaceholder {
  /** Empty composer, new chat. */
  initial: string;
  /** Empty composer, continuing a resumable run. */
  followUp: string;
}

export interface ModeConfigDescriptor {
  mode: ModeId;
  /** Human-facing name for the mode picker. */
  label: string;
  sidebar: ModeSidebarConfig;
  /**
   * Composer placeholder per mode: developer advertises files because the
   * agent edits them; work and chat leave them out.
   */
  composerPlaceholder: ModeComposerPlaceholder;
  rightPanel: ModeRightPanelConfig;
  /** Session panel with the git-actions menu, and its trigger. */
  showGitActions: boolean;
  /** Terminal section + the right-panel terminal toggle. */
  showTerminal: boolean;
  /** The right panel's Changes (git diff) tab. */
  showChangesTab: boolean;
  /** Permission/sandbox dropdown in the composer toolbar. */
  showPermissionControls: boolean;
  /** Plan-mode toggle in the composer toolbar. */
  showPlanControls: boolean;
  /** Goal-mode toggle in the composer toolbar. */
  showGoalControls: boolean;
  /** Tasks entry in the sidebar nav block. */
  showTasksNav: boolean;
  /** Tab strip above the content; false = tab-less single-chat view. */
  showTabs: boolean;
  /**
   * Plugins picker in the composer toolbar. Developer reaches plugins through
   * the `$` / `@` menus; work gets a visible entry point instead.
   */
  showPluginsButton: boolean;
  /**
   * The right panel (Files/Changes/Activity) and its open/close toggle.
   * The browser toggle is independent and survives without it.
   */
  showRightPanel: boolean;
  /**
   * Keep file-writing tool calls out of the turn accordion.
   *
   * In Code a turn is dozens of edits and collapsing them is the whole point.
   * In Work the file *is* the deliverable — the agent names it in prose but the
   * only way to open it is the Write row, which is exactly what the accordion
   * was hiding. Same reasoning that already keeps generated media visible.
   */
  keepFileWritesVisible: boolean;
}

export const MODE_CONFIGS: Record<ModeId, ModeConfigDescriptor> = {
  developer: {
    mode: "developer",
    label: "Code",
    sidebar: {
      title: "Project",
      itemType: "workspace",
      actionPrefix: "Add",
      defaultRoute: "/code",
    },
    composerPlaceholder: {
      initial:
        "Ask to edit, use @ or / for commands, files, plugins, and skills",
      followUp:
        "Ask a follow-up, use @ or / for commands, files, plugins, and skills",
    },
    rightPanel: { component: "workspace" },
    showGitActions: true,
    showTerminal: true,
    showChangesTab: true,
    showPermissionControls: true,
    showPlanControls: true,
    showGoalControls: true,
    showTasksNav: true,
    showTabs: true,
    showPluginsButton: false,
    showRightPanel: true,
    keepFileWritesVisible: false,
  },
  // Work: same surfaces minus the developer ceremony — no git actions, no
  // terminal, no diff tab, no permission dropdown (the harness pins
  // acceptEdits). Plan mode goes with the permission dropdown, whose menu
  // hosts it. Files + Activity stay: deliverables are files. Model-level
  // controls (model select, effort, thinking, fast mode) stay in every mode.
  work: {
    mode: "work",
    label: "Work",
    sidebar: {
      title: "chat",
      itemType: "chat",
      actionPrefix: "New",
      defaultRoute: "/code",
    },
    composerPlaceholder: {
      initial: "Ask for help with a task, use @ or / for commands, plugins, and skills",
      followUp: "Ask a follow-up, use @ or / for commands, plugins, and skills",
    },
    rightPanel: { component: "workspace" },
    showGitActions: false,
    showTerminal: false,
    showChangesTab: false,
    showPermissionControls: false,
    showPlanControls: false,
    showGoalControls: true,
    showTasksNav: false,
    showTabs: false,
    showPluginsButton: true,
    showRightPanel: false,
    keepFileWritesVisible: true,
  },
  // Chat: plain conversation — read-only harness, so every write-adjacent
  // affordance goes. Files tab stays for viewing.
  chat: {
    mode: "chat",
    label: "Chat",
    sidebar: {
      title: "chat",
      itemType: "chat",
      actionPrefix: "New",
      defaultRoute: "/code",
    },
    composerPlaceholder: {
      initial: "Ask anything, use @ or / for commands, plugins, and skills",
      followUp: "Ask a follow-up, use @ or / for commands, plugins, and skills",
    },
    rightPanel: { component: "workspace" },
    showGitActions: false,
    showTerminal: false,
    showChangesTab: false,
    showPermissionControls: false,
    showPlanControls: false,
    showGoalControls: false,
    showTasksNav: false,
    showTabs: false,
    showPluginsButton: false,
    showRightPanel: false,
    keepFileWritesVisible: false,
  },
};

/** Descriptor for a mode id; unknown/absent ids resolve to the default mode. */
export function getModeConfig(mode: string | null | undefined): ModeConfigDescriptor {
  return MODE_CONFIGS[isModeId(mode) ? mode : DEFAULT_MODE_ID];
}
