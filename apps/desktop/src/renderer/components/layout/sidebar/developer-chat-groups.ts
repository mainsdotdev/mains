import type { Project, RecentRun, Workspace, WorkspaceGitState } from "@/lib/redux/api";
import type { WorkspaceListSources } from "@/lib/redux/slices/appSettingsSlice";
import { repoIdentity } from "@/features/bridge/lib/repo-identity";

export interface DeveloperChatGroup {
  project: Project;
  workspaces: Workspace[];
  chats: RecentRun[];
}

/** A project's local and worktree chats share one flat list. Workspaces provide context, not another tree level. */
export function groupDeveloperChats(
  runs: readonly RecentRun[], projects: readonly Project[], workspaces: readonly Workspace[],
  gitStates: ReadonlyMap<string, WorkspaceGitState>, sources: WorkspaceListSources, search: string,
) {
  const query = search.trim().toLocaleLowerCase();
  const projectsById = new Map(projects.filter((project) => !project.isArchived).map((project) => [project.id, project]));
  const localByOrigin = new Map(projects.filter((project) => !project.isReplica && !project.isArchived)
    .flatMap((project) => { const origin = repoIdentity(project); return origin ? [[origin, project] as const] : []; }));
  const workspaceMap = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const groups = new Map<string, DeveloperChatGroup>();
  const recents: RecentRun[] = [];
  const projectFor = (workspace: Workspace | undefined) => {
    const project = workspace?.projectId ? projectsById.get(workspace.projectId) : undefined;
    const origin = repoIdentity(project);
    return project?.isReplica && origin ? localByOrigin.get(origin) ?? project : project;
  };
  for (const workspace of workspaces) {
    if (workspace.isArchived || !(workspace.isReplica ? sources.bridge : sources.local)) continue;
    const project = projectFor(workspace);
    if (!project) continue;
    const group = groups.get(project.id) ?? { project, workspaces: [], chats: [] };
    group.workspaces.push(workspace); groups.set(project.id, group);
  }
  for (const run of runs) {
    if (run.mode !== "developer" || run.isArchived || !(run.isReplica ? sources.bridge : sources.local)) continue;
    const workspace = run.workspaceId ? workspaceMap.get(run.workspaceId) : undefined;
    // Recent runs outlive the active workspace list when a workspace is archived.
    if (!workspace || workspace.isArchived) continue;
    const project = projectFor(workspace);
    const branch = workspace?.isReplica ? workspace.metadata?.lastBranch : gitStates.get(run.workspaceId ?? "")?.branch;
    if (query && ![run.title, run.goal, project?.name, workspace?.name, workspace?.rootPath, branch]
      .some((value) => value?.toLocaleLowerCase().includes(query))) continue;
    if (!project) { recents.push(run); continue; }
    const group = groups.get(project.id) ?? { project, workspaces: workspace ? [workspace] : [], chats: [] };
    group.chats.push(run); groups.set(project.id, group);
  }
  return { recents, groups: [...groups.values()]
    .filter((group) => !query || group.chats.length || group.project.name.toLocaleLowerCase().includes(query))
    .sort((a, b) => a.project.sortOrder - b.project.sortOrder || a.project.name.localeCompare(b.project.name)) };
}
