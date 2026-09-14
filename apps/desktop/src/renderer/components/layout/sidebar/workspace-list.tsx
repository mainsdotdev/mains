import { useState, useMemo, type MouseEvent, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setWorkspaceListGrouping } from "@/lib/redux/slices/appSettingsSlice";
import { Text, toast } from "@/components/ui";
import WorkspaceItem from "./workspace-item";
import type {
  Workspace as WorkspaceResponse,
  WorkspaceGitState,
} from "@/lib/redux/api/workspaceApi";
import { LinkResourcesModal } from "@/features/workspace/components/link-resources-modal";
import { WORKSPACE_BASE_PATH } from "@/lib/route-utils";
import { getWorkspaceStatusConfig } from "@/lib/workspace-status";
import { Plus, WorkspaceStatusIcon } from "@/components/ui/icons";
import type { WorkspaceStatus } from "@/lib/redux/api/workspaceApi";
import {
  useListProjectsQuery,
  useUpdateWorkspaceMutation,
  useCreateWorkspaceFromSourceMutation,
  useRenameWorkspaceBranchMutation,
  useGetAccountQuery,
} from "@/lib/redux/api";
import type { Project } from "@/lib/redux/api/projectsApi";
import { ProjectIcon } from "./project-icon";
import {
  SidebarGroupSection,
  SIDEBAR_ACTION_ICON,
} from "./sidebar-group-section";
import { WorkspaceGroupDropdown, type GroupingMode } from "./workspace-group-dropdown";

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

const STATUS_ORDER: WorkspaceStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
  "duplicate",
];

interface WorkspacesListProps {
  workspaces: WorkspaceResponse[];
  gitStateByWorkspaceId: ReadonlyMap<string, WorkspaceGitState>;
  isLoading: boolean;
  onDeleteWorkspace?: (workspaceId: string, e: MouseEvent) => void;
  onArchiveWorkspace?: (workspaceId: string) => void;
}

export default function WorkspacesList({
  workspaces,
  gitStateByWorkspaceId,
  isLoading,
  onDeleteWorkspace,
  onArchiveWorkspace,
}: WorkspacesListProps) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isExpanded, setIsExpanded] = useState(true);
  const [linkModalState, setLinkModalState] = useState<{
    isOpen: boolean;
    projectId: string;
    workspaceName: string;
  }>({ isOpen: false, projectId: "", workspaceName: "" });
  const navigate = useNavigate();
  const location = useLocation();
  const [updateWorkspace] = useUpdateWorkspaceMutation();
  const [createWorkspaceFromSource] = useCreateWorkspaceFromSourceMutation();
  const [renameWorkspaceBranch] = useRenameWorkspaceBranchMutation();
  const { data: account } = useGetAccountQuery();
  const activeWorkspaceId = useAppSelector(
    (state) => state.workspace.activeWorkspaceId,
  );

  // Grouping state
  const dispatch = useAppDispatch();
  const grouping = useAppSelector(
    (state) => state.appSettings.workspaceListGrouping,
  );
  const setGrouping = (mode: GroupingMode) =>
    dispatch(setWorkspaceListGrouping(mode));

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-16">
        <Text size="xs">Loading...</Text>
      </div>
    );
  }

  if (workspaces.length === 0) {
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

  const handleRenameBranch = async (workspace: WorkspaceResponse, newBranchName: string) => {
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

  const sortedWorkspaces = [...workspaces].sort((a, b) => {
    const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return dateB - dateA;
  });

  // Compute groups
  const computeGroups = (): WorkspaceGroup[] => {
    if (grouping === "status") {
      const byStatus = new Map<WorkspaceStatus, WorkspaceResponse[]>();
      for (const ws of sortedWorkspaces) {
        const list = byStatus.get(ws.status) ?? [];
        list.push(ws);
        byStatus.set(ws.status, list);
      }
      return STATUS_ORDER.filter((s) => byStatus.has(s)).map((s) => {
        const config = getWorkspaceStatusConfig(s);
        return {
          key: `status-${s}`,
          label: config.label,
          icon: (
            <WorkspaceStatusIcon
              status={s}
              className={`size-3 ${config.iconColor}`}
            />
          ),
          workspaces: byStatus.get(s)!,
        };
      });
    }

    if (grouping === "project") {
      const byProject = new Map<string | null, WorkspaceResponse[]>();
      for (const ws of sortedWorkspaces) {
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
          return nameA.localeCompare(nameB);
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
          workspaces: wsList,
          project: data,
        });
      }
      const ungrouped = byProject.get(null);
      if (ungrouped) {
        result.push({
          key: "project-ungrouped",
          label: "Ungrouped",
          workspaces: ungrouped,
        });
      }
      return result;
    }

    return [];
  };

  const groups = grouping !== "none" ? computeGroups() : [];

  const renderWorkspaceItem = (workspace: WorkspaceResponse) => {
    const isActive = location.pathname === `${basePath}/${workspace.id}` ||
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
        status={workspace.status}
        branch={branch}
        pathExists={pathExists}
        updatedAt={workspace.updatedAt}
        isActive={isActive}
        projectId={workspace.projectId}
        projectIcon={
          projectData
            ? <ProjectIcon icon={projectData.icon} projectName={projectData.name} />
            : undefined
        }
        grouping={grouping}
        onClick={() => handleWorkspaceClick(workspace)}
        onDelete={(e) => onDeleteWorkspace?.(workspace.id, e)}
        onLinkIssues={() => handleLinkIssues(workspace)}
        onArchive={() => onArchiveWorkspace?.(workspace.id)}
        onStatusChange={(newStatus) =>
          updateWorkspace({ id: workspace.id, payload: { status: newStatus } })
        }
        onRenameBranch={
          canRenameBranch
            ? (newName) => handleRenameBranch(workspace, newName)
            : undefined
        }
        onSettings={
          workspace.projectId
            ? () =>
                navigate(`/settings?section=projects&id=${workspace.projectId}`)
            : undefined
        }
      />
    );
  };

  return (
    <div className="pb-2">
      <div
        // role="button"
        // tabIndex={0}
        // onClick={() => setIsExpanded(!isExpanded)}
        // onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setIsExpanded(!isExpanded); } }}
        className="w-full flex items-center justify-between transition-all duration-200 bg-transparent px-2 py-1 "
      >
            <Text as="span" size="xs" tone="secondary" weight="medium">
            Workspaces
        </Text>
        <div className="flex items-center ">
          <div className="-mr-1" role="presentation" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <WorkspaceGroupDropdown
              grouping={grouping}
              onGroupingChange={setGrouping}
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
        {grouping === "none" ? (
          <div className="flex flex-col space-y-1">
            {sortedWorkspaces.map(renderWorkspaceItem)}
          </div>
        ) : (
          <div className={`flex flex-col ${grouping === "project" ? "gap-1" : ""}`}>
            {groups.map((group) => (
              <SidebarGroupSection
                key={group.key}
                groupKey={group.key}
                label={group.label}
                icon={group.icon}
                count={group.workspaces.length}
                action={
                  group.project
                    ? {
                        label: "Create new worktree",
                        onClick: () =>
                          handleCreateWorktreeForProject(group.project!),
                        icon: <Plus className={SIDEBAR_ACTION_ICON} />,
                      }
                    : undefined
                }
              >
                <div className="flex flex-col space-y-0.5">
                  {group.workspaces.map(renderWorkspaceItem)}
                </div>
              </SidebarGroupSection>
            ))}
          </div>
        )}
      </div>

      <LinkResourcesModal
        projectId={linkModalState.projectId}
        workspaceName={linkModalState.workspaceName}
        isOpen={linkModalState.isOpen}
        onClose={() => setLinkModalState({ isOpen: false, projectId: "", workspaceName: "" })}
      />
    </div>
  );
}
