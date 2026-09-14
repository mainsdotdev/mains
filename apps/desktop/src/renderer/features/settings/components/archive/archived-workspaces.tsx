import { useMemo, useState } from "react";
import {
  Alert,
  Body,
  Button,
  Caption,
  Checkbox,
  getSegmentedTabId,
  Input,
  Muted,
  SegmentedTabs,
  toast,
  Text,
} from "@/components/ui";
import {
  Archive,
  Close,
  Danger,
  Search,
  Trash,
  WorkspaceStatusIcon,
} from "@/components/ui/icons";
import { extractErrorMessage } from "@/lib/extract-error-message";
import { formatAbsoluteDate } from "@/lib/format-date";
import { ProjectIcon } from "@/components/layout/sidebar/project-icon";
import { getProviderVariantById } from "@/lib/provider-variants";
import { getWorkspaceStatusConfig } from "@/lib/workspace-status";
import {
  useDeleteRunMutation,
  useDeleteWorkspaceMutation,
  useListArchivedRunsQuery,
  useListArchivedWorkspacesQuery,
  useUnarchiveRunMutation,
  useUnarchiveWorkspaceMutation,
  type ArchivedRun,
  type ArchivedWorkspace,
} from "@/lib/redux/api";
import { SettingsPageShell, SettingsSection } from "../settings-layout";

type ArchiveTab = "workspaces" | "runs";


/** Settings › Archive — recovery and permanent deletion for workspaces and runs. */
export default function ArchiveSettings() {
  const [activeTab, setActiveTab] = useState<ArchiveTab>("workspaces");
  const workspacesQuery = useListArchivedWorkspacesQuery();
  const runsQuery = useListArchivedRunsQuery();

  const isLoading =
    activeTab === "workspaces"
      ? workspacesQuery.isLoading
      : runsQuery.isLoading;
  const error =
    activeTab === "workspaces" ? workspacesQuery.error : runsQuery.error;

  return (
    <SettingsPageShell
      title="Archive"
      headerActions={
        <SegmentedTabs
          id="archive-tabs"
          value={activeTab}
          onChange={setActiveTab}
          options={[
            {
              value: "workspaces",
              label: `Workspaces`,
            },
            {
              value: "runs",
              label: `Runs`,
            },
          ]}
          panelId="archive-panel"
          aria-label="Archive type"
          className="min-w-40"
        />
      }
    >
      <div
        id="archive-panel"
        role="tabpanel"
        aria-labelledby={getSegmentedTabId("archive-tabs", activeTab)}
      >
        {isLoading ? (
          <Muted>Loading...</Muted>
        ) : error ? (
          <Muted>{`Unable to load archived ${activeTab}.`}</Muted>
        ) : activeTab === "workspaces" ? (
          <ArchivedWorkspacesPanel workspaces={workspacesQuery.data ?? []} />
        ) : (
          <ArchivedRunsPanel runs={runsQuery.data ?? []} />
        )}
      </div>
    </SettingsPageShell>
  );
}

function ArchivedWorkspacesPanel({
  workspaces,
}: {
  workspaces: ArchivedWorkspace[];
}) {
  const [unarchiveWorkspace] = useUnarchiveWorkspaceMutation();
  const [deleteWorkspace, { isLoading: isDeleting }] =
    useDeleteWorkspaceMutation();
  const [pendingDelete, setPendingDelete] = useState<ArchivedWorkspace | null>(
    null,
  );
  const [removeWorktree, setRemoveWorktree] = useState(false);
  const [search, setSearch] = useState("");

  // Everything the row prints, plus the paths behind it — a workspace is as
  // often remembered by its folder or branch as by its name.
  const matches = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return workspaces;
    return workspaces.filter((workspace) =>
      [
        workspace.name,
        workspace.projectName,
        workspace.worktree?.name,
        workspace.baseBranch,
        workspace.rootPath,
        getWorkspaceStatusConfig(workspace.status).label,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedSearch)),
    );
  }, [workspaces, search]);

  const handleUnarchive = async (workspace: ArchivedWorkspace) => {
    try {
      await unarchiveWorkspace(workspace.id).unwrap();
      toast.success(`${workspace.name} restored`);
    } catch (err: any) {
      toast.error(extractErrorMessage(err, "Failed to unarchive workspace"));
    }
  };

  const openDelete = (workspace: ArchivedWorkspace) => {
    setPendingDelete(workspace);
    setRemoveWorktree(false);
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    const { id, name, worktree } = pendingDelete;
    try {
      await deleteWorkspace({
        id,
        removeWorktree: removeWorktree && !!worktree,
      }).unwrap();
      toast.success(`${name} deleted`);
      setPendingDelete(null);
    } catch (err: any) {
      toast.error(extractErrorMessage(err, "Failed to delete workspace"));
    }
  };

  if (workspaces.length === 0) {
    return (
      <ArchiveEmptyState
        title="No archived workspaces"
        description="Workspaces you archive from the sidebar will appear here."
      />
    );
  }

  return (
    <>
      <ArchiveSearch
        value={search}
        onChange={setSearch}
        label="Search archived workspaces"
      />

      {matches.length === 0 ? (
        <div className="py-14 text-center">
          <Muted>No archived workspaces match “{search}”.</Muted>
        </div>
      ) : (
        <SettingsSection
          title={`${matches.length} archived workspace${matches.length === 1 ? "" : "s"}`}
        >
          {matches.map((workspace, index) => (
            <div
              key={workspace.id}
              className={
                index > 0
                  ? "border-t border-primary-200/60 dark:border-primary-800/20"
                  : undefined
              }
            >
              <ArchivedWorkspaceRow
                workspace={workspace}
                onUnarchive={() => handleUnarchive(workspace)}
                onDelete={() => openDelete(workspace)}
              />
            </div>
          ))}
        </SettingsSection>
      )}

      <Alert
        isOpen={!!pendingDelete}
        title="Delete workspace?"
        description={`${pendingDelete?.name ?? "This workspace"} will be permanently deleted along with its runs and review history. This cannot be undone.`}
        primaryButtonText="Delete"
        secondaryButtonText="Cancel"
        primaryButtonVariant="danger"
        isPrimaryLoading={isDeleting}
        onPrimary={handleConfirmDelete}
        onSecondary={() => setPendingDelete(null)}
      >
        {pendingDelete?.worktree ? (
          <label className="flex cursor-pointer items-center gap-2.5">
            <Checkbox
              checked={removeWorktree}
              onChange={setRemoveWorktree}
              aria-label="Also remove the worktree from disk"
            />
            <Caption tone="default">
              Also remove the worktree from disk
            </Caption>
          </label>
        ) : (
          <Caption className="block opacity-70">
            The folder at {pendingDelete?.rootPath} is left untouched — it is
            your repository, not a worktree Mains created.
          </Caption>
        )}
      </Alert>
    </>
  );
}

/**
 * Archived runs come from two experiences that share one table: developer runs
 * belong to a workspace, work/chat runs belong to a project (or nothing at
 * all). Grouping them by workspace alone piles every chat into "No workspace",
 * so the list splits by that origin first and groups inside it.
 */
type RunSectionKey = "code" | "chats";

interface RunGroup {
  key: string;
  /** Workspace name for code runs, project name for chats. */
  title: string;
  /** The group's own icon, or null to fall back to a plain folder. */
  icon: string | null;
  workspaceArchived: boolean;
  runs: ArchivedRun[];
}

const RUN_SECTIONS: readonly {
  key: RunSectionKey;
  label: string;
  /** Singular noun for the per-group count. */
  noun: string;
}[] = [
  { key: "code", label: "Code", noun: "run" },
  { key: "chats", label: "Chats", noun: "chat" },
];

/**
 * Filters archived runs by `search` and lays them out as sections of groups.
 * Pure — the panel only supplies the collection names it has loaded.
 */
export function groupArchivedRuns(runs: ArchivedRun[], search: string) {
  const normalizedSearch = search.trim().toLowerCase();
  const buckets: Record<RunSectionKey, Map<string, RunGroup>> = {
    code: new Map(),
    chats: new Map(),
  };

  for (const run of runs) {
    const provider = getProviderVariantById(run.providerId);
    const chat = run.mode !== "developer";
    // A chat has no workspace to name it, so its project stands in — the same
    // label and glyph the sidebar files it under. A project the user has since
    // deleted arrives null, leaving the chat unfiled like one that never had
    // a project.
    const owner = chat ? run.collection : run.workspace;
    const matches = [run.title, run.goal, run.model, owner?.name, provider?.label]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(normalizedSearch));
    if (normalizedSearch && !matches) continue;

    const bucket = buckets[chat ? "chats" : "code"];
    const key = owner?.id ?? (chat ? "unfiled" : "unassigned");
    const group = bucket.get(key) ?? {
      key,
      title: owner?.name ?? (chat ? "No project" : "No workspace"),
      icon: owner?.icon ?? null,
      workspaceArchived: chat ? false : (run.workspace?.isArchived ?? false),
      runs: [],
    };
    group.runs.push(run);
    bucket.set(key, group);
  }

  return RUN_SECTIONS.map((section) => ({
    ...section,
    groups: [...buckets[section.key].values()],
  })).filter((section) => section.groups.length > 0);
}

/**
 * The filter box both tabs sit behind — right-aligned and narrow so it reads as
 * a filter over the list rather than the page's own header.
 */
function ArchiveSearch({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div className="mb-7 flex justify-end">
      <div className="relative w-64 max-w-full">
        <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-primary-400" />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={label}
          aria-label={label}
          className={`pl-9 ${value ? "pr-9" : "pr-3"}`}
        />
        {value && (
          <Button
            onClick={() => onChange("")}
            tooltip="Clear search"
            aria-label="Clear search"
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2 cursor-pointer rounded-lg p-1 text-primary-600 hover:bg-primary/50 hover:text-primary-800 dark:text-primary-400 dark:hover:bg-primary/10 dark:hover:text-primary-200"
          >
            <Close className="size-3" />
          </Button>
        )}
      </div>
    </div>
  );
}

function ArchivedRunsPanel({ runs }: { runs: ArchivedRun[] }) {
  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ArchivedRun | null>(null);
  const [unarchiveRun] = useUnarchiveRunMutation();
  const [deleteRun, { isLoading: isDeleting }] = useDeleteRunMutation();

  const sections = useMemo(
    () => groupArchivedRuns(runs, search),
    [runs, search],
  );

  const hasMatches = sections.length > 0;

  const handleUnarchive = async (run: ArchivedRun) => {
    try {
      await unarchiveRun(run.id).unwrap();
      toast.success(`${runDisplayTitle(run)} restored`);
    } catch (err: any) {
      toast.error(extractErrorMessage(err, "Failed to unarchive run"));
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteRun(pendingDelete.id).unwrap();
      toast.success(`${runDisplayTitle(pendingDelete)} deleted`);
      setPendingDelete(null);
    } catch (err: any) {
      toast.error(extractErrorMessage(err, "Failed to delete run"));
    }
  };

  if (runs.length === 0) {
    return (
      <ArchiveEmptyState
        title="No archived runs"
        description="Runs you archive from a workspace tab, and chats you archive from the sidebar, will appear here."
      />
    );
  }

  return (
    <>
      <ArchiveSearch
        value={search}
        onChange={setSearch}
        label="Search archived runs"
      />

      {!hasMatches ? (
        <div className="py-14 text-center">
          <Muted>No archived runs match “{search}”.</Muted>
        </div>
      ) : (
        sections.map((section) => (
          <div key={section.key} className="mb-10 last:mb-0">
            <Text
              as="h3"
              size="xs"
              tone="secondary"
              weight="medium"
              className="mb-3 px-1 uppercase tracking-wide"
            >
              {section.label}
            </Text>

            {section.groups.map((group) => (
              <section key={group.key} className="mb-8 last:mb-0">
                <div className="mb-3 flex items-center gap-2 px-1">
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    <ProjectIcon icon={group.icon} projectName={group.title} />
                  </span>
                  <Body className="truncate">{group.title}</Body>
                  <Caption className="ml-auto shrink-0 opacity-70">
                    {group.runs.length} {section.noun}
                    {group.runs.length === 1 ? "" : "s"}
                  </Caption>
                  {group.workspaceArchived && (
                    <Text
                      as="span"
                      size="t"
                      tone="warning"
                      weight="medium"
                      className="rounded-full bg-warning/10 px-2 py-0.5"
                    >
                      Workspace archived
                    </Text>
                  )}
                </div>

                <div className="rounded-3xl glass-surface px-4 py-1">
                  {group.runs.map((run, index) => (
                    <div
                      key={run.id}
                      className={
                        index > 0
                          ? "border-t border-primary-200/60 dark:border-primary-800/20"
                          : undefined
                      }
                    >
                      <ArchivedRunRow
                        run={run}
                        onUnarchive={() => handleUnarchive(run)}
                        onDelete={() => setPendingDelete(run)}
                      />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ))
      )}

      <Alert
        isOpen={!!pendingDelete}
        title="Delete run?"
        description="This permanently deletes the run and its stored history from Mains. For Codex runs, the Codex thread and its spawned descendant threads are deleted too. This cannot be undone."
        primaryButtonText="Delete"
        secondaryButtonText="Cancel"
        primaryButtonVariant="danger"
        isPrimaryLoading={isDeleting}
        onPrimary={handleDelete}
        onSecondary={() => setPendingDelete(null)}
      />
    </>
  );
}

export function ArchivedWorkspaceRow({
  workspace,
  onUnarchive,
  onDelete,
}: {
  workspace: ArchivedWorkspace;
  onUnarchive: () => void;
  onDelete: () => void;
}) {
  const branch = workspace.worktree?.name ?? workspace.baseBranch;
  const statusConfig = getWorkspaceStatusConfig(workspace.status);
  const projectMissing = workspace.projectName === null;

  return (
    <div className="flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between md:gap-8">
      <div className="min-w-0 md:flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <Body className="truncate">{workspace.name}</Body>
          {branch && <Body className="truncate opacity-70">• {branch}</Body>}
          {!workspace.pathExists && (
            <Text
              as="span"
              size="t"
              tone="warning"
              className="flex shrink-0 items-center gap-1 rounded-full bg-warning/10 px-1.5 py-0.5"
            >
              <Danger className="size-3" />
              Folder missing
            </Text>
          )}
          {projectMissing && (
            <Text
              as="span"
              size="t"
              tone="warning"
              className="flex shrink-0 items-center gap-1 rounded-full bg-warning/10 px-1.5 py-0.5"
            >
              <Danger className="size-3" />
              Project missing
            </Text>
          )}
        </div>

        <div className="mt-0.5 flex min-w-0 items-center gap-1">
          <WorkspaceStatusIcon
            status={workspace.status}
            className={`size-2.5 shrink-0 ${statusConfig.iconColor}`}
          />
          <Caption className="shrink-0 opacity-70">
            {statusConfig.label}
          </Caption>
          <Caption className="truncate opacity-70">
            • {formatAbsoluteDate(workspace.updatedAt)}
          </Caption>
        </div>
      </div>

      <ArchiveRowActions
        onDelete={onDelete}
        onUnarchive={onUnarchive}
        unarchiveDisabled={projectMissing}
        unarchiveTooltip={
          projectMissing
            ? "This workspace's Project is missing and it cannot be restored"
            : undefined
        }
      />
    </div>
  );
}

function ArchivedRunRow({
  run,
  onUnarchive,
  onDelete,
}: {
  run: ArchivedRun;
  onUnarchive: () => void;
  onDelete: () => void;
}) {
  const provider = getProviderVariantById(run.providerId);
  const ProviderIcon = provider?.icon;
  const title = runDisplayTitle(run);
  const unarchiveUnavailableReason = !run.workspace && run.mode === "developer"
    ? "This Code run has no workspace and cannot be restored"
    : run.workspace?.isArchived
      ? "Unarchive the workspace before restoring this run"
      : undefined;

  return (
    <div className="flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between md:gap-8">
      <div className="min-w-0 md:flex-1">
        <Body className="block truncate">{title}</Body>

        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="flex items-center gap-1">
            {ProviderIcon && (
              <ProviderIcon
                className={`size-3.5 text-primary-600 dark:text-primary-400`}
              />
            )}
            <Caption className="opacity-80">
              {provider?.label ?? run.providerId}
            </Caption>
          </span>
          <Caption className="opacity-70">
            {formatAbsoluteDate(run.updatedAt)}
          </Caption>
        </div>
      </div>

      <ArchiveRowActions
        onDelete={onDelete}
        onUnarchive={onUnarchive}
        unarchiveDisabled={Boolean(unarchiveUnavailableReason)}
        unarchiveTooltip={unarchiveUnavailableReason}
      />
    </div>
  );
}

function ArchiveRowActions({
  onDelete,
  onUnarchive,
  unarchiveDisabled = false,
  unarchiveTooltip,
}: {
  onDelete: () => void;
  onUnarchive: () => void;
  unarchiveDisabled?: boolean;
  unarchiveTooltip?: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button
        variant="ghost"
        onClick={onDelete}
        tooltip="Delete permanently"
        className="flex rounded-full px-2 py-1 text-primary-700 dark:text-primary-300"
      >
        <Trash className="size-4" />
      </Button>
      <Button
        variant="secondary"
        onClick={onUnarchive}
        disabled={unarchiveDisabled}
        tooltip={unarchiveTooltip}
      >
        Unarchive
      </Button>
    </div>
  );
}

function ArchiveEmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <Archive className="size-5 text-primary-600 dark:text-primary-400" />
      <Muted>{title}.</Muted>
      <Caption>{description}</Caption>
    </div>
  );
}

function runDisplayTitle(run: ArchivedRun): string {
  return run.title || run.goal || `Run ${run.id.slice(0, 8)}`;
}
