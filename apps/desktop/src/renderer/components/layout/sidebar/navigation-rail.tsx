import type { CSSProperties, MouseEvent } from "react";
import type { McpAppEntrypoint } from "@mains/contracts/mcp-apps";
import { useLocation, useNavigate } from "react-router-dom";
import { Button, CircleSpinner } from "@/components/ui";
import {
  Home,
  Plugin,
  Question,
  Relay,
  Search,
  Settings,
  Task,
} from "@/components/ui/icons";
import { Clock } from "@/components/ui/icons/space";
import { requestCommandMenu } from "@/features/command-menu/command-menu-bridge";
import { useResolvedAppTheme } from "@/hooks/use-app-theme";
import { useIsDarkMode } from "@/hooks/use-is-dark-mode";
import type { Space } from "@/lib/redux/api";
import { isSettingsRoute, isWorkspaceRoute } from "@/lib/layout";
import { useKeyboardShortcutBinding } from "@/providers/keyboard-shortcuts-provider";
import { keyboardShortcutLabel } from "../../../../shared/keyboard-shortcuts";
import SpaceSelector from "./space-selector";
import { useMcpAppExtensions } from "@/hooks/use-mcp-app-extensions";
import { useMcpAppPanel } from "@/hooks/use-mcp-app-panel";
import { mcpAppPath } from "@/lib/mcp-app-extensions";
import { McpAppIcon } from "./mcp-app-icon";

interface NavigationRailProps {
  showTasks: boolean;
  pluginsAvailable: boolean;
  spaces: Space[];
  activeSpaceId: string | null;
  onHomeClick: () => void;
  onSpaceChange: (spaceId: string) => void;
  onSettingsClick: () => void;
  onHelpClick: (event: MouseEvent) => void;
  helpMenuOpen: boolean;
}

export function NavigationRail({
  showTasks,
  pluginsAvailable,
  spaces,
  activeSpaceId,
  onHomeClick,
  onSpaceChange,
  onSettingsClick,
  onHelpClick,
  helpMenuOpen,
}: NavigationRailProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const appTheme = useResolvedAppTheme();
  const isDarkMode = useIsDarkMode();
  const translucent = appTheme[isDarkMode ? "dark" : "light"].translucent;
  const settingsShortcut = keyboardShortcutLabel(
    useKeyboardShortcutBinding("app.openSettings"),
  );
  const commandMenuShortcut = keyboardShortcutLabel(
    useKeyboardShortcutBinding("app.commandMenu"),
  );
  const homeActive = isWorkspaceRoute(pathname);
  const settingsActive = isSettingsRoute(pathname);
  const { entries: appExtensions } = useMcpAppExtensions();
  const appPanel = useMcpAppPanel();
  const destinations: Array<{
    label: string; path: string; Icon: typeof Plugin; disabled?: boolean; app?: McpAppEntrypoint;
  }> = [
    {
      label: "Plugins",
      path: "/plugins",
      Icon: Plugin,
      disabled: !pluginsAvailable,
    },
    ...(showTasks ? [{ label: "Tasks", path: "/tasks", Icon: Task }] : []),
    ...appExtensions.map((app) => ({ label: app.name, path: mcpAppPath(app), Icon: Plugin, app })),
    { label: "Pulse", path: "/pulse", Icon: Clock },
    { label: "Connect", path: "/relay", Icon: Relay },
  ];
  const buttonClass = (active: boolean) =>
    `flex size-8 shrink-0 items-center justify-center rounded-xl transition-colors ${
      active
        ? ` text-primary-950  ${translucent ? " dark:bg-primary/5 bg-primary/50 " :" dark:bg-primary-900 bg-primary-200/50 "}  dark:text-primary-50`
        : "text-primary-700 hover:bg-primary/50 dark:text-primary-300 dark:hover:bg-primary-800/40"
    }`;

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-(--z-panel) flex flex-col items-center mt-11 mb-1.25 mx-1.25 p-1.5 rounded-2xl ${translucent ? "bg-transparent" : "dark:bg-primary-950 bg-primary"}`}
      style={
        {
          width: "var(--nav-rail-width)",
          WebkitAppRegion: "no-drag",
        } as CSSProperties
      }
      aria-label="Primary navigation"
    >
      <nav className="flex min-h-0 flex-col items-center gap-2 overflow-y-auto" aria-label="Pages">
        <Button
          variant="bare"
          className={buttonClass(homeActive)}
          tooltip="Home"
          tooltipPosition="right"
          aria-label="Home"
          aria-current={homeActive ? "page" : undefined}
          onClick={onHomeClick}
        >
          <Home className="size-5" aria-hidden />
        </Button>
        <Button
          variant="bare"
          className={buttonClass(false)}
          tooltip="Search Mains"
          tooltipShortcut={commandMenuShortcut}
          tooltipPosition="right"
          aria-label="Search Mains"
          onClick={requestCommandMenu}
        >
          <Search className="size-5" aria-hidden />
        </Button>
        {destinations.map(({ label, path, Icon, disabled, app }) => {
          const active = app && appPanel ? appPanel.isOpen && appPanel.document?.app.id === app.id
            : pathname === path || pathname.startsWith(`${path}/`);
          const opening = !!app && appPanel?.opening === app.id;
          return (
            <Button
              key={path}
              variant="bare"
              className={buttonClass(active)}
              tooltip={disabled ? "Not available for this agent yet." : opening ? `Opening ${label}…` : label}
              tooltipPosition="right"
              aria-label={label}
              aria-current={active ? "page" : undefined}
              aria-busy={opening || undefined}
              disabled={disabled || opening}
              onClick={() => { if (app && appPanel) void appPanel.openGlobal(app); else navigate(path); }}
            >
              {opening ? <CircleSpinner className="size-5" /> : app ? <McpAppIcon icons={app.icons} isDarkMode={isDarkMode} tool={app.tool} monochrome /> : <Icon
                className={`size-5 ${label === "Plugins" ? "-rotate-45" : ""}`}
                aria-hidden
              />}
            </Button>
          );
        })}
      </nav>

      <div className="mt-auto flex min-h-0 flex-col items-center gap-1">
        {spaces.length > 0 && (
          <div className="mt-1 flex min-h-0 max-h-[35vh] flex-col items-center">
            <SpaceSelector
              spaces={spaces}
              activeSpaceId={activeSpaceId}
              onSpaceChange={onSpaceChange}
              orientation="vertical"
            />
            <div
              className="mt-2 w-8 shrink-0 border-b border-primary-300/50 dark:border-primary-800"
              aria-hidden="true"
            />
          </div>
        )}
        <Button
          variant="bare"
          className={buttonClass(false)}
          tooltip="Help & Resources"
          tooltipPosition="right"
          aria-label="Help & Resources"
          aria-haspopup="menu"
          aria-expanded={helpMenuOpen}
          onClick={onHelpClick}
        >
          <Question className="size-4.5" aria-hidden />
        </Button>
        <Button
          variant="bare"
          className={buttonClass(settingsActive)}
          tooltip="Settings"
          tooltipShortcut={settingsShortcut}
          tooltipPosition="right"
          aria-label="Settings"
          aria-current={settingsActive ? "page" : undefined}
          onClick={onSettingsClick}
        >
          <Settings className="size-4.5" aria-hidden />
        </Button>
      </div>
    </aside>
  );
}
