import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { existsSync, watch, type FSWatcher } from "fs";
import path from "path";
import { CHANNELS } from "../../../shared/ipc-kit/channels";
import { emit } from "../../ipc-kit";
import { workspaceRepo } from "./workspace.repo";
import { projectsRepo } from "../projects/projects.repo";
import { normalizeRemoteOrigin } from "../projects/projects.utils";
import { gitService, type DiffSnapshot } from "../git";
import { appSettingsService } from "../appSettings/appSettings.service";
import type { CreateProjectPayload, ProjectResponse } from "../projects/projects.dto";
import type {
  ArchivedWorkspaceResponse,
  CreateWorkspacePayload,
  DeleteWorkspaceOptions,
  UpdateWorkspacePayload,
  WorkspaceMetadata,
  WorkspaceIntakePayload,
  WorkspaceResponse,
  WorkspaceGitState,
  WorkspaceStatus,
  ScriptCompleteEvent,
  ActivityResponse,
  CreateActivityPayload,
  WorkspaceDiffResponse,
  WorkspaceDiffSummaryResponse,
  CreateDiffPayload,
  ReviewResponse,
  CreateReviewPayload,
  UpdateReviewPayload,
  ReviewFindingResponse,
  CreateReviewFindingPayload,
  UpdateReviewFindingPayload,
} from "./workspace.dto";

// ─────────────────────────────────────────────────────────────
// Workspace directory presence
// ─────────────────────────────────────────────────────────────

/**
 * Whether a workspace's directory is still on disk.
 *
 * A workspace row outlives its directory: the user can delete, move, or unmount
 * it (or a worktree can be pruned) at any time, and we deliberately keep the row
 * — the directory may come back, and silently dropping it would lose the linked
 * runs and resources. So absence is a normal state to be reported, not an error,
 * and callers surface it instead of letting the filesystem fail later with a
 * bare ENOENT.
 */
export function workspacePathExists(rootPath: string): boolean {
  return existsSync(path.resolve(rootPath));
}

/**
 * Guard for anything that runs *inside* a workspace directory. Fails with the
 * path in the message, so the user sees which directory went missing rather
 * than an ENOENT raised somewhere deep in a provider adapter.
 */
export function assertWorkspacePathExists(
  rootPath: string,
  workspaceName?: string,
): void {
  if (workspacePathExists(rootPath)) return;
  const label = workspaceName ? `"${workspaceName}"` : "This workspace";
  throw new Error(
    `${label} points at a folder that no longer exists: ${rootPath}. ` +
      "Move it back, or delete the workspace.",
  );
}

// ─────────────────────────────────────────────────────────────
// Script execution helpers (used by workspace lifecycle hooks)
// ─────────────────────────────────────────────────────────────
function validateScriptCwd(cwd: string): void {
  const resolved = path.resolve(cwd);
  if (!existsSync(resolved)) {
    throw new Error(`Script cwd does not exist: ${resolved}`);
  }
}

function executeScript(
  script: string,
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  validateScriptCwd(cwd);

  const shell = process.platform === "win32" ? "cmd" : "/bin/sh";
  const shellArgs =
    process.platform === "win32" ? ["/c", script] : ["-c", script];

  return new Promise((resolve, reject) => {
    execFile(
      shell,
      shellArgs,
      { cwd, timeout: 300_000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          console.error(
            `[WorkspaceService] Script failed in ${cwd}:`,
            error.message,
          );
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

function emitScriptComplete(event: ScriptCompleteEvent): void {
  emit(CHANNELS.workspace.scriptComplete, event);
}

// ─────────────────────────────────────────────────────────────
// Cross-module writer surface
// ─────────────────────────────────────────────────────────────

/**
 * Fire-and-forget activity logger for cross-module writers (drivers,
 * run-session, guards, mains-tools). Never blocks or throws.
 */
export function logWorkspaceActivity(payload: CreateActivityPayload): void {
  workspaceRepo.insertActivity(payload).catch((err) => {
    console.error("[WorkspaceService] logWorkspaceActivity failed:", err);
  });
}

/**
 * Notifies renderers that findings have changed for a workspace so RTK Query
 * caches (ReviewFindings, WorkspaceActivity) can invalidate. Safe to call from
 * any main-process context that mutates findings outside the IPC mutation path.
 */
export function emitFindingsChanged(workspaceId: string | undefined): void {
  if (!workspaceId) return;
  emit(CHANNELS.workspace.findingsChanged, { workspaceId });
}

/**
 * Make `snapshot` the workspace's current diff row — the single writer for
 * diff rows, used by run-session, gitFlow's post-commit recapture, and
 * resyncDiff. Owns the filesJson/statsJson packing and the update-or-insert
 * decision: an existing row (matched by runId when given, else the
 * workspace's latest) is updated in place; otherwise the stale latest row is
 * dropped and a fresh one inserted.
 */
export async function recordWorkspaceDiff(
  workspaceId: string,
  runId: string | null,
  snapshot: DiffSnapshot,
): Promise<void> {
  const filesJson = JSON.stringify(snapshot.files);
  const statsJson = JSON.stringify({
    shortstat: snapshot.shortstat,
    files: snapshot.files.length,
    newFiles: snapshot.untrackedFiles.length,
  });
  // Kept as paths, not just the count in statsJson: the file list marks these
  // rows "U" (untracked) rather than "A", which the diff text can't tell apart.
  const untrackedJson = JSON.stringify(snapshot.untrackedFiles);
  const existing = runId
    ? await workspaceRepo.findDiffByRun(runId)
    : await workspaceRepo.findLatestDiffByWorkspace(workspaceId);
  if (existing) {
    await workspaceRepo.updateDiff(existing.id, {
      diffText: snapshot.diffText,
      filesJson,
      statsJson,
      untrackedJson,
      baseRef: snapshot.baseRef,
    });
  } else {
    await workspaceRepo.deleteLatestDiffByWorkspace(workspaceId);
    await workspaceRepo.insertDiff({
      id: randomUUID(),
      workspaceId,
      runId: runId ?? undefined,
      baseRef: snapshot.baseRef,
      diffText: snapshot.diffText,
      filesJson,
      statsJson,
      untrackedJson,
    });
  }
}

/** Drop the workspace's latest diff row. Returns true when a row existed. */
export async function clearWorkspaceDiff(workspaceId: string): Promise<boolean> {
  const latest = await workspaceRepo.findLatestDiffByWorkspace(workspaceId);
  if (!latest) return false;
  await workspaceRepo.deleteLatestDiffByWorkspace(workspaceId);
  return true;
}

// ─────────────────────────────────────────────────────────────
// Workspace intake helpers
//
// Shared internals of `workspaceService.createFromSource`. See CONTEXT.md
// "Workspace intake". Kept against `gitService` / `projectsRepo` (not
// `projectsService`) so the workspace → projects edge stays acyclic —
// projects.service imports the workspace barrel.
// ─────────────────────────────────────────────────────────────

/** Last path segment, e.g. `/a/b/my-repo` → `my-repo`. */
function basename(p: string): string {
  return p.split("/").pop() || "Untitled";
}

/** Honor the global worktree preference (off unless the user turned it on). */
async function preferWorktrees(): Promise<boolean> {
  const settings = await appSettingsService.ensureSettings();
  return settings.enableWorktrees ?? false;
}

/** Read the `origin` fetch URL of a repo, or null when there's no remote. */
async function readOriginUrl(rootPath: string): Promise<string | null> {
  try {
    const remotes = await gitService.getRemotes(rootPath);
    return remotes.find((r) => r.name === "origin")?.fetchUrl ?? null;
  } catch {
    return null;
  }
}

/** A project's worktree dir is the parent of its first worktree. */
function deriveWorkspacesPath(worktreePath: string): string {
  return worktreePath.substring(0, worktreePath.lastIndexOf("/"));
}

/**
 * Find-or-create a project, deduped by normalized remote origin (or by
 * rootPath when origin-less). Mirrors `projectsService.findOrCreate`, kept
 * here against `projectsRepo` to avoid a workspace ↔ projects service cycle.
 */
async function findOrCreateProject(
  payload: CreateProjectPayload,
): Promise<ProjectResponse> {
  const normalized = payload.remoteOrigin
    ? normalizeRemoteOrigin(payload.remoteOrigin)
    : null;

  const existing = normalized
    ? await projectsRepo.findByRemoteOrigin(payload.accountId, normalized)
    : await projectsRepo.findByAccountAndRootPath(
        payload.accountId,
        payload.rootPath,
      );
  if (existing) return existing;

  const id = randomUUID();
  await projectsRepo.insert({ ...payload, id, remoteOrigin: normalized });
  const project = await projectsRepo.findById(id);
  if (!project) throw new Error("Failed to retrieve created project");
  return project;
}

interface MetadataParts {
  tracking: string | null;
  ahead: number;
  behind: number;
  originUrl: string | null;
  worktree: { name: string; path: string; sourcePath: string } | null;
}

/**
 * Record the repo's current diff once, as the workspace's first diff row. An
 * imported folder can already carry uncommitted work, and without this its
 * Changes tab stays empty until the first run or a manual resync.
 *
 * Anchored at HEAD, like `resyncDiff` and the in-process commit tool — the
 * diff is "what isn't committed yet", not "what this branch adds".
 *
 * Best-effort on purpose: the workspace row is already written by the time
 * this runs, and a repo that can't be diffed (a fresh `init` with no HEAD, a
 * git failure) is still a repo worth keeping. Failures are logged, never
 * thrown — intake must not fail over its diff.
 */
async function captureInitialDiff(workspace: WorkspaceResponse): Promise<void> {
  try {
    const head = await gitService.getHeadSha(workspace.rootPath);
    const snapshot = await gitService.captureDiffSnapshot(
      workspace.rootPath,
      head,
    );
    // A clean tree gets no row at all — same as resyncDiff, so "no changes"
    // stays one state instead of an empty diff row plus a missing one.
    if (snapshot.files.length === 0) return;
    await recordWorkspaceDiff(workspace.id, null, snapshot);
  } catch (err) {
    console.warn(
      `[WorkspaceService] Initial diff capture failed for workspace ${workspace.id}:`,
      err,
    );
  }
}

/** Assemble the `WorkspaceMetadata` blob stored on the workspace row. */
function buildMetadata(parts: MetadataParts): WorkspaceMetadata {
  return {
    isGitRepo: true,
    tracking: parts.tracking,
    ahead: parts.ahead,
    behind: parts.behind,
    worktree: parts.worktree
      ? {
          enabled: true,
          name: parts.worktree.name,
          path: parts.worktree.path,
          sourcePath: parts.worktree.sourcePath,
        }
      : { enabled: false },
    origin: parts.originUrl ? { url: parts.originUrl } : undefined,
  };
}

// ─────────────────────────────────────────────────────────────
// Live git-state watchers
// ─────────────────────────────────────────────────────────────

interface GitStateWatcher {
  rootPath: string;
  branch: string | null;
  watcher: FSWatcher;
  refreshTimer?: ReturnType<typeof setTimeout>;
}

const gitStateWatchers = new Map<string, GitStateWatcher>();

function emitGitStateChanged(state: WorkspaceGitState): void {
  const existing = gitStateWatchers.get(state.workspaceId);
  if (existing) existing.branch = state.branch;
  emit(CHANNELS.workspace.gitStateChanged, state);
}

function removeGitStateWatcher(workspaceId: string): void {
  const entry = gitStateWatchers.get(workspaceId);
  if (!entry) return;
  if (entry.refreshTimer) clearTimeout(entry.refreshTimer);
  entry.watcher.close();
  gitStateWatchers.delete(workspaceId);
}

function scheduleGitStateRefresh(workspaceId: string): void {
  const entry = gitStateWatchers.get(workspaceId);
  if (!entry) return;
  if (entry.refreshTimer) clearTimeout(entry.refreshTimer);
  entry.refreshTimer = setTimeout(() => {
    const current = gitStateWatchers.get(workspaceId);
    if (!current) return;
    // Deletion is normally caught by the next listGitStates() sweep — fs.watch
    // errors out on a removed directory and the watcher is torn down, so this
    // path may never run again. Still report presence accurately for the
    // refreshes that do land.
    if (!workspacePathExists(current.rootPath)) {
      if (current.branch !== null) {
        emitGitStateChanged({ workspaceId, branch: null, pathExists: false });
      }
      return;
    }
    gitService
      .getCurrentBranch(current.rootPath)
      .then((branch) => {
        if (branch !== current.branch) {
          emitGitStateChanged({ workspaceId, branch, pathExists: true });
        }
      })
      .catch(() => {
        if (current.branch !== null) {
          emitGitStateChanged({ workspaceId, branch: null, pathExists: true });
        }
      });
  }, 75);
  entry.refreshTimer.unref?.();
}

async function ensureGitStateWatcher(
  workspace: WorkspaceResponse,
  branch: string | null,
): Promise<void> {
  const existing = gitStateWatchers.get(workspace.id);
  if (existing?.rootPath === workspace.rootPath) {
    existing.branch = branch;
    return;
  }
  if (existing) removeGitStateWatcher(workspace.id);

  try {
    const gitDirectory = await gitService.getGitDirectory(workspace.rootPath);
    const watcher = watch(
      gitDirectory,
      { persistent: false },
      (_eventType, filename) => {
        if (filename && filename.toString() !== "HEAD") return;
        scheduleGitStateRefresh(workspace.id);
      },
    );
    watcher.on("error", () => removeGitStateWatcher(workspace.id));
    gitStateWatchers.set(workspace.id, {
      rootPath: workspace.rootPath,
      branch,
      watcher,
    });
  } catch {
    // A missing/non-git workspace is represented by branch:null.
  }
}

async function syncGitStateWatchers(
  workspaces: WorkspaceResponse[],
  states: WorkspaceGitState[],
): Promise<void> {
  const activeIds = new Set(workspaces.map((workspace) => workspace.id));
  for (const workspaceId of gitStateWatchers.keys()) {
    if (!activeIds.has(workspaceId)) removeGitStateWatcher(workspaceId);
  }

  const branchByWorkspace = new Map(
    states.map((state) => [state.workspaceId, state.branch]),
  );
  await Promise.all(
    workspaces.map((workspace) =>
      ensureGitStateWatcher(
        workspace,
        branchByWorkspace.get(workspace.id) ?? null,
      ),
    ),
  );
}

// ─────────────────────────────────────────────────────────────
// Workspace aggregate service
//
// Throw-style: methods return plain values and throw on failure; the
// ServiceResponse envelope is applied by handle() at the IPC seam.
// Single-item reads return null for absence; mutations on a missing
// target throw (see CONTEXT.md "absence rule").
// ─────────────────────────────────────────────────────────────
export const workspaceService = {
  // ─────────────────────────────────────────────────────────────
  // ── Workspace lifecycle ──
  // ─────────────────────────────────────────────────────────────

  async list(includeArchived = false): Promise<WorkspaceResponse[]> {
    return workspaceRepo.findAll(includeArchived);
  },

  /**
   * The archived workspaces, enriched for Settings › Archive.
   *
   * Projects are read once and joined in memory rather than per row: the list
   * is small and every row would otherwise hit the same handful of projects.
   */
  async listArchived(): Promise<ArchivedWorkspaceResponse[]> {
    const archived = await workspaceRepo.findArchived();
    if (archived.length === 0) return [];

    // Archived workspaces can belong to archived projects, so include those —
    // otherwise the row loses its project name for no reason the user can see.
    const projects = await projectsRepo.findAll(true);
    const nameByProject = new Map(projects.map((p) => [p.id, p.name]));

    return archived.map((workspace) => {
      const worktree = workspace.metadata?.worktree;
      return {
        ...workspace,
        projectName: nameByProject.get(workspace.projectId) ?? null,
        pathExists: workspacePathExists(workspace.rootPath),
        worktree: worktree?.enabled ? worktree : null,
      };
    });
  },

  async get(id: string): Promise<WorkspaceResponse | null> {
    return workspaceRepo.findById(id);
  },

  async listByAccount(accountId: string): Promise<WorkspaceResponse[]> {
    return workspaceRepo.findByAccountId(accountId);
  },

  async getByRootPath(
    accountId: string,
    rootPath: string,
  ): Promise<WorkspaceResponse | null> {
    return workspaceRepo.findByRootPath(accountId, rootPath);
  },

  async listByProject(projectId: string): Promise<WorkspaceResponse[]> {
    return workspaceRepo.findByProjectId(projectId);
  },

  async listGitStates(): Promise<WorkspaceGitState[]> {
    const workspaces = await workspaceRepo.findAll();
    const states = await Promise.all(
      workspaces.map(async (workspace) => {
        // `branch: null` alone can't distinguish "not a git repo" from "the
        // folder is gone" — two states the UI has to treat very differently.
        // Skip the git call entirely when the directory is missing; it would
        // only fail with ENOENT.
        const pathExists = workspacePathExists(workspace.rootPath);
        return {
          workspaceId: workspace.id,
          pathExists,
          branch: pathExists
            ? await gitService.getCurrentBranch(workspace.rootPath).catch(() => null)
            : null,
        };
      }),
    );
    await syncGitStateWatchers(workspaces, states);
    return states;
  },

  stopGitStateWatchers(): void {
    for (const workspaceId of gitStateWatchers.keys()) {
      removeGitStateWatcher(workspaceId);
    }
  },

  async deleteByProject(projectId: string): Promise<void> {
    const workspaces = await workspaceRepo.findByProjectId(projectId);
    for (const workspace of workspaces) removeGitStateWatcher(workspace.id);
    await workspaceRepo.deleteByProjectId(projectId);
  },

  async deleteReviewsByWorkspace(workspaceId: string): Promise<void> {
    await workspaceRepo.deleteReviewsByWorkspace(workspaceId);
  },

  async create(
    payload: CreateWorkspacePayload,
  ): Promise<WorkspaceResponse> {
    if (!payload.projectId) {
      throw new Error("Workspace requires a Developer Project");
    }
    const project = await projectsRepo.findById(payload.projectId);
    if (!project) throw new Error("Project not found");
    if (project.accountId !== payload.accountId) {
      throw new Error("Project does not belong to this account");
    }
    const existing = await workspaceRepo.findByRootPath(
      payload.accountId,
      payload.rootPath,
    );
    if (existing) {
      throw new Error("Workspace with this path already exists");
    }

    const workspacePayload = {
      ...payload,
      id: payload.id || randomUUID(),
    };

    const id = await workspaceRepo.insert(workspacePayload);
    const workspace = await workspaceRepo.findById(id);
    if (!workspace) throw new Error("Failed to retrieve created workspace");

    // Fire-and-forget: run project setupScript in background
    if (project.setupScript) {
      const wsId = id;
      const rootPath = workspace.rootPath;
      Promise.resolve()
        .then(() => {
          console.log(
            `[WorkspaceService] Running setup script for workspace ${wsId} in ${rootPath}`,
          );
          executeScript(project.setupScript!, rootPath)
            .then(() => {
              console.log(
                `[WorkspaceService] Setup script completed for workspace ${wsId}`,
              );
              emitScriptComplete({
                workspaceId: wsId,
                script: "setup",
                success: true,
              });
            })
            .catch((err) => {
              console.error(
                `[WorkspaceService] Setup script failed for workspace ${wsId}:`,
                err,
              );
              emitScriptComplete({
                workspaceId: wsId,
                script: "setup",
                success: false,
                error: err?.message,
              });
            });
        })
        .catch(() => {});
    }

    return workspace;
  },

  /**
   * Turn a git repo into a project + workspace pair. The four sources
   * (picked `folder`, `clone` of a URL, fresh `init`, additional `worktree`
   * for an existing project) each yield a local repo path; the shared tail
   * imports it (worktree or direct), finds-or-creates the project, and
   * creates the workspace. The worktree-vs-direct ordering difference lives
   * here, not at call sites. See CONTEXT.md "Workspace intake".
   */
  async createFromSource(
    payload: WorkspaceIntakePayload,
  ): Promise<WorkspaceResponse> {
    const { accountId, source } = payload;

    // Every branch below ends here: write the row, then record the repo's
    // starting diff before the workspace reaches the renderer, so its first
    // Changes read already has one. `captureInitialDiff` swallows its own
    // failures — intake is done once `create` returns.
    const completeIntake = async (input: CreateWorkspacePayload) => {
      const workspace = await this.create(input);
      await captureInitialDiff(workspace);
      return workspace;
    };

    // ── init: brand-new empty repo. Always direct, no remote. ──
    if (source.kind === "init") {
      const init = await gitService.initRepo(source.name, source.parentPath);
      const project = await findOrCreateProject({
        accountId,
        name: source.name,
        rootPath: init.rootPath,
        defaultBranch: "main",
        branches: ["main"],
      });
      return completeIntake({
        accountId,
        name: source.name,
        rootPath: init.rootPath,
        baseBranch: "main",
        metadata: buildMetadata({
          tracking: null,
          ahead: 0,
          behind: 0,
          originUrl: null,
          worktree: null,
        }),
        projectId: project.id,
      });
    }

    // ── worktree: an additional worktree workspace for an existing project.
    // The project already exists, so find-or-create is a lookup. ──
    if (source.kind === "worktree") {
      const project = await projectsRepo.findById(source.projectId);
      if (!project) throw new Error("Project not found");
      const baseBranch =
        project.defaultBranch ??
        (await gitService.getDefaultBranch(project.rootPath));
      if (!project.defaultBranch) {
        await projectsRepo.update(project.id, { defaultBranch: baseBranch });
      }

      const imported = await gitService.importLocalRepo(
        project.rootPath,
        {
          projectName: project.name,
          baseBranch,
        },
      );
      if (!project.workspacesPath) {
        await projectsRepo.update(project.id, {
          workspacesPath: deriveWorkspacesPath(imported.worktreePath),
        });
      }
      return completeIntake({
        accountId,
        name: project.name,
        rootPath: imported.worktreePath,
        repoUrl: imported.originUrl ?? project.remoteOrigin ?? undefined,
        baseBranch,
        metadata: buildMetadata({
          tracking: imported.tracking,
          ahead: imported.ahead,
          behind: imported.behind,
          originUrl: imported.originUrl ?? project.remoteOrigin ?? null,
          worktree: {
            name: imported.worktreeName,
            path: imported.worktreePath,
            sourcePath: project.rootPath,
          },
        }),
        projectId: project.id,
      });
    }

    // ── folder / clone: obtain a local repo path, then import it. ──
    const sourcePath =
      source.kind === "clone"
        ? (await gitService.cloneRepo(source.url, source.targetPath))
            .clonedPath
        : source.path;
    // Seed name for a *new* project only. The workspace is named after the
    // project that find-or-create resolves to, so a second checkout of an
    // already-imported repo (a worktree folder, a sibling clone) shows the
    // project's name, not its folder's.
    const name = basename(sourcePath);

    // A picked folder can be anything — reject non-repos before any DB
    // write, or the worktree path below would leave an orphan project row
    // (it creates the project before the import can fail).
    if (source.kind === "folder" && !(await gitService.isGitRepo(sourcePath))) {
      throw new Error("Not a git repository");
    }

    if (await preferWorktrees()) {
      // Worktree lands under worktrees/{projectName}, so the project must
      // exist before the import — source origin/baseBranch up front.
      const originUrl = await readOriginUrl(sourcePath);
      const detectedDefaultBranch =
        await gitService.getDefaultBranch(sourcePath);
      const project = await findOrCreateProject({
        accountId,
        name,
        rootPath: sourcePath,
        remoteOrigin: originUrl ?? undefined,
        defaultBranch: detectedDefaultBranch,
      });
      const baseBranch = project.defaultBranch ?? detectedDefaultBranch;
      if (!project.defaultBranch) {
        await projectsRepo.update(project.id, { defaultBranch: baseBranch });
      }
      const imported = await gitService.importLocalRepo(
        sourcePath,
        {
          projectName: project.name,
          baseBranch,
        },
      );
      if (!project.workspacesPath) {
        await projectsRepo.update(project.id, {
          workspacesPath: deriveWorkspacesPath(imported.worktreePath),
        });
      }
      return completeIntake({
        accountId,
        name: project.name,
        rootPath: imported.worktreePath,
        repoUrl: originUrl ?? undefined,
        baseBranch,
        metadata: buildMetadata({
          tracking: imported.tracking,
          ahead: imported.ahead,
          behind: imported.behind,
          originUrl,
          worktree: {
            name: imported.worktreeName,
            path: imported.worktreePath,
            sourcePath,
          },
        }),
        projectId: project.id,
      });
    }

    // Direct: import in place, then create the project from the result.
    const imported = await gitService.importLocalRepoDirect(sourcePath);
    const project = await findOrCreateProject({
      accountId,
      name,
      rootPath: sourcePath,
      remoteOrigin: imported.originUrl ?? undefined,
      branches: [imported.branchName],
      defaultBranch: imported.baseBranch,
    });
    const baseBranch = project.defaultBranch ?? imported.baseBranch;
    if (!project.defaultBranch) {
      await projectsRepo.update(project.id, { defaultBranch: baseBranch });
    }
    return completeIntake({
      accountId,
      name: project.name,
      rootPath: sourcePath,
      repoUrl: imported.originUrl ?? undefined,
      baseBranch,
      metadata: buildMetadata({
        tracking: imported.tracking,
        ahead: imported.ahead,
        behind: imported.behind,
        originUrl: imported.originUrl,
        worktree: null,
      }),
        projectId: project.id,
      });
  },

  async update(
    id: string,
    payload: UpdateWorkspacePayload,
  ): Promise<WorkspaceResponse> {
    if (payload.projectId !== undefined) {
      const [workspace, project] = await Promise.all([
        workspaceRepo.findById(id),
        projectsRepo.findById(payload.projectId),
      ]);
      if (!workspace) throw new Error("Workspace not found");
      if (!project) throw new Error("Project not found");
      if (workspace.accountId !== project.accountId) {
        throw new Error("Project does not belong to this account");
      }
    }
    const updated = await workspaceRepo.update(id, payload);
    if (!updated) throw new Error("Workspace not found");
    return updated;
  },

  /**
   * Delete the workspace row, and optionally its worktree directory.
   *
   * The directory is only ever removed for a worktree — `git worktree remove`
   * on the path Mains created. A workspace that occupies the repo itself is
   * the user's own checkout, so `removeWorktree` is ignored there rather than
   * honoured against a directory we never made.
   *
   * The row goes regardless of what git does. A worktree whose directory was
   * already deleted by hand (or by a project's archiveScript) makes `git
   * worktree remove` fail, and refusing to delete the row over that would
   * leave the user with an entry they cannot get rid of by any route.
   */
  async delete(id: string, options?: DeleteWorkspaceOptions): Promise<void> {
    if (options?.removeWorktree) {
      const workspace = await workspaceRepo.findById(id);
      const worktree = workspace?.metadata?.worktree;
      if (worktree?.enabled) {
        try {
          await gitService.removeWorktree(worktree.sourcePath, worktree.path);
        } catch (err) {
          console.error(
            `[WorkspaceService] Failed to remove worktree at ${worktree.path}:`,
            err,
          );
        }
      }
    }

    removeGitStateWatcher(id);
    await workspaceRepo.delete(id);
  },

  async updateStatus(
    id: string,
    status: WorkspaceStatus,
  ): Promise<WorkspaceResponse> {
    return this.update(id, { status });
  },

  async archive(id: string): Promise<WorkspaceResponse> {
    const workspace = await workspaceRepo.findById(id);
    if (!workspace) throw new Error("Workspace not found");

    const archived = await workspaceRepo.archive(id);
    if (!archived) throw new Error("Failed to archive workspace");
    removeGitStateWatcher(id);

    // Fire-and-forget: run project archiveScript in background
    if (workspace.projectId) {
    const wsId = id;
    const rootPath = workspace.rootPath;
    projectsRepo
      .findById(workspace.projectId)
      .then((project) => {
        if (!project?.archiveScript) return;
        console.log(
          `[WorkspaceService] Running archive script for workspace ${wsId} in ${rootPath}`,
        );
        executeScript(project.archiveScript, rootPath)
          .then(() => {
            console.log(
              `[WorkspaceService] Archive script completed for workspace ${wsId}`,
            );
            emitScriptComplete({
              workspaceId: wsId,
              script: "archive",
              success: true,
            });
          })
          .catch((err) => {
            console.error(
              `[WorkspaceService] Archive script failed for workspace ${wsId}:`,
              err,
            );
            emitScriptComplete({
              workspaceId: wsId,
              script: "archive",
              success: false,
              error: err?.message,
            });
          });
      })
      .catch(() => {});
    }

    return archived;
  },

  /**
   * Put an archived workspace back into the active list.
   *
   * No script runs and nothing is touched on disk — archiving may have removed
   * the directory via a project's archiveScript, and re-running setup on the
   * user's behalf would be a side effect they never asked for. The row comes
   * back; if its directory is gone the workspace surfaces as missing, the same
   * state any deleted-by-hand workspace lands in. The git-state watcher is
   * re-established by the next `listGitStates` sync.
   */
  async unarchive(id: string): Promise<WorkspaceResponse> {
    const workspace = await workspaceRepo.findById(id);
    if (!workspace) throw new Error("Workspace not found");
    if (!(await projectsRepo.findById(workspace.projectId))) {
      throw new Error("Workspace project not found");
    }

    const unarchived = await workspaceRepo.unarchive(id);
    if (!unarchived) throw new Error("Failed to unarchive workspace");
    return unarchived;
  },

  // ─────────────────────────────────────────────────────────────
  // ── Git operations ──
  // Throw-style: these return plain values and throw on failure; the envelope
  // is applied by `handle()` at the IPC seam. See CONTEXT.md "Workspace git
  // operations".
  // ─────────────────────────────────────────────────────────────

  /**
   * Check out an existing branch in the workspace's own checkout.
   *
   * Unlike `renameBranch`, this never touches a worktree's source repo: the
   * point is to move *this* checkout, and git refuses on its own if the branch
   * is already checked out in another worktree.
   *
   * The diff is re-recorded afterwards because it was anchored to the old
   * branch's HEAD; leaving it would show the previous branch's changes against
   * the new one.
   */
  async switchBranch(workspaceId: string, branch: string): Promise<void> {
    const workspace = await workspaceRepo.findById(workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    if (!workspace.rootPath) throw new Error("Workspace has no root path");
    if (!branch.trim()) throw new Error("Branch name is required");

    await gitService.checkoutBranch(workspace.rootPath, branch);
    // Read back rather than assuming: a remote name resolves to its local
    // tracking branch, so what got checked out isn't always what was asked for.
    const current = await gitService
      .getCurrentBranch(workspace.rootPath)
      .catch(() => branch);
    emitGitStateChanged({ workspaceId, branch: current ?? branch, pathExists: true });
    await this.resyncDiff(workspaceId);
  },

  /**
   * Branch off the workspace's current HEAD and check the new branch out.
   *
   * The counterpart to `switchBranch` for a name that doesn't exist yet. It
   * needs no diff resync: `checkout -b` leaves HEAD on the same commit, so the
   * recorded diff still describes the same tree against the same base — only
   * the branch *name* changed, which is what the git-state event carries.
   *
   * Safe from a worktree too: the branch is created in the shared repo, and a
   * name nothing has checked out yet can't be checked out twice.
   *
   * The branch it forked off becomes the workspace's `baseBranch`: work started
   * from `dev` belongs back in `dev`, and that is exactly what `baseBranch`
   * means (see CONTEXT.md "Branch model"). Best-effort — a detached HEAD has no
   * name to record, and failing to store it must not undo a branch git already
   * created.
   */
  async createBranch(workspaceId: string, branch: string): Promise<void> {
    const workspace = await workspaceRepo.findById(workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    if (!workspace.rootPath) throw new Error("Workspace has no root path");
    if (!branch.trim()) throw new Error("Branch name is required");
    const name = branch.trim();

    // Read the parent before the checkout moves HEAD off it.
    const parent = await gitService
      .getCurrentBranch(workspace.rootPath)
      .catch(() => null);

    await gitService.createBranch(workspace.rootPath, name);
    emitGitStateChanged({ workspaceId, branch: name, pathExists: true });

    if (parent && parent !== "HEAD" && parent !== workspace.baseBranch) {
      await workspaceRepo
        .update(workspaceId, { baseBranch: parent })
        .catch((error) =>
          console.error("[Workspace] Failed to record PR base branch:", error),
        );
    }
  },

  /** Rename the branch actually checked out in the workspace. */
  async renameBranch(
    workspaceId: string,
    newBranchName: string,
  ): Promise<WorkspaceResponse> {
    const workspace = await workspaceRepo.findById(workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    if (!workspace.rootPath) {
      throw new Error("Workspace has no root path");
    }
    const oldBranch = await gitService.getCurrentBranch(workspace.rootPath);
    if (!oldBranch || oldBranch === "HEAD") {
      throw new Error("Workspace has no named branch to rename");
    }
    const project = workspace.projectId
      ? await projectsRepo.findById(workspace.projectId)
      : null;
    if (
      oldBranch === workspace.baseBranch ||
      oldBranch === project?.defaultBranch
    ) {
      throw new Error(
        `Cannot rename protected base/default branch "${oldBranch}" from a workspace`,
      );
    }

    // A worktree's branch is owned by its source repo, not the checkout.
    const worktree = workspace.metadata?.worktree;
    const gitPath =
      worktree?.enabled && worktree.sourcePath
        ? worktree.sourcePath
        : workspace.rootPath;
    await gitService.renameBranch(gitPath, oldBranch, newBranchName);
    emitGitStateChanged({ workspaceId, branch: newBranchName, pathExists: true });
    return workspace;
  },

  /**
   * Discard specific files back to their HEAD state, then re-record the diff so
   * every surface reading it agrees on what is left.
   *
   * Anchored to HEAD and driven by an explicit list, so it undoes exactly the
   * files a caller is showing — including ones that arrived outside any run,
   * where there is no recorded diff to reset to. (A whole-tree reset to a
   * recorded diff's baseRef used to live here as `discardChanges`; it went with
   * the diff summary bar, its only caller.)
   */
  async discardPaths(workspaceId: string, paths: string[]): Promise<void> {
    const workspace = await workspaceRepo.findById(workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    if (!workspace.rootPath) throw new Error("Workspace has no root path");
    if (paths.length === 0) return;
    await gitService.discardPaths(workspace.rootPath, paths);
    await this.resyncDiff(workspaceId);
  },

  // ─────────────────────────────────────────────────────────────
  // ── Activity ──
  // ─────────────────────────────────────────────────────────────

  async listActivity(
    workspaceId: string,
    limit?: number,
  ): Promise<ActivityResponse[]> {
    return workspaceRepo.findActivityByWorkspace(workspaceId, limit);
  },

  async createActivity(payload: CreateActivityPayload): Promise<string> {
    return workspaceRepo.insertActivity(payload);
  },

  async createManyActivity(
    payloads: CreateActivityPayload[],
  ): Promise<string[]> {
    return workspaceRepo.insertManyActivity(payloads);
  },

  async deleteActivity(id: string): Promise<void> {
    await workspaceRepo.deleteActivity(id);
  },

  // ─────────────────────────────────────────────────────────────
  // ── Diffs ──
  // ─────────────────────────────────────────────────────────────

  async listDiffs(
    workspaceId: string,
    limit?: number,
  ): Promise<WorkspaceDiffResponse[]> {
    return workspaceRepo.findDiffsByWorkspace(workspaceId, limit);
  },

  async getLatestDiff(
    workspaceId: string,
  ): Promise<WorkspaceDiffResponse | null> {
    return workspaceRepo.findLatestDiffByWorkspace(workspaceId);
  },

  async getLatestDiffSummary(
    workspaceId: string,
  ): Promise<WorkspaceDiffSummaryResponse | null> {
    return workspaceRepo.findLatestDiffSummaryByWorkspace(workspaceId);
  },

  async getDiffByRun(runId: string): Promise<WorkspaceDiffResponse | null> {
    return workspaceRepo.findDiffByRun(runId);
  },

  async deleteLatestDiff(workspaceId: string): Promise<void> {
    await workspaceRepo.deleteLatestDiffByWorkspace(workspaceId);
  },

  /** Wipe every diff row of a workspace (post-commit history reset). */
  async deleteDiffs(workspaceId: string): Promise<void> {
    await workspaceRepo.deleteDiffsByWorkspace(workspaceId);
  },

  async createDiff(payload: CreateDiffPayload): Promise<string> {
    return workspaceRepo.insertDiff(payload);
  },

  /**
   * Re-snapshot the workspace's working tree against its baseRef (or HEAD if
   * none has been captured yet) and reconcile the latest diff row:
   *   - clean tree → delete the latest row
   *   - dirty tree → update the latest row (or insert if none exists)
   *
   * Mirrors the snapshot logic in run-session.ts so the user can manually
   * pick up external git activity (commits made in another IDE, branch
   * switches) without starting a new run.
   *
   * Returns the resulting diff summary (or null when the tree is clean).
   */
  async resyncDiff(
    workspaceId: string,
  ): Promise<WorkspaceDiffSummaryResponse | null> {
    const workspace = await workspaceRepo.findById(workspaceId);
    if (!workspace) throw new Error("Workspace not found");

    const existing = await workspaceRepo.findLatestDiffByWorkspace(workspaceId);

    // Re-anchor to the current HEAD rather than the stored baseRef (captured
    // at run start). Otherwise work committed externally — e.g. via the CLI —
    // stays in the `baseRef..workingTree` range and keeps showing up even
    // though the tree is clean. This mirrors the in-process commit tool, which
    // advances baseRef to the post-commit HEAD (see mains-tools.core.ts).
    const head = await gitService
      .getHeadSha(workspace.rootPath)
      .catch(() => null);
    const baseRef = head ?? existing?.baseRef ?? null;

    // No baseRef means it's not a git repo (or git failed). Drop any stale
    // row defensively, then bail.
    if (!baseRef) {
      if (existing) {
        await workspaceRepo.deleteLatestDiffByWorkspace(workspaceId);
      }
      return null;
    }

    const snapshot = await gitService.captureDiffSnapshot(
      workspace.rootPath,
      baseRef,
    );

    if (snapshot.files.length === 0) {
      await clearWorkspaceDiff(workspaceId);
      return null;
    }

    await recordWorkspaceDiff(workspaceId, null, snapshot);

    return workspaceRepo.findLatestDiffSummaryByWorkspace(workspaceId);
  },

  // ─────────────────────────────────────────────────────────────
  // ── Reviews ──
  // ─────────────────────────────────────────────────────────────

  async listReviews(
    workspaceId: string,
    limit?: number,
  ): Promise<ReviewResponse[]> {
    return workspaceRepo.findReviewsByWorkspace(workspaceId, limit);
  },

  async getReview(id: string): Promise<ReviewResponse | null> {
    return workspaceRepo.findReviewById(id);
  },

  async createReview(payload: CreateReviewPayload): Promise<string> {
    return workspaceRepo.insertReview(payload);
  },

  async updateReview(
    id: string,
    payload: UpdateReviewPayload,
  ): Promise<ReviewResponse> {
    const updated = await workspaceRepo.updateReview(id, payload);
    if (!updated) throw new Error("Review not found");
    return updated;
  },

  async deleteReview(id: string): Promise<void> {
    await workspaceRepo.deleteReview(id);
  },

  // ─────────────────────────────────────────────────────────────
  // ── Findings ──
  // ─────────────────────────────────────────────────────────────

  async listFindings(
    reviewId: string,
    limit?: number,
  ): Promise<ReviewFindingResponse[]> {
    return workspaceRepo.findFindingsByReview(reviewId, limit);
  },

  /**
   * Returns findings for a workspace, deduped per file to only the most
   * recent review's findings. Filtering happens in JS for simplicity; revisit
   * if data volume grows.
   */
  async listFindingsByWorkspace(
    workspaceId: string,
  ): Promise<ReviewFindingResponse[]> {
    const allFindings =
    await workspaceRepo.findFindingsByWorkspace(workspaceId);

    const latestReviewByFile = new Map<string, string>();
    const latestTimeByFile = new Map<string, number>();

    for (const f of allFindings) {
      const ts =
        (f.reviewCreatedAt as unknown) instanceof Date
          ? f.reviewCreatedAt.getTime()
          : Number(f.reviewCreatedAt) * 1000;
      const existing = latestTimeByFile.get(f.file);
      if (existing === undefined || ts > existing) {
        latestTimeByFile.set(f.file, ts);
        latestReviewByFile.set(f.file, f.reviewId);
      }
    }

    return allFindings
      .filter((f) => latestReviewByFile.get(f.file) === f.reviewId)
      .map(({ reviewCreatedAt: _omit, ...rest }) => rest);
  },

  async getFinding(id: string): Promise<ReviewFindingResponse | null> {
    return workspaceRepo.findFindingById(id);
  },

  async createFinding(payload: CreateReviewFindingPayload): Promise<string> {
    return workspaceRepo.insertFinding(payload);
  },

  async createManyFindings(
    payloads: CreateReviewFindingPayload[],
  ): Promise<string[]> {
    return workspaceRepo.insertManyFindings(payloads);
  },

  async updateFinding(
    id: string,
    payload: UpdateReviewFindingPayload,
  ): Promise<ReviewFindingResponse> {
    const updated = await workspaceRepo.updateFinding(id, payload);
    if (!updated) throw new Error("Review finding not found");
    return updated;
  },

  async deleteFinding(id: string): Promise<void> {
    await workspaceRepo.deleteFinding(id);
  },

  /** Drop every finding of a workspace (committed code is accepted). */
  async deleteFindingsByWorkspace(workspaceId: string): Promise<void> {
    await workspaceRepo.deleteFindingsByWorkspace(workspaceId);
  },
};
