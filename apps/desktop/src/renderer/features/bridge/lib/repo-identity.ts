import type { Project } from "@/lib/redux/api/projectsApi";
import type { Workspace } from "@/lib/redux/api/workspaceApi";

/** Projects store their remote already normalized (`host/owner/repo`). Git hosts
 * treat owner/repo case-insensitively, so case never splits one repository. */
export function repoIdentity(project: Pick<Project, "remoteOrigin"> | undefined): string | null {
  const origin = project?.remoteOrigin?.trim().toLowerCase();
  return origin ? origin : null;
}

/** Prefer the source checkout's original URL (ssh/https as the user configured it). */
export function repoCloneUrl(workspaces: Pick<Workspace, "repoUrl">[], project: Pick<Project, "remoteOrigin"> | undefined): string | null {
  const configured = workspaces.find((workspace) => workspace.repoUrl?.trim())?.repoUrl?.trim();
  if (configured) return configured;
  const origin = project?.remoteOrigin?.trim();
  return origin ? `https://${origin}.git` : null;
}

/** What a replica row shows where a local row shows its live branch: the source's
 * last reported branch, else the worktree name, else the branch tracked at import. */
export function replicaBranch(workspace: Pick<Workspace, "metadata" | "baseBranch" | "name">): { branch: string; known: boolean } {
  const metadata = workspace.metadata;
  if (typeof metadata?.lastBranch === "string" && metadata.lastBranch.trim()) return { branch: metadata.lastBranch.trim(), known: true };
  const worktree = metadata?.worktree;
  if (worktree?.enabled && typeof worktree.name === "string" && worktree.name.trim()) return { branch: worktree.name.trim(), known: false };
  const tracking = typeof metadata?.tracking === "string" ? metadata.tracking.trim().replace(/^[^/]+\//, "") : "";
  return { branch: tracking || workspace.baseBranch?.trim() || workspace.name, known: false };
}

export interface RemoteOnlyRepo { identity: string; project: Project; workspaces: Workspace[]; cloneUrl: string | null }

/** Places other devices' workspaces by repository identity, never by device-local ids:
 * - under this device's project group for the same remote (`merged`);
 * - in one repository group per remote that exists only elsewhere (`remoteOnly`);
 * - in their device group when they have no remote to identify them (`unmatched`). */
export function planReplicaWorkspaces(replicas: Workspace[], projectsById: ReadonlyMap<string, Project>, localProjectIds: Iterable<string>) {
  const localByIdentity = new Map<string, string>();
  for (const id of localProjectIds) {
    const identity = repoIdentity(projectsById.get(id));
    if (identity && !localByIdentity.has(identity)) localByIdentity.set(identity, id);
  }
  const merged = new Map<string, Workspace[]>(), remoteOnly = new Map<string, RemoteOnlyRepo>(), unmatched: Workspace[] = [];
  for (const workspace of replicas) {
    const project = workspace.projectId ? projectsById.get(workspace.projectId) : undefined;
    const identity = repoIdentity(project);
    if (!identity || !project) { unmatched.push(workspace); continue; }
    const local = localByIdentity.get(identity);
    if (local) {
      const rows = merged.get(local); if (rows) rows.push(workspace); else merged.set(local, [workspace]);
      continue;
    }
    const repo = remoteOnly.get(identity);
    if (repo) repo.workspaces.push(workspace);
    else remoteOnly.set(identity, { identity, project, workspaces: [workspace], cloneUrl: null });
  }
  const repos = [...remoteOnly.values()].map((repo) => ({ ...repo, cloneUrl: repoCloneUrl(repo.workspaces, repo.project) }))
    .sort((a, b) => a.project.name.localeCompare(b.project.name) || a.identity.localeCompare(b.identity));
  return { merged, remoteOnly: repos, unmatched };
}
