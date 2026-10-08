import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useMatch, useNavigate, useSearchParams } from "react-router-dom";
import { Button, DropdownMenu, DropdownMenuItem } from "@/components/ui";
import { Branch, Close, LibrarySquare, Plugin, ProjectFolder } from "@/components/ui/icons";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useSpaceProviderVariant } from "@/hooks/use-space-provider-variant";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { useGetAccountQuery, useGetProviderPluginsQuery, useGetProviderRateLimitsQuery,
  useGetWorkspaceQuery, useListWorkspaceGitStatesQuery } from "@/lib/redux/api";
import { providersApi } from "@/lib/redux/api/providersApi";
import { useAtlasPageQuery } from "@/lib/redux/api/atlasApi";
import { setStatusBarVisible } from "@/lib/redux/slices/appSettingsSlice";
import { isAtlasRoute, isWorkspaceRoute } from "@/lib/layout";
import { getProviderVariantById, type ProviderVariantDescriptor } from "@/lib/provider-variants";
import { appEvents } from "@/lib/transport";
import { selectSessionRunId } from "@/features/workspace/components/session-panel/select-session-run";
import { useContextUsage, type ContextUsageSnapshot } from "@/features/workspace/hooks/use-context-usage";
import { mergeCodexRateLimitUpdate } from "@/features/settings/lib/codex-usage";
import { ATLAS_TYPES, atlasView } from "@/features/atlas/lib/atlas-navigation";
import type { RateLimitInfo } from "../../../../shared/adapter.types";
import { PROVIDER_IDS } from "@mains/contracts/provider-ids";
import { statusBarLimits } from "./status-bar-limits";

const ITEM_CLASS = "flex h-6 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-xs hover:bg-primary-950/5 dark:hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-accent/40";
const DETAIL_CLASS = "px-3 py-2 text-xs text-primary-600 dark:text-primary-300";

/** The existing menu primitive supplies portal placement, dismissal, and keyboard focus. */
function StatusItem({ title, label, ariaLabel, children, className = "" }: {
  title: string; label: ReactNode; ariaLabel?: string; children: ReactNode; className?: string;
}) {
  const [position, setPosition] = useState<{ x: number; y: number; anchorTop: number } | null>(null);
  return <>
    <Button variant="bare" className={`${ITEM_CLASS} ${className}`} aria-label={ariaLabel} aria-haspopup="menu" aria-expanded={!!position}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setPosition(position ? null : { x: rect.left, y: rect.bottom, anchorTop: rect.top });
      }}>
      {label}
    </Button>
    <DropdownMenu isOpen={!!position} position={position ?? { x: 0, y: 0 }} onClose={() => setPosition(null)}
      openUpward minWidth={240} aria-label={`${title} details`}>
      <div onClick={(event) => {
        if ((event.target as HTMLElement).closest('[role="menuitem"]')) setPosition(null);
      }}>{children}</div>
    </DropdownMenu>
  </>;
}

function WorkspaceStatus({ id, loading }: { id: string | null; loading: boolean }) {
  const navigate = useNavigate();
  const { currentData: workspace } = useGetWorkspaceQuery(id ?? "", { skip: !id });
  const { data: states = [] } = useListWorkspaceGitStatesQuery(undefined, { skip: !id });
  const git = states.find((state) => state.workspaceId === id);
  return <StatusItem title="Workspace" className="max-w-full" label={<>
    <ProjectFolder aria-hidden="true" className="size-3.5 shrink-0" />
    <span className="truncate">{workspace?.name ?? (loading || id ? "Workspace…" : "No workspace")}</span>
    {git?.branch && <span className="hidden min-w-0 items-center gap-1.5 @min-[32rem]/statusbar:inline-flex">
      <Branch aria-hidden="true" className="size-3 shrink-0" /><span className="truncate">{git.branch}</span>
    </span>}
  </>}>
    <div className={`${DETAIL_CLASS} max-w-80 space-y-1 break-words`}>
      <p className="font-medium">{workspace?.name ?? "Workspace"}</p>
      <p>{workspace?.rootPath ?? "Select a workspace to see its working directory."}</p>
      {git?.branch && <p>Branch · {git.branch}</p>}
      {git?.pathExists === false && <p className="text-warning">Workspace folder is missing.</p>}
    </div>
    {workspace?.projectId && <DropdownMenuItem onClick={() => navigate(`/settings?section=projects&kind=code&id=${encodeURIComponent(workspace.projectId!)}`)}>
      Project settings
    </DropdownMenuItem>}
  </StatusItem>;
}

function ContextStatus({ usage }: { usage: ContextUsageSnapshot | null }) {
  const available = !!usage && Number.isFinite(usage.percentage) && Number.isFinite(usage.totalTokens)
    && Number.isFinite(usage.maxTokens) && usage.maxTokens > 0;
  const percentage = available ? Math.max(0, Math.min(100, usage.percentage)) : null;
  return <StatusItem title="Context" className="shrink-0" label={<span className={percentage !== null && percentage >= 90 ? "text-warning" : undefined}>
    Context <span className="tabular-nums">{percentage === null ? "—" : `${Math.round(percentage)}%`}</span>
  </span>}>
    <div className={`${DETAIL_CLASS} max-w-80 space-y-1`}>
      <p className="font-medium">Context window</p>
      {available ? <>
        <p>{Math.round(percentage!)}% used · {Math.round(usage.totalTokens).toLocaleString()} / {usage.maxTokens.toLocaleString()} tokens</p>
        {usage.model && <p>{usage.model}</p>}
        <p>Updated {new Date(usage.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
      </> : <p>Context appears when the provider reports usage for this conversation.</p>}
    </div>
  </StatusItem>;
}

function ProviderLimits({ provider }: { provider: ProviderVariantDescriptor }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [lastPushAt, setLastPushAt] = useState(0);
  const { currentData: limits, isFetching, isError, fulfilledTimeStamp, refetch } = useGetProviderRateLimitsQuery(provider.providerId, {
    pollingInterval: 60000, skipPollingIfUnfocused: true,
  });
  useEffect(() => appEvents.providers.onRateLimitsUpdated(({ providerId, rateLimits }) => {
    if (providerId !== provider.providerId || !rateLimits) return;
    setLastPushAt(Date.now());
    dispatch(providersApi.util.updateQueryData("getProviderRateLimits", providerId, (current) =>
      providerId === PROVIDER_IDS.codex
        ? mergeCodexRateLimitUpdate(current, rateLimits as RateLimitInfo)
        : { ...current, ...rateLimits }));
  }), [dispatch, provider.providerId]);
  const rows = statusBarLimits(limits);
  const Icon = provider.icon;
  const visible = rows.slice(0, 2);
  const updatedAt = Math.max(fulfilledTimeStamp ?? 0, lastPushAt);
  return <StatusItem title="Remaining limits" className="max-w-[48%] shrink"
    ariaLabel={`${provider.label.trim()} remaining limits: ${rows.length
      ? visible.map((row) => `${row.label} ${Math.round(row.remainingPercent)}% left`).join(", ")
      : isFetching ? "loading" : "unavailable"}`} label={<>
    <Icon aria-hidden="true" className="size-3.5 shrink-0" />
    <span className="truncate tabular-nums">
      {rows.length ? visible.map((row, index) => <span key={row.key}
        className={index > 0 ? "hidden @min-[36rem]/statusbar:inline" : undefined}>
        {index > 0 ? " · " : ""}{row.label} {Math.round(row.remainingPercent)}% left
      </span>)
        : `Limits ${isFetching ? "…" : "—"}`}
    </span>
  </>}>
    <div className={`${DETAIL_CLASS} max-w-80 space-y-2`}>
      <p className="font-medium">{provider.label} · Remaining limits</p>
      {isError && <p className="text-warning">Could not refresh limits.{rows.length > 0 ? " Showing the last reported values." : ""}</p>}
      {rows.length ? rows.map((row) => <div key={row.key}>
        {rows.length > 2 && <p className="text-primary-500">{row.group}</p>}
        <p className={row.remainingPercent <= 20 ? "text-warning" : undefined}>{row.label} · {Math.round(row.remainingPercent)}% left</p>
        {row.resetsAt !== undefined && <p>Resets {new Date(row.resetsAt * 1000).toLocaleString([], {
          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
        })}</p>}
      </div>) : <p>{isFetching ? "Loading provider limits…" : "This provider has not reported account limits."}</p>}
      {updatedAt > 0 && <p>Updated {new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>}
    </div>
    <DropdownMenuItem onClick={() => void refetch()}>Refresh limits</DropdownMenuItem>
    <DropdownMenuItem onClick={() => navigate(`/settings?section=${provider.variant}`)}>Provider settings</DropdownMenuItem>
  </StatusItem>;
}

function PluginsStatus({ provider }: { provider: ProviderVariantDescriptor }) {
  const { currentData: inventory } = useGetProviderPluginsQuery(provider.providerId, { skip: !provider.supportsPlugins });
  const plugins = [...new Map((inventory?.marketplaces.flatMap((market) => market.plugins) ?? [])
    .filter((plugin) => plugin.installed).map((plugin) => [plugin.id, plugin])).values()];
  const enabled = plugins.filter((plugin) => plugin.enabled).length;
  return <StatusItem title="Plugins" label={<><Plugin aria-hidden="true" className="size-3.5 shrink-0" /><span className="truncate">Plugins{inventory ? ` · ${enabled} enabled` : ""}</span></>}>
    <div className={`${DETAIL_CLASS} space-y-1`}>
      <p className="font-medium">{provider.label} plugins</p>
      <p>{!provider.supportsPlugins ? "Plugins are not available for this provider."
        : inventory ? `${plugins.length} installed · ${enabled} enabled` : "Plugin inventory is not available yet."}</p>
      {plugins.some((plugin) => plugin.updateAvailable) && <p>{plugins.filter((plugin) => plugin.updateAvailable).length} updates available</p>}
      {inventory?.remoteSyncError && <p className="text-warning">Plugin catalog could not refresh.</p>}
    </div>
  </StatusItem>;
}

function AtlasStatus({ supported }: { supported: boolean }) {
  const location = useLocation();
  const [params] = useSearchParams();
  const pageMatch = useMatch("/atlas/:itemId");
  const { data: account } = useGetAccountQuery();
  const { currentData: page } = useAtlasPageQuery({ accountId: account?.id ?? "", id: pageMatch?.params.itemId ?? "" }, {
    skip: !supported || !account || !pageMatch,
  });
  const view = atlasView(params);
  const label = !supported ? "Unavailable" : location.pathname.startsWith("/atlas/images/") ? "Image creator"
    : ATLAS_TYPES.find((type) => type.value === view.type)?.label ?? "All";
  return <StatusItem title="Atlas" label={<><LibrarySquare aria-hidden="true" className="size-3.5 shrink-0" /><span className="truncate">Atlas · {page?.item.title ?? label}</span></>}>
    <div className={`${DETAIL_CLASS} max-w-80 space-y-1 break-words`}>
      <p className="font-medium">{page?.item.title ?? "Atlas"}</p>
      {page ? <p>Saved version {page.item.version}</p> : <p>{label} · {view.scope === "all" ? "All sources" : view.scope}</p>}
      <p>Account library for pages, documents, and images.</p>
    </div>
  </StatusItem>;
}

/** A sibling of the route surface: never painted inside the chat or composer. */
export function AppStatusBar() {
  const location = useLocation();
  const [params] = useSearchParams();
  const dispatch = useAppDispatch();
  const { activeSpace } = useActiveSpace();
  const spaceProvider = useSpaceProviderVariant();
  const visible = useAppSelector((state) => state.appSettings.statusBarVisible);
  const workspaceId = useAppSelector((state) => state.workspace.activeWorkspaceId);
  const ready = useAppSelector((state) => state.workspace.composerContextReady);
  const sessionRunId = useAppSelector((state) => selectSessionRunId(state.workspace));
  const backend = useAppSelector((state) => state.backends.saved.find((entry) => entry.id === state.backends.activeBackendId));
  const workspaceRoute = isWorkspaceRoute(location.pathname);
  const pluginsRoute = location.pathname === "/plugins";
  const provider = (pluginsRoute && getProviderVariantById(params.get("provider") ?? "")) ||
    (spaceProvider.supportsAtlas && location.pathname.startsWith("/atlas/images/") && getProviderVariantById(PROVIDER_IDS.codex)) || spaceProvider;
  // Retain the live subscription while hidden, so re-showing the bar doesn't
  // lose a snapshot. Other routes never inherit the previous chat's context.
  const usage = useContextUsage(workspaceRoute && ready ? sessionRunId : null);
  if (!visible) return null;
  const routeName = location.pathname.split("/")[1] || "Home";
  return <footer aria-label="Application status" data-app-status-bar=""
    className="@container/statusbar flex h-7 shrink-0 items-center gap-1 bg-transparent px-1 text-primary-500 dark:text-primary-400">
    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
      {workspaceRoute ? activeSpace?.mode === "developer" ? <WorkspaceStatus id={ready ? workspaceId : null} loading={!ready} />
        : <span className="truncate px-1.5 text-xs">{activeSpace?.name ?? "Workspace"}</span>
        : pluginsRoute ? <PluginsStatus provider={provider} />
        : isAtlasRoute(location.pathname) ? <AtlasStatus supported={spaceProvider.supportsAtlas} />
        : <span className="truncate px-1.5 text-xs capitalize">{routeName}</span>}
      {backend && <span className="truncate text-xs">· {backend.label}</span>}
    </div>
    {workspaceRoute && <ContextStatus usage={usage} />}
    {activeSpace && <ProviderLimits key={provider.providerId} provider={provider} />}
    <Button variant="icon" iconSize="xs" aria-label="Hide status bar" tooltip="Hide status bar" tooltipPosition="top-left"
      onClick={() => dispatch(setStatusBarVisible(false))}>
      <Close aria-hidden="true" />
    </Button>
  </footer>;
}
