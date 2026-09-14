import { useState, useMemo } from "react";
import {
  AsciiSpinner,
  Body,
  Button,
  SegmentedTabs,
  Text,
  toast,
} from "@/components/ui";
import { SettingsPageShell } from "../settings-layout";
import AsanaModal from "./asana/asana-modal";
import GitHubModal from "./github/github-modal";
import GitLabModal from "./gitlab/gitlab-modal";
import JiraModal from "./jira/jira-modal";
import LinearModal from "./linear/linear-modal";
import TrelloModal from "./trello/trello-modal";
import SentryModal from "./sentry/sentry-modal";
import SocketDevModal from "./socketdev/socketdev-modal";
import { useRunEntitySyncMutation } from "@/lib/redux/api/syncApi";
import { useGetConnectionStatesQuery } from "@/lib/redux/api";
import type { ConnectionState } from "@/lib/redux/api";

type ConnectionItem = ConnectionState;

type CategoryFilter = "all" | "issues" | "monitoring" | "security";

const FILTER_TABS: { id: CategoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "issues", label: "Issues" },
  { id: "monitoring", label: "Monitoring" },
  { id: "security", label: "Security" },
];

type ConnectionModalProps = {
  open: boolean;
  onClose: () => void;
  isConnected: boolean;
  onSuccess: () => void;
};

const CONNECTION_MODALS: Array<{
  id: string;
  Component: React.ComponentType<ConnectionModalProps>;
}> = [
  { id: "github", Component: GitHubModal },
  { id: "gitlab", Component: GitLabModal },
  { id: "jira", Component: JiraModal },
  { id: "asana", Component: AsanaModal },
  { id: "linear", Component: LinearModal },
  { id: "trello", Component: TrelloModal },
  { id: "sentry", Component: SentryModal },
  { id: "socketdev", Component: SocketDevModal },
];

export default function ConnectionsSettings() {
  const { data: connections = [], refetch } = useGetConnectionStatesQuery();
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [runSync, { isLoading: isSyncing }] = useRunEntitySyncMutation();

  const connectedConnections = useMemo(
    () =>
      connections
        .filter((connection) => connection.isConnected)
        .map((connection) => connection.id),
    [connections],
  );

  const handleSync = () => {
    const syncPromise = runSync().unwrap().then((result) => {
      if (!result.success) throw new Error("Sync failed");
      return result;
    });
    toast.promise(syncPromise, {
      loading: "Syncing...",
      success: (data) => `Synced ${data.total} items`,
      error: "Sync failed",
    });
  };

  const isConnected = (appId: string) => connectedConnections.includes(appId);

  const handleConnectionSuccess = () => {
    refetch();
  };

  const filteredConnections = useMemo(() => {
    if (filter === "all") return connections;
    return connections.filter((connection) => (connection.category || "development") === filter);
  }, [connections, filter]);

  const connectedFiltered = filteredConnections.filter((connection) => isConnected(connection.id));
  const notConnectedFiltered = filteredConnections.filter(
    (connection) => !isConnected(connection.id),
  );
  const connectedCount = connections.filter((connection) => isConnected(connection.id)).length;

  const headerActions =
    connectedCount > 0 ? (
      <Button
        variant="secondary"
        onClick={handleSync}
        disabled={isSyncing}
        className="gap-1 flex items-center"
      >
        {isSyncing ? <AsciiSpinner variant="null" /> : null}
        <Text size="s"  variant="button">{isSyncing ? "Syncing..." : "Sync All"}</Text>
      </Button>
    ) : null;

  return (
    <SettingsPageShell title="Connections" headerActions={headerActions}>
      {/* Category filter tabs */}
      <SegmentedTabs
        value={filter}
        onChange={setFilter}
        options={FILTER_TABS.map((t) => ({ value: t.id, label: t.label }))}
        variant="plain"
        semantics="radiogroup"
        aria-label="Connection category"
        className="mb-6"
      />

      {/* Connected */}
      {connectedFiltered.length > 0 && (
        <div className="mb-6">
          <Body weight="medium" className="mb-3">
            Connected
          </Body>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {connectedFiltered.map((connection) => (
              <ConnectionCard
                key={connection.id}
                connection={connection}
                connected
                onAction={() => setActiveModal(connection.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Available */}
      {notConnectedFiltered.length > 0 && (
        <div className="mb-6">
          <Body weight="medium" className="mb-3">
            Available
          </Body>
          <div className="grid grid-cols-1 gap-6 pb-12 md:grid-cols-2">
            {notConnectedFiltered.map((connection) => (
              <ConnectionCard
                key={connection.id}
                connection={connection}
                connected={false}
                onAction={() => setActiveModal(connection.id)}
              />
            ))}
          </div>
        </div>
      )}

      <ConnectionModalHost
        activeModal={activeModal}
        isConnected={isConnected}
        onClose={() => setActiveModal(null)}
        onSuccess={handleConnectionSuccess}
      />
    </SettingsPageShell>
  );
}

function ConnectionModalHost({
  activeModal,
  isConnected,
  onClose,
  onSuccess,
}: {
  activeModal: string | null;
  isConnected: (appId: string) => boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  return (
    <>
      {CONNECTION_MODALS.map(({ id, Component }) => (
        <Component
          key={id}
          open={activeModal === id}
          onClose={onClose}
          isConnected={isConnected(id)}
          onSuccess={onSuccess}
        />
      ))}
    </>
  );
}

function ConnectionCard({
  connection,
  connected,
  onAction,
}: {
  connection: ConnectionItem;
  connected: boolean;
  onAction: () => void;
}) {
  return (
    <div className="rounded-3xl glass-surface  p-4 flex flex-col justify-between">
      <div className="flex items-start justify-between mb-10">
        <div className="flex items-center gap-2 min-w-0">
          <ConnectionIcon connection={connection} />
          <Text as="span" weight="medium" className="truncate">
            {connection.displayName}
          </Text>
        </div>

      </div>
      <div className="flex items-end justify-between">
        {connection.config ? (
          <Text as="span" size="xs" tone="subtle" className="px-1 leading-tight">
            {(() => { try { const c = JSON.parse(connection.config); return c.description ?? ""; } catch { return ""; } })()}
          </Text>
        ) : <span />}
        <Button
          variant={connected ? "primary" : "secondary"}
          onClick={onAction}
          className="rounded-xl shrink-0"
        >
          {connected ? "Manage" : "Connect"}
        </Button>
      </div>
    </div>
  );
}

function ConnectionIcon({ connection }: { connection: ConnectionItem }) {
  if (connection.iconPath) {
    return (
      <img
        src={connection.iconPath}
        alt={connection.id}
        width={32}
        height={32}
        className="size-8 rounded-lg object-cover"
      />
    );
  }

  return (
    <div className="size-8 flex items-center justify-center bg-primary-200 dark:bg-primary-700 rounded-lg">
      <Text
        variant="h3"
        className="text-primary-800 dark:text-primary-200 text-sm"
      >
        {connection.displayName?.charAt(0)}
      </Text>
    </div>
  );
}
