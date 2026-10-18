import { useState, useMemo, type MouseEvent, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import {
  normalizeWorkspaceListSources,
  setWorkspaceListGrouping,
  setWorkspaceListSourceVisible,
} from "@/lib/redux/slices/appSettingsSlice";
import {
  DropdownMenu,
  DropdownMenuItem,
  SortableItem,
  SortableList,
  Text,
  toast,
  type SortableHandle,
} from "@/components/ui";
import WorkspaceItem from "./workspace-item";
import PendingWorkspaceItem from "./pending-workspace-item";
import type { PendingWorkspaceClone } from "@/hooks/use-sidebar-actions";
import type {
  Workspace as WorkspaceResponse,
  WorkspaceGitState,
} from "@/lib/redux/api/workspaceApi";
import { LinkResourcesModal } from "@/features/workspace/components/link-resources-modal";
import { WORKSPACE_BASE_PATH } from "@/lib/route-utils";
import { Option, Plus, Settings, Bridge, Clone } from "@/components/ui/icons";
import { useBridgeStatus } from "@/features/bridge/hooks/use-bridge";
import {
  bridgeBackend,
  bridgePresence,
  groupReplicaItems,
} from "@/features/bridge/lib/backends";
import { planReplicaWorkspaces } from "@/features/bridge/lib/repo-identity";
import { ReplicaWorkspaceRow } from "@/features/bridge/components/replica-workspace-row";
import {
  useListProjectsQuery,
  useCreateWorkspaceFromSourceMutation,
  useRenameWorkspaceBranchMutation,
  useGetAccountQuery,
  useReorderProjectsMutation,
  useReorderWorkspacesMutation,
  useSetWorkspacePinnedMutation,
} from "@/lib/redux/api";
import type { Project } from "@/lib/redux/api/projectsApi";
import { ProjectIcon } from "./project-icon";
import { SIDEBAR_ACTION_ICON, SidebarGroupSection } from "./sidebar-group-section";
import {
  WorkspaceGroupDropdown,
  type GroupingMode,
} from "./workspace-group-dropdown";
import { reorderVisibleIds } from "./sidebar-order";

type WorkspaceGroup = {
  key: string;
  label: string;
  /** Function form tracks the section's open state (see SidebarGroupSection). */
  icon?: ReactNode | ((expanded: boolean) => ReactNode);
  workspaces: WorkspaceResponse[];
  project?: Project;
};

/** Pull a human message out of an RTK/IPC rejection (string | {error} | Error). */
function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "error" in error &&
    typeof (error as { error: unknown }).error === "string"
  ) {
    return (error as { error: string }).error;
  }
  return fallback;
}

interface WorkspacesListProps {
  workspaces: WorkspaceResponse[];
  pendingClones: PendingWorkspaceClone[];
  onCancelClone: (id: string) => void;
  onRetryClone: (id: string) => void;
  onDismissClone: (id: string) => void;
  gitStateByWorkspaceId: ReadonlyMap<string, WorkspaceGitState>;
  isLoading: boolean;
  searchQuery: string;
  onDeleteWorkspace?: (workspaceId: string, e: MouseEvent) => void;
  onArchiveWorkspace?: (workspaceId: string) => void;
  /** Opens the clone dialog for a repository that exists only on another device. */
  onCloneRepository?: (url: string) => void;
}

export default function WorkspacesList({
  workspaces,
  pendingClones,
  onCancelClone,
  onRetryClone,
  onDismissClone,
  gitStateByWorkspaceId,
  isLoading,
  searchQuery,
  onDeleteWorkspace,
  onArchiveWorkspace,
  onCloneRepository,
}: WorkspacesListProps) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isExpanded, setIsExpanded] = useState(true);
  const [linkModalState, setLinkModalState] = useState<{
    isOpen: boolean;
    projectId: string;
    workspaceName: string;
  }>({ isOpen: false, projectId: "", workspaceName: "" });
  const [menuProject, setMenuProject] = useState<Project | null>(null);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const navigate = useNavigate();
  const location = useLocation();
  const [createWorkspaceFromSource] = useCreateWorkspaceFromSourceMutation();
  const [renameWorkspaceBranch] = useRenameWorkspaceBranchMutation();
  const [reorderProjects, { isLoading: isReorderingProjects }] =
    useReorderProjectsMutation();
  const [reorderWorkspaces, { isLoading: isReorderingWorkspaces }] =
    useReorderWorkspacesMutation();
  const [setWorkspacePinned] = useSetWorkspacePinnedMutation();
  const { data: account } = useGetAccountQuery();
  const activeWorkspaceId = useAppSelector(
    (state) => state.workspace.activeWorkspaceId,
  );

  // Grouping state
  const dispatch = useAppDispatch();
  const savedGrouping = useAppSelector(
    (state) => state.appSettings.workspaceListGrouping,
  );
  // Older saved preferences can still contain "status". Display the new
  // default until the persisted-state migration replaces that preference.
  const grouping: GroupingMode =
    savedGrouping === "status" ? "project" : savedGrouping;
  const setGrouping = (mode: GroupingMode) =>
    dispatch(setWorkspaceListGrouping(mode));
  const sources = normalizeWorkspaceListSources(
    useAppSelector((state) => state.appSettings.workspaceListSources),
  );
  const showLocal = sources.local;
  const showBridge = sources.bridge;
  const setSourceVisible = (
    source: "local" | "bridge",
    visible: boolean,
  ) => dispatch(setWorkspaceListSourceVisible({ source, visible }));

  // Project data for icons and grouping
  const { data: projects = [] } = useListProjectsQuery();

  const projectDataMap = useMemo(() => {
    const map = new Map<string, Project>();
    for (const project of projects) {
      map.set(project.id, project);
    }
    return map;
  }, [projects]);

  const basePath = WORKSPACE_BASE_PATH;
  const { data: bridgeStatus } = useBridgeStatus();
  const cloneSearch = searchQuery.toLowerCase().trim();
  const visibleClones = pendingClones.filter(
    (clone) =>
      !cloneSearch ||
      [clone.name, clone.url, clone.targetPath].some((value) =>
        value.toLowerCase().includes(cloneSearch),
      ),
  );

  if (isLoading && visibleClones.length === 0) {
    return (
      <div className="flex items-center justify-center h-16">
        <Text size="xs">Loading...</Text>
      </div>
    );
  }

  if (workspaces.length === 0 && visibleClones.length === 0) {
    return (
      <div className="flex items-center justify-center h-16">
        <Text size="xs">No projects yet</Text>
      </div>
    );
  }

  const handleWorkspaceClick = (workspace: WorkspaceResponse) => {
    navigate(`${basePath}/${workspace.id}`);
  };

  const handleLinkIssues = (workspace: WorkspaceResponse) => {
    if (!workspace.projectId) return;
    setLinkModalState({
      isOpen: true,
      projectId: workspace.projectId,
      workspaceName: workspace.name,
    });
  };

  // Both are single workspace operations — the git + metadata orchestration
  // lives in workspace.service. See CONTEXT.md "Workspace git operations".
  const handleCreateWorktreeForProject = async (project: Project) => {
    try {
      const workspace = await createWorkspaceFromSource({
        accountId: account?.id || "default",
        source: { kind: "worktree", projectId: project.id },
      }).unwrap();
      toast.success("Worktree created");
      navigate(`${basePath}/${workspace.id}`);
    } catch (error) {
      console.error("Failed to create worktree:", error);
      toast.error(getErrorMessage(error, "Failed to create worktree"));
    }
  };

  const openProjectMenu = (
    project: Project,
    event: MouseEvent<HTMLElement>,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPosition({ x: rect.right, y: rect.bottom + 4 });
    setMenuProject(project);
  };

  const handleRenameBranch = async (
    workspace: WorkspaceResponse,
    newBranchName: string,
  ) => {
    try {
      await renameWorkspaceBranch({
        id: workspace.id,
        newBranchName,
      }).unwrap();
      toast.success(`Branch renamed to ${newBranchName}`);
    } catch (error) {
      console.error("Failed to rename branch:", error);
      toast.error(getErrorMessage(error, "Failed to rename branch"));
    }
  };

  const allLocalWorkspaces = workspaces
    .filter((workspace) => !workspace.isReplica)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const sortedWorkspaces = showLocal ? allLocalWorkspaces : [];
  const pinnedWorkspaces = sortedWorkspaces.filter(
    (workspace) => workspace.pinnedAt !== null,
  );
  const unpinnedWorkspaces = sortedWorkspaces.filter(
    (workspace) => workspace.pinnedAt === null,
  );
  const allWorkspaceIds = sortedWorkspaces.map((workspace) => workspace.id);
  const allProjectIds = [...projects]
    .filter(
      (project) =>
        !project.isReplica &&
        project.accountId === account?.id &&
        !project.isArchived,
    )
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    .map((project) => project.id);
  const canReorderWorkspaces =
    !searchQuery.trim() &&
    !!account &&
    sortedWorkspaces.every((workspace) => workspace.accountId === account.id) &&
    !isReorderingWorkspaces;

  const persistWorkspaceOrder = (orderedVisibleIds: string[]) => {
    if (!account) return;
    const orderedIds = reorderVisibleIds(allWorkspaceIds, orderedVisibleIds);
    void reorderWorkspaces({ accountId: account.id, orderedIds })
      .unwrap()
      .catch((error) => {
        console.error("Failed to reorder workspaces:", error);
        toast.error("Failed to reorder workspaces");
      });
  };

  const persistProjectOrder = (orderedVisibleIds: string[]) => {
    if (!account) return;
    const orderedIds = reorderVisibleIds(allProjectIds, orderedVisibleIds);
    void reorderProjects({ accountId: account.id, orderedIds })
      .unwrap()
      .catch((error) => {
        console.error("Failed to reorder projects:", error);
        toast.error("Failed to reorder projects");
      });
  };

  const toggleWorkspacePin = (workspace: WorkspaceResponse) => {
    if (!account) return;
    const pinned = workspace.pinnedAt === null;
    void setWorkspacePinned({ id: workspace.id, accountId: account.id, pinned })
      .unwrap()
      .catch((error) => {
        console.error("Failed to change workspace pin:", error);
        toast.error(
          pinned ? "Failed to pin workspace" : "Failed to unpin workspace",
        );
      });
  };

  // Compute groups
  const computeGroups = (): WorkspaceGroup[] => {
    if (grouping === "project") {
      const byProject = new Map<string | null, WorkspaceResponse[]>();
      for (const ws of allLocalWorkspaces) {
        const list = byProject.get(ws.projectId) ?? [];
        list.push(ws);
        byProject.set(ws.projectId, list);
      }
      const result: WorkspaceGroup[] = [];
      const projectEntries = [...byProject.entries()]
        .filter(([pid]) => pid !== null)
        .sort(([a], [b]) => {
          const nameA = projectDataMap.get(a!)?.name ?? a!;
          const nameB = projectDataMap.get(b!)?.name ?? b!;
          const orderA =
            projectDataMap.get(a!)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
          const orderB =
            projectDataMap.get(b!)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
          return orderA - orderB || nameA.localeCompare(nameB);
        });
      for (const [pid, wsList] of projectEntries) {
        const data = projectDataMap.get(pid!);
        const projectName = data?.name ?? "Unknown Project";
        result.push({
          key: `project-${pid}`,
          label: projectName,
          icon: (expanded: boolean) => (
            <ProjectIcon
              icon={data?.icon ?? null}
              projectName={projectName}
              expanded={expanded}
            />
          ),
          workspaces: wsList.filter((workspace) => workspace.pinnedAt === null),
          project: data,
        });
      }
      const ungrouped = byProject.get(null);
      if (ungrouped) {
        result.push({
          key: "project-ungrouped",
          label: "Ungrouped",
          workspaces: ungrouped.filter(
            (workspace) => workspace.pinnedAt === null,
          ),
        });
      }
      return result;
    }

    return [];
  };

  const groups = grouping !== "none" ? computeGroups() : [];
  // Another device's checkout of the same remote joins this device's project
  // group; a remote that exists only elsewhere gets its own repository group.
  // Only workspaces without a remote identity stay under their device.
  const replicaWorkspaces = showBridge
    ? workspaces.filter((workspace) => workspace.isReplica)
    : [];
  const replicaPlan =
    grouping === "project"
      ? planReplicaWorkspaces(
          replicaWorkspaces,
          projectDataMap,
          groups.flatMap((group) =>
            group.project && !group.project.isReplica ? [group.project.id] : [],
          ),
        )
      : {
          merged: new Map<string, WorkspaceResponse[]>(),
          remoteOnly: [],
          unmatched: replicaWorkspaces,
        };
  // One list has no groups: every replica is a two-line row like a local one.
  const replicaGroups =
    grouping === "project"
      ? groupReplicaItems(replicaPlan.unmatched, bridgeStatus)
      : [];
  const listedReplicas =
    grouping === "none"
      ? [...replicaWorkspaces].sort(
          (a, b) =>
            (
              projectDataMap.get(a.projectId ?? "")?.name ?? a.name
            ).localeCompare(
              projectDataMap.get(b.projectId ?? "")?.name ?? b.name,
            ) ||
            bridgeBackend(bridgeStatus, a.ownerBackendId).label.localeCompare(
              bridgeBackend(bridgeStatus, b.ownerBackendId).label,
            ) ||
            a.id.localeCompare(b.id),
        )
      : [];
  const renderReplicaRow = (
    workspace: WorkspaceResponse,
    layout: "project" | "list",
  ) => {
    const project = workspace.projectId
      ? projectDataMap.get(workspace.projectId)
      : undefined;
    const projectName = project?.name ?? workspace.name;
    return (
      <ReplicaWorkspaceRow
        key={workspace.id}
        workspace={workspace}
        layout={layout}
        projectName={projectName}
        projectIcon={
          project ? (
            <ProjectIcon icon={project.icon} projectName={projectName} />
          ) : undefined
        }
        backend={bridgeBackend(bridgeStatus, workspace.ownerBackendId)}
        isActive={location.pathname === `${basePath}/${workspace.id}`}
        onClick={() => handleWorkspaceClick(workspace)}
      />
    );
  };
  const replicasInGroup = (group: WorkspaceGroup) =>
    group.project ? (replicaPlan.merged.get(group.project.id) ?? []) : [];
  // Hiding local rows keeps a project header when another device's checkout
  // still belongs under it. A project with nothing left to show drops out.
  const groupIsVisible = (group: WorkspaceGroup) =>
    showLocal || replicasInGroup(group).length > 0;
  const sortableProjectGroups = groups.filter(
    (group) =>
      groupIsVisible(group) &&
      !!account &&
      !!group.project &&
      group.project.accountId === account.id,
  );
  const otherGroups = groups.filter(
    (group) =>
      groupIsVisible(group) &&
      (!account || !group.project || group.project.accountId !== account.id),
  );
  const canReorderProjects =
    !searchQuery.trim() &&
    !!account &&
    sortableProjectGroups.length > 1 &&
    !isReorderingProjects;

  const renderWorkspaceItem = (
    workspace: WorkspaceResponse,
    sortHandle?: SortableHandle,
    asPinned = false,
  ) => {
    const isActive =
      location.pathname === `${basePath}/${workspace.id}` ||
      (location.pathname === basePath && activeWorkspaceId === workspace.id);
    const projectData = workspace.projectId
      ? projectDataMap.get(workspace.projectId)
      : undefined;
    const gitState = gitStateByWorkspaceId.get(workspace.id);
    const branch = gitState?.branch ?? null;
    // Absent until the first git-state read lands; assume present so rows don't
    // flash a "missing" badge on every cold start.
    const pathExists = gitState?.pathExists ?? true;
    const canRenameBranch =
      branch !== null &&
      branch !== workspace.baseBranch &&
      branch !== projectData?.defaultBranch;
    return (
      <WorkspaceItem
        key={workspace.id}
        id={workspace.id}
        name={workspace.name}
        rootPath={workspace.rootPath}
        branch={branch}
        baseBranch={workspace.baseBranch ?? projectData?.defaultBranch ?? null}
        pathExists={pathExists}
        updatedAt={workspace.updatedAt}
        isActive={isActive}
        projectId={workspace.projectId}
        projectIcon={
          projectData ? (
            <ProjectIcon
              icon={projectData.icon}
              projectName={projectData.name}
            />
          ) : undefined
        }
        grouping={asPinned ? "none" : grouping}
        isPinned={workspace.pinnedAt !== null}
        sortHandle={sortHandle}
        onClick={() => handleWorkspaceClick(workspace)}
        onTogglePin={account ? () => toggleWorkspacePin(workspace) : undefined}
        onDelete={(e) => onDeleteWorkspace?.(workspace.id, e)}
        onLinkIssues={() => handleLinkIssues(workspace)}
        onArchive={() => onArchiveWorkspace?.(workspace.id)}
        onRenameBranch={
          canRenameBranch
            ? (newName) => handleRenameBranch(workspace, newName)
            : undefined
        }
        onSettings={
          workspace.projectId
            ? () =>
                navigate(
                  `/settings?section=projects&kind=code&id=${workspace.projectId}`,
                )
            : undefined
        }
        onCreateWorktree={
          projectData
            ? () => handleCreateWorktreeForProject(projectData)
            : undefined
        }
      />
    );
  };

  const renderSortableWorkspaces = (
    rows: WorkspaceResponse[],
    className: string,
    asPinned = false,
  ) => (
    <SortableList
      ids={rows.map((workspace) => workspace.id)}
      onReorder={persistWorkspaceOrder}
      disabled={!canReorderWorkspaces || rows.length < 2}
      className={className}
    >
      {rows.map((workspace) => (
        <SortableItem key={workspace.id} id={workspace.id}>
          {(sortHandle) => renderWorkspaceItem(workspace, sortHandle, asPinned)}
        </SortableItem>
      ))}
    </SortableList>
  );

  const renderProjectGroup = (
    group: WorkspaceGroup,
    sortHandle?: SortableHandle,
  ) => {
    const localRows = showLocal ? group.workspaces : [];
    const replicas = replicasInGroup(group);
    return (
      <SidebarGroupSection
        groupKey={group.key}
        label={group.label}
        labelWeight="medium"
        icon={group.icon}
        count={localRows.length + replicas.length}
        sortHandle={sortHandle}
        action={
          group.project
            ? {
                label: "Project options",
                onClick: (event) => openProjectMenu(group.project!, event),
                icon: (
                  <Option className="size-3.5 text-primary-800 dark:text-primary-200" />
                ),
                menuOpen: menuProject?.id === group.project.id,
              }
            : undefined
        }
      >
        {localRows.length > 0 ? (
          renderSortableWorkspaces(localRows, "flex flex-col space-y-0.5")
        ) : replicas.length === 0 ? (
          <div className="pl-7 pr-2.5 py-1">
            <Text as="span" size="xxs" tone="muted">
              No workspaces
            </Text>
          </div>
        ) : null}
        {replicas.length > 0 && (
          <div className="mt-0.5 flex flex-col gap-0.5">
            {replicas.map((workspace) =>
              renderReplicaRow(workspace, "project"),
            )}
          </div>
        )}
      </SidebarGroupSection>
    );
  };

  return (
    <div className="pb-2 pt-2">
      {pinnedWorkspaces.length > 0 && (
        <div className="mb-2">
          <SidebarGroupSection
            groupKey="workspace-pinned"
            label="Pinned"
            labelTint="text-primary-800 dark:text-primary-200"
            count={pinnedWorkspaces.length}
          >
            {renderSortableWorkspaces(
              pinnedWorkspaces,
              "flex flex-col space-y-0.5 mt-1",
              true,
            )}
          </SidebarGroupSection>
        </div>
      )}
      <div
        // role="button"
        // tabIndex={0}
        // onClick={() => setIsExpanded(!isExpanded)}
        // onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setIsExpanded(!isExpanded); } }}
        className="w-full flex items-center justify-between transition-all duration-200 bg-transparent px-2 py-1 "
      >
        <Text as="span" size="s" tone="muted" weight="medium">
          Workspaces
        </Text>
        <div className="flex items-center ">
          <div
            className="-mr-1"
            role="presentation"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <WorkspaceGroupDropdown
              grouping={grouping}
              onGroupingChange={setGrouping}
              sources={sources}
              onSourceVisibleChange={setSourceVisible}
            />
          </div>
          {/* <ArrowUp
            className={`w-4 h-4 text-primary-900 dark:text-primary-100 transition-transform duration-200 ${
              isExpanded ? "rotate-180" : "rotate-90"
            }`}
          /> */}
        </div>
      </div>

      <div
        className={` transition-all duration-300 ${
          isExpanded ? "max-h-250 opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        {showLocal && visibleClones.length > 0 && (
          <div className="mb-1 flex flex-col gap-1">
            {visibleClones.map((clone) => (
              <PendingWorkspaceItem
                key={clone.id}
                clone={clone}
                onCancel={() => onCancelClone(clone.id)}
                onRetry={() => onRetryClone(clone.id)}
                onDismiss={() => onDismissClone(clone.id)}
              />
            ))}
          </div>
        )}
        {pinnedWorkspaces.length === 0 &&
        unpinnedWorkspaces.length === 0 &&
        (!showLocal || visibleClones.length === 0) &&
        replicaWorkspaces.length === 0 ? (
          <div className="flex items-center justify-center h-16">
            <Text size="xs">No workspaces</Text>
          </div>
        ) : grouping === "none" ? (
          <>
            {renderSortableWorkspaces(
              unpinnedWorkspaces,
              "flex flex-col space-y-1",
            )}
            {listedReplicas.length > 0 && (
              // Replica rows sit in a display:contents tooltip trigger, which
              // takes no margin; gap spaces the rows themselves.
              <div className="mt-1 flex flex-col gap-1">
                {listedReplicas.map((workspace) =>
                  renderReplicaRow(workspace, "list"),
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-1">
            <SortableList
              ids={sortableProjectGroups.map((group) => group.project!.id)}
              onReorder={persistProjectOrder}
              disabled={!canReorderProjects}
              className="flex flex-col gap-1"
            >
              {sortableProjectGroups.map((group) => (
                <SortableItem key={group.project!.id} id={group.project!.id}>
                  {(sortHandle) => renderProjectGroup(group, sortHandle)}
                </SortableItem>
              ))}
            </SortableList>
            {otherGroups.map((group) => (
              <div key={group.key}>{renderProjectGroup(group)}</div>
            ))}
            {replicaPlan.remoteOnly.map((repo) => (
              <SidebarGroupSection
                key={repo.identity}
                groupKey={`bridge-repo-${repo.identity}`}
                label={repo.project.name}
                labelWeight="medium"
                count={repo.workspaces.length}
                icon={(expanded: boolean) => (
                  <ProjectIcon
                    icon={repo.project.icon}
                    projectName={repo.project.name}
                    expanded={expanded}
                  />
                )}
                action={
                  onCloneRepository && repo.cloneUrl
                    ? {
                        label: "Clone to this device",
                        onClick: () => onCloneRepository(repo.cloneUrl!),
                        icon: <Clone className={SIDEBAR_ACTION_ICON} />,
                      }
                    : undefined
                }
              >
                <div className="flex flex-col gap-0.5">
                  {repo.workspaces.map((workspace) =>
                    renderReplicaRow(workspace, "project"),
                  )}
                </div>
              </SidebarGroupSection>
            ))}
          </div>
        )}
      </div>

      {replicaGroups.map(({ backend, rows }) => (
        <SidebarGroupSection
          key={backend.backendId}
          groupKey={`bridge-workspaces-${backend.backendId}`}
          label={backend.label}
          icon={<Bridge className="size-3.5" />}
          count={rows.length}
        >
          <div className="px-2.5 pb-1">
            <Text size="xxs" tone="muted">
              {bridgePresence(backend)}
            </Text>
          </div>
          <div className="flex flex-col gap-0.5">
            {rows.map((workspace) => renderReplicaRow(workspace, "list"))}
          </div>
        </SidebarGroupSection>
      ))}

      <DropdownMenu
        isOpen={!!menuProject}
        aria-label="Project actions"
        position={menuPosition}
        origin="top-left"
        onClose={() => setMenuProject(null)}
      >
        <DropdownMenuItem
          onClick={() => {
            if (!menuProject) return;
            const projectId = menuProject.id;
            setMenuProject(null);
            navigate(`/settings?section=projects&kind=code&id=${projectId}`);
          }}
        >
          <Settings className="size-3.5" />
          <span>Project settings</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            const project = menuProject;
            setMenuProject(null);
            if (project) void handleCreateWorktreeForProject(project);
          }}
        >
          <Plus className="size-3.5" />
          <span>New worktree</span>
        </DropdownMenuItem>
      </DropdownMenu>

      <LinkResourcesModal
        projectId={linkModalState.projectId}
        workspaceName={linkModalState.workspaceName}
        isOpen={linkModalState.isOpen}
        onClose={() =>
          setLinkModalState({ isOpen: false, projectId: "", workspaceName: "" })
        }
      />
    </div>
  );
}
