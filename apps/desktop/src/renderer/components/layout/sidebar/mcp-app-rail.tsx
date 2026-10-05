import { useEffect, useId, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { McpAppEntrypoint } from "@mains/contracts/mcp-apps";
import { Button, DropdownMenu, DropdownMenuItem } from "@/components/ui";
import { Ellipsis, Pin, PinFilled } from "@/components/ui/icons";
import { useIsDarkMode } from "@/hooks/use-is-dark-mode";
import { useMcpAppPanel } from "@/hooks/use-mcp-app-panel";
import { useSpaceProviderVariant } from "@/hooks/use-space-provider-variant";
import { MAX_PINNED_MCP_APPS, mcpAppPath, mcpAppPinKey, normalizeMcpAppPins } from "@/lib/mcp-app-extensions";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { reconcileMcpAppPins, setMcpAppPinned } from "@/lib/redux/slices/appSettingsSlice";
import { McpAppIcon } from "./mcp-app-icon";

const EMPTY_PINS: string[] = [];

/** Apps stay in the menu until the user explicitly pins them to the rail. */
export function McpAppRail({ entries, buttonClass }: {
  entries: McpAppEntrypoint[];
  buttonClass: (active: boolean) => string;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { providerId } = useSpaceProviderVariant();
  const isDarkMode = useIsDarkMode();
  const panel = useMcpAppPanel();
  const triggerId = useId();
  const storedKeys = useAppSelector((state) => state.appSettings.pinnedMcpAppKeysByProvider[providerId] ?? EMPTY_PINS);
  const pinnedKeys = normalizeMcpAppPins(storedKeys, entries);
  useEffect(() => {
    dispatch(reconcileMcpAppPins({ providerId, entries }));
  }, [dispatch, providerId, entries, storedKeys]);
  const pinnedApps = pinnedKeys.flatMap((key) => {
    // Multiple account links share one rail pin. Opening always uses a live entry.
    const candidates = entries.filter((entry) => mcpAppPinKey(entry) === key);
    const app = candidates.find((entry) => entry.id === panel?.document?.app.id) ?? candidates[0];
    return app ? [app] : [];
  }).slice(0, MAX_PINNED_MCP_APPS);
  const atLimit = pinnedApps.length >= MAX_PINNED_MCP_APPS;
  const [menu, setMenu] = useState<{
    providerId: string; locationKey: string; position: { x: number; y: number; anchorTop: number };
  } | null>(null);
  const isMenuOpen = menu?.providerId === providerId && menu.locationKey === location.key;
  const isAppActive = (app: McpAppEntrypoint) => location.pathname === mcpAppPath(app) ||
    !!panel?.isOpen && panel.document?.app.id === app.id;

  return <>
    <div className="w-8 shrink-0 border-b border-primary-300/50 dark:border-primary-800" aria-hidden="true" />
    {pinnedApps.map((app) => <Button key={app.id}
      variant="bare" className={buttonClass(isAppActive(app))}
      tooltip={app.name} tooltipPosition="right" aria-label={app.name}
      aria-current={isAppActive(app) ? "page" : undefined}
      aria-busy={panel?.opening === app.id || undefined}
      onClick={() => navigate(mcpAppPath(app))}>
      <McpAppIcon icons={app.icons} isDarkMode={isDarkMode} tool={app.tool} monochrome />
    </Button>)}
    <Button id={triggerId} variant="bare" className={buttonClass(isMenuOpen)}
      tooltip="App options" tooltipPosition="right" aria-label="App options"
      aria-haspopup="menu" aria-expanded={isMenuOpen}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setMenu(isMenuOpen ? null : { providerId, locationKey: location.key,
          position: { x: rect.right + 8, y: rect.top, anchorTop: rect.top } });
      }}>
      <Ellipsis className="size-5" aria-hidden />
    </Button>
    <DropdownMenu isOpen={isMenuOpen} aria-labelledby={triggerId}
      position={menu?.position ?? { x: 0, y: 0 }} onClose={() => setMenu(null)} minWidth={256}
      className={`max-w-[calc(100vw-1rem)] ${panel?.isOpen ? "z-(--z-modal-critical)" : ""}`}>
      <div className="flex items-center justify-between gap-4 px-2 py-1.5 text-xs text-primary-500">
        <span>Apps</span><span>{pinnedApps.length}/{MAX_PINNED_MCP_APPS} pinned</span>
      </div>
      <div className="max-h-[min(60vh,24rem)] overflow-y-auto overscroll-contain">
        {entries.map((app) => {
          const pinned = pinnedApps.some((entry) => mcpAppPinKey(entry) === mcpAppPinKey(app));
          const PinIcon = pinned ? PinFilled : Pin;
          const pinLabel = `${pinned ? "Unpin" : "Pin"} ${app.name}`;
          return <div key={app.id} role="none" className="flex items-center gap-0.5">
            <DropdownMenuItem className="min-w-0 flex-1" onClick={() => {
              setMenu(null);
              navigate(mcpAppPath(app));
            }}>
              <McpAppIcon icons={app.icons} isDarkMode={isDarkMode} tool={app.tool} monochrome className="size-4" />
              <span className="min-w-0 flex-1 truncate text-left">{app.name}</span>
            </DropdownMenuItem>
            <Button variant="bare" role="menuitemcheckbox" tabIndex={-1}
              aria-label={pinLabel} aria-checked={pinned} disabled={!pinned && atLimit}
              tooltip={!pinned && atLimit ? `You can pin up to ${MAX_PINNED_MCP_APPS} apps` : pinLabel}
              tooltipPosition="right" className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-lg text-primary-500 hover:bg-primary-200/40 hover:text-primary-900 dark:hover:bg-primary/5 dark:hover:text-primary-100"
              onClick={() => dispatch(setMcpAppPinned({ providerId, pinKey: mcpAppPinKey(app), pinned: !pinned,
                availablePinKeys: [...new Set(entries.map(mcpAppPinKey))] }))}>
              <PinIcon className="size-3.5" aria-hidden />
            </Button>
          </div>;
        })}
      </div>
      {atLimit && <p className="px-2 py-1.5 text-xs text-primary-500">Unpin an app to pin another.</p>}
    </DropdownMenu>
  </>;
}
