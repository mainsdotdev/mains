import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Text, toast } from "@/components/ui";
import { Inbox, Plus, Refresh, Settings } from "@/components/ui/icons";
import {
  SIDEBAR_ACTION_ICON,
  SidebarGroupSection,
} from "@/components/layout/sidebar/sidebar-group-section";
import { ConnectionModalHost } from "@/features/settings/components/connections/connection-modals";
import { ProviderIcon } from "@/features/workspace/components/provider-icon";
import {
  useGetConnectionStatesQuery,
  useGetIssuesInboxQuery,
  useGetSelectedResourcesQuery,
  useRunEntitySyncMutation,
  type ConnectionState,
} from "@/lib/redux/api";
import { useTasksScope } from "../hooks/use-tasks-scope";
import {
  ALL_SCOPE,
  issueScopeCounts,
  resourceLabel,
  supportsPullRequests,
  type IssueScopeCounts,
  type TasksScope,
  type TasksTab,
} from "../lib/scope";

/**
 * The Issues tab's list (open issues only), shared so the sidebar's counts
 * ride the cached rows instead of fetching their own. Counts are therefore
 * capped at this limit; past it they read "N+".
 */
export const OPEN_ISSUES_QUERY = { category: "open", limit: 200 } as const;

const EMPTY_CONNECTIONS: ConnectionState[] = [];

const itemClass = (active: boolean) =>
  `flex py-1.5 w-full items-center gap-2 text-s text-primary-950 dark:text-primary rounded-[10px] px-2 text-left cursor-pointer transition-colors ${
    active
      ? "bg-primary/50 glass-outline-soft glass-outline dark:bg-primary/5"
      : "hover:bg-primary/50 dark:hover:bg-primary/5"
  }`;

const PROVIDER_ICON_CLASS = "size-3.5 shrink-0 text-primary-900 dark:text-primary-100";

export function TasksSidebar() {
  const { tab, scope, setScope } = useTasksScope();
  const {
    data: connectionStates = EMPTY_CONNECTIONS,
    isSuccess: connectionsLoaded,
    refetch,
  } = useGetConnectionStatesQuery();
  const { currentData: issues = [] } = useGetIssuesInboxQuery(OPEN_ISSUES_QUERY);
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [runSync, { isLoading: syncing }] = useRunEntitySyncMutation();

  // The only manual sync now that Settings › Connections is hidden. Each
  // incremental fetcher asks only for what changed since its last run.
  const sync = () => {
    const syncPromise = runSync()
      .unwrap()
      .then((result) => {
        if (!result.success) throw new Error("Sync failed");
        return result;
      });
    toast.promise(syncPromise, {
      loading: "Syncing...",
      success: (data) => `Synced ${data.total} items`,
      error: "Sync failed",
    });
  };

  // The PR tab only lists GitHub and GitLab; GitLab keeps its support placeholder.
  const visibleConnections = useMemo(
    () =>
      connectionStates
        .filter(
          (connection) =>
            connection.category === "issues" &&
            (tab === "issues" || connection.id === "github" || connection.id === "gitlab"),
        )
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [connectionStates, tab],
  );
  const connected = visibleConnections.filter((connection) => connection.isConnected);
  const available = visibleConnections.filter((connection) => !connection.isConnected);

  const counts = useMemo(() => issueScopeCounts(issues), [issues]);
  const countsCapped = issues.length >= OPEN_ISSUES_QUERY.limit;

  const isConnected = useCallback(
    (id: string) => connectionStates.some((c) => c.id === id && c.isConnected),
    [connectionStates],
  );

  // A revoked connection takes its issues with it — a scope still pointing at
  // it would show an empty list with nothing in the sidebar to leave it by.
  useEffect(() => {
    if (!connectionsLoaded || !scope.provider) return;
    if (!connected.some((connection) => connection.id === scope.provider)) {
      setScope(ALL_SCOPE, { replace: true });
    }
  }, [connectionsLoaded, connected, scope.provider, setScope]);

  const showAvailable = adding || connected.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 pt-12 px-5 md:pt-2">
        <Text size="base" weight="medium" align="left">
          Tasks
        </Text>
        {connected.length > 0 && (
          <Button
            variant="icon"
            onClick={sync}
            disabled={syncing}
            aria-label="Sync issues"
            tooltip="Sync issues"
            tooltipPosition="bottom"
            // Pulls the button out by its own padding (p-1.5) so the glyph,
            // not the hover box, lines up with the counts below.
            className="-mr-1.5"
          >
            <Refresh className={`size-3.5 ${syncing ? "animate-spin" : ""}`} />
          </Button>
        )}
      </div>

      <nav className="shrink-0 space-y-0.5 px-3 py-3" aria-label="Task scope">
        <ScopeRow
          icon={<Inbox className="size-3.5 shrink-0" />}
          label={tab === "issues" ? "All issues" : "All pull requests"}
          count={tab === "issues" ? counts.total : null}
          capped={countsCapped}
          active={!scope.provider}
          onClick={() => setScope(ALL_SCOPE)}
        />
      </nav>

      <div className="scroll-bounce min-h-0 flex-1 overflow-y-auto noscrollbar px-3">
        {connected.map((connection) => (
          <ConnectionGroup
            key={connection.id}
            connection={connection}
            tab={tab}
            scope={scope}
            counts={counts}
            countsCapped={countsCapped}
            onSelect={setScope}
            onManage={() => setActiveModal(connection.id)}
          />
        ))}
        {connectionsLoaded && connected.length === 0 && (
          <Text size="xs" tone="subtle" className="block px-2.5 py-2">
            Connect a service to see its issues and pull requests here.
          </Text>
        )}
      </div>

      {available.length > 0 && (
        <div className="shrink-0 px-3 pb-3 pt-2">
          {/* Rises out of "Add connection": the panel grows from 0fr (upward,
              since it sits at the bottom) and the rows slide up into place,
              the one nearest the button first. Kept mounted so closing
              animates too; inert + aria-hidden while closed. */}
          <div
            inert={!showAvailable}
            aria-hidden={!showAvailable}
            className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
              showAvailable ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
            }`}
          >
            <nav aria-label="Available connections" className="min-h-0 overflow-hidden">
              {available.map((connection, index) => (
                <div
                  key={connection.id}
                  className={`pb-0.5 transition-[translate,opacity] duration-300 ease-out motion-reduce:transition-none ${
                    showAvailable ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
                  }`}
                  style={{
                    transitionDelay: showAvailable ? `${(available.length - 1 - index) * 40}ms` : "0ms",
                  }}
                >
                  <Button className={itemClass(false)} onClick={() => setActiveModal(connection.id)}>
                    <ProviderIcon provider={connection.id} className={PROVIDER_ICON_CLASS} />
                    <span className="truncate">{connection.displayName}</span>
                    <Text as="span" size="xs" tone="subtle" className="ml-auto">
                      Connect
                    </Text>
                  </Button>
                </div>
              ))}
            </nav>
          </div>
          {connected.length > 0 && (
            <Button
              className={itemClass(false)}
              aria-expanded={showAvailable}
              onClick={() => setAdding((open) => !open)}
            >
              <Plus className="size-3.5 shrink-0" />
              <span>Add connection</span>
            </Button>
          )}
        </div>
      )}

      <ConnectionModalHost
        activeModal={activeModal}
        isConnected={isConnected}
        onClose={() => setActiveModal(null)}
        onSuccess={() => void refetch()}
      />
    </div>
  );
}

function ConnectionGroup({
  connection,
  tab,
  scope,
  counts,
  countsCapped,
  onSelect,
  onManage,
}: {
  connection: ConnectionState;
  tab: TasksTab;
  scope: TasksScope;
  counts: IssueScopeCounts;
  countsCapped: boolean;
  onSelect: (scope: TasksScope, options?: { replace?: boolean }) => void;
  onManage: () => void;
}) {
  const provider = connection.id;
  const { data, isSuccess } = useGetSelectedResourcesQuery(provider);
  const resources = useMemo(
    () => (data?.items ?? []) as Array<Record<string, unknown> & { id: string }>,
    [data],
  );
  const showCounts = tab === "issues";
  const unsupported = tab === "pull_requests" && !supportsPullRequests(provider);

  // A resource unlinked from the connection no longer has issues to filter to.
  useEffect(() => {
    if (!isSuccess || scope.provider !== provider || !scope.resourceId) return;
    if (!resources.some((resource) => resource.id === scope.resourceId)) {
      onSelect({ provider, resourceId: null }, { replace: true });
    }
  }, [isSuccess, resources, scope, provider, onSelect]);

  return (
    <SidebarGroupSection
      groupKey={`tasks:${provider}`}
      label={connection.displayName}
      icon={<ProviderIcon provider={provider} className={PROVIDER_ICON_CLASS} />}
      count={resources.length}
      action={{
        label: `Manage ${connection.displayName}`,
        icon: <Settings className={SIDEBAR_ACTION_ICON} />,
        onClick: onManage,
      }}
    >
      <nav aria-label={`${connection.displayName} scope`} className="space-y-0.5 pb-1 [&>button]:pl-7">
        {unsupported ? (
          <Text size="xs" tone="subtle" className="block pl-7 pr-2 py-1.5">
            No pull request support yet
          </Text>
        ) : (
          <>
            <ScopeRow
              label="All"
              count={showCounts ? (counts.byProvider.get(provider) ?? 0) : null}
              capped={countsCapped}
              active={scope.provider === provider && !scope.resourceId}
              onClick={() => onSelect({ provider, resourceId: null })}
            />
            {resources.map((resource) => (
              <ScopeRow
                key={resource.id}
                label={resourceLabel(resource)}
                count={showCounts ? (counts.byResource.get(resource.id) ?? 0) : null}
                capped={countsCapped}
                active={scope.provider === provider && scope.resourceId === resource.id}
                onClick={() => onSelect({ provider, resourceId: resource.id })}
              />
            ))}
          </>
        )}
      </nav>
    </SidebarGroupSection>
  );
}

function ScopeRow({
  label,
  count,
  capped,
  active,
  icon,
  onClick,
}: {
  label: string;
  count: number | null;
  capped: boolean;
  active: boolean;
  icon?: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      className={itemClass(active)}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      {icon}
      <span className="truncate">{label}</span>
      {count !== null && (
        <Text as="span" size="xs" tone="subtle" className="ml-auto tabular-nums">
          {count}
          {capped ? "+" : ""}
        </Text>
      )}
    </Button>
  );
}
