import { lazy, type ComponentType, type ElementType } from "react";
import {
  Archive,
  Branch,
  Chart,
  Codex,
  Connect,
  CopilotStatic,
  Cursor,
  General,
  Relay,
} from "@/components/ui/icons";
import { Claude } from "@/components/ui/icons/space";
import GeneralSettings from "./components/general";
import GitSettings from "./components/git";
import { PlaceholderSection } from "./components/settings-layout";

const PersonalizationSettings = lazy(
  () => import("./components/personalization"),
);
const ConnectionsSettings = lazy(
  () => import("./components/connections/connections"),
);
const ClaudeSettings = lazy(() => import("./components/claude"));
const CopilotSettings = lazy(() => import("./components/copilot"));
const CodexSettings = lazy(() => import("./components/codex"));
// The Codex settings section renders the shared ProviderPlugins component with
// its default (codex) provider.
const CodexPlugins = lazy(() => import("./components/provider-plugins"));
const CursorSettings = lazy(() => import("./components/cursor"));
const ProjectsSettings = lazy(() => import("./components/projects"));
const ArchiveSettings = lazy(() => import("./components/archive"));
const BackendsSettings = lazy(() => import("@/features/relay/components/backends"));
const DashboardPage = lazy(
  () => import("@/features/stats/components/dashboard-page"),
);

const NotificationsSettings = () => <PlaceholderSection title="Notifications" />;
const SchedulesSettings = () => <PlaceholderSection title="Schedules" />;
const SecuritySettings = () => <PlaceholderSection title="Security" />;

export type SettingsRouteId =
  | "general"
  | "notifications"
  | "personalization"
  | "connections"
  | "schedules"
  | "security"
  | "claude"
  | "copilot"
  | "git"
  | "projects"
  | "codex"
  | "codex-plugins"
  | "cursor"
  | "backends"
  | "archive"
  | "dashboard";

export type SettingsSection = {
  id: SettingsRouteId;
  label: string;
  icon?: ElementType;
  showInNav?: boolean;
  activeIds?: SettingsRouteId[];
  Component: ComponentType;
};

export type SettingsNavItem = {
  id: SettingsRouteId;
  label: string;
  icon: ElementType | null;
  activeIds?: SettingsRouteId[];
};

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "general", label: "General", icon: General, showInNav: true, Component: GeneralSettings },
  { id: "git", label: "Git", icon: Branch, showInNav: true, Component: GitSettings },
  { id: "connections", label: "Connections", icon: Connect, showInNav: true, Component: ConnectionsSettings },
  // Hidden from the Settings nav — surfaced as the top-level "Relay" route instead.
  { id: "backends", label: "Relay", icon: Relay, Component: BackendsSettings },
  { id: "dashboard", label: "Dashboard", icon: Chart, showInNav: true, Component: DashboardPage },
  { id: "archive", label: "Archive", icon: Archive, showInNav: true, Component: ArchiveSettings },

  { id: "claude", label: "Claude", icon: Claude, Component: ClaudeSettings },
  {
    id: "codex",
    label: "Codex",
    icon: Codex,
    activeIds: ["codex", "codex-plugins"],
    Component: CodexSettings,
  },
  { id: "copilot", label: "Copilot", icon: CopilotStatic, Component: CopilotSettings },
  { id: "cursor", label: "Cursor", icon: Cursor, Component: CursorSettings },

  { id: "notifications", label: "Notifications", Component: NotificationsSettings },
  { id: "personalization", label: "Personalization", Component: PersonalizationSettings },
  { id: "schedules", label: "Schedules", Component: SchedulesSettings },
  { id: "security", label: "Security", Component: SecuritySettings },
  { id: "projects", label: "Projects", Component: ProjectsSettings },
  { id: "codex-plugins", label: "Codex Plugins", Component: CodexPlugins },
];

const SECTION_BY_ID = new Map<SettingsRouteId, SettingsSection>(
  SETTINGS_SECTIONS.map((section) => [section.id, section]),
);

const toNavItem = (section: SettingsSection): SettingsNavItem => ({
  id: section.id,
  label: section.label,
  icon: section.icon ?? null,
  activeIds: section.activeIds,
});

export const SETTINGS_MAIN_NAV_ITEMS: readonly SettingsNavItem[] =
  SETTINGS_SECTIONS.filter((s) => s.showInNav).map(toNavItem);

const SETTINGS_ROUTE_ID_SET = new Set<string>(
  SETTINGS_SECTIONS.map((section) => section.id),
);

export function isSettingsRouteId(value: string | null): value is SettingsRouteId {
  return value !== null && SETTINGS_ROUTE_ID_SET.has(value);
}

export function getSettingsRouteId(value: string | null): SettingsRouteId {
  return isSettingsRouteId(value) ? value : "general";
}

export function getSettingsSection(id: SettingsRouteId): SettingsSection {
  return SECTION_BY_ID.get(id) ?? SECTION_BY_ID.get("general")!;
}

export function isSettingsNavItemActive(
  item: SettingsNavItem,
  activeSection: SettingsRouteId | null,
) {
  return activeSection
    ? (item.activeIds ?? [item.id]).includes(activeSection)
    : false;
}
