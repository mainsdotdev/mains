import { randomUUID } from "crypto";
import * as fs from "fs";
import { projectsRepo } from "./projects.repo";
import { LINKABLE_KINDS, normalizeRemoteOrigin } from "./projects.utils";
import { workspaceService } from "../workspace";
import { gitService } from "../git";
import { getIssuesByResourceIds } from "../entities";
import type {
  AvailableResource,
  CreateProjectPayload,
  ProjectResource,
  ProjectResourceWithDetails,
  ProjectResponse,
  UpdateProjectPayload,
} from "./projects.dto";

// ─────────────────────────────────────────────────────────────
// Projects Service
//
// Throw-style: methods return plain values and throw on failure; the
// ServiceResponse envelope is applied by handle() at the IPC seam.
// Single-item reads return null for absence; mutations on a missing
// target throw (see CONTEXT.md "absence rule").
// ─────────────────────────────────────────────────────────────
export const projectsService = {
  // ─────────────────────────────────────────────────────────────
  // Project lifecycle
  // ─────────────────────────────────────────────────────────────
  async list(includeArchived = false): Promise<ProjectResponse[]> {
    return projectsRepo.findAll(includeArchived);
  },

  async get(id: string): Promise<ProjectResponse | null> {
    return projectsRepo.findById(id);
  },

  async listByAccount(accountId: string): Promise<ProjectResponse[]> {
    return projectsRepo.findByAccountId(accountId);
  },

  async findByRemoteOrigin(
    accountId: string,
    remoteOrigin: string,
  ): Promise<ProjectResponse | null> {
    const normalized = normalizeRemoteOrigin(remoteOrigin);
    return projectsRepo.findByRemoteOrigin(accountId, normalized);
  },

  async findOrCreate(payload: CreateProjectPayload): Promise<ProjectResponse> {
    const normalized = payload.remoteOrigin
      ? normalizeRemoteOrigin(payload.remoteOrigin)
      : null;

    const existing = normalized
      ? await projectsRepo.findByRemoteOrigin(payload.accountId, normalized)
      : await projectsRepo.findByAccountAndRootPath(
          payload.accountId,
          payload.rootPath,
        );
    if (existing) {
      return existing;
    }

    const id = payload.id || randomUUID();
    await projectsRepo.insert({
      ...payload,
      id,
      remoteOrigin: normalized,
    });

    const project = await projectsRepo.findById(id);
    if (!project) {
      throw new Error("Failed to retrieve created project");
    }
    return project;
  },

  async create(payload: CreateProjectPayload): Promise<ProjectResponse> {
    const normalized = payload.remoteOrigin
      ? normalizeRemoteOrigin(payload.remoteOrigin)
      : null;

    const existing = normalized
      ? await projectsRepo.findByRemoteOrigin(payload.accountId, normalized)
      : await projectsRepo.findByAccountAndRootPath(
          payload.accountId,
          payload.rootPath,
        );
    if (existing) {
      throw new Error(
        normalized
          ? "Project with this remote origin already exists"
          : "Project at this path already exists",
      );
    }

    const id = payload.id || randomUUID();
    await projectsRepo.insert({
      ...payload,
      id,
      remoteOrigin: normalized,
    });

    const project = await projectsRepo.findById(id);
    if (!project) {
      throw new Error("Failed to retrieve created project");
    }
    return project;
  },

  async update(
    id: string,
    payload: UpdateProjectPayload,
  ): Promise<ProjectResponse> {
    const updated = await projectsRepo.update(id, payload);
    if (!updated) {
      throw new Error("Project not found");
    }
    return updated;
  },

  async remove(id: string): Promise<void> {
    const project = await projectsRepo.findById(id);
    if (!project) {
      throw new Error("Project not found");
    }

    const projectWorkspaces = await workspaceService.listByProject(id);

    for (const ws of projectWorkspaces) {
      if (
        project.workspacesPath &&
        ws.rootPath.startsWith(project.workspacesPath)
      ) {
        try {
          await gitService.removeWorktree(project.rootPath, ws.rootPath);
        } catch {
          if (fs.existsSync(ws.rootPath)) {
            fs.rmSync(ws.rootPath, { recursive: true, force: true });
          }
        }
      }
    }

    if (project.workspacesPath && fs.existsSync(project.workspacesPath)) {
      try {
        const remaining = fs.readdirSync(project.workspacesPath);
        if (remaining.length === 0) {
          fs.rmSync(project.workspacesPath, { recursive: true, force: true });
        }
      } catch {
        // Ignore cleanup errors
      }
    }

    // Lazy: breaks the projects → runs → providers/adapters → gitFlow →
    // projects require cycle.
    const { runsService } = await import("../runs/runs.service");
    for (const ws of projectWorkspaces) {
      await runsService.deleteRunsByWorkspace(ws.id);
      await workspaceService.deleteReviewsByWorkspace(ws.id);
    }

    await workspaceService.deleteByProject(id);
    await projectsRepo.delete(id);
  },

  async delete(id: string): Promise<void> {
    await this.remove(id);
  },

  /**
   * Live branch names of the project's repo (local + remote, deduped with
   * `remotes/…` prefixes stripped).
   */
  async listBranchNames(id: string): Promise<string[]> {
    const project = await projectsRepo.findById(id);
    if (!project) throw new Error("Project not found");
    const { all } = await gitService.getBranches(project.rootPath);
    const seen = new Set<string>();
    const names: string[] = [];
    for (const raw of all) {
      const name = raw.replace(/^remotes\/[^/]+\//, "");
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
    return names;
  },

  async archive(id: string): Promise<ProjectResponse> {
    const archived = await projectsRepo.archive(id);
    if (!archived) {
      throw new Error("Project not found");
    }
    return archived;
  },

  // ─────────────────────────────────────────────────────────────
  // Project resources (formerly workspaceResources/)
  // ─────────────────────────────────────────────────────────────
  async listResources(
    projectId: string,
  ): Promise<{ resources: ProjectResourceWithDetails[] }> {
    if (!projectId) {
      throw new Error("projectId is required");
    }
    const resources = await projectsRepo.listResourcesByProject(projectId);
    return { resources };
  },

  async listAvailableResources(
    projectId: string,
  ): Promise<{ resources: AvailableResource[] }> {
    if (!projectId) {
      throw new Error("projectId is required");
    }
    const resources = await projectsRepo.listAvailableResources(
      projectId,
      LINKABLE_KINDS,
    );
    return { resources };
  },

  async addResource(
    projectId: string,
    resourceId: string,
  ): Promise<{ resource: ProjectResource }> {
    if (!projectId || !resourceId) {
      throw new Error("projectId and resourceId are required");
    }

    const linked = await projectsRepo.isResourceLinked(projectId, resourceId);
    if (linked) {
      throw new Error("Resource is already linked to this project");
    }

    const id = randomUUID();
    const resource = await projectsRepo.addResource(id, projectId, resourceId);
    return { resource };
  },

  async removeResource(projectId: string, resourceId: string): Promise<void> {
    if (!projectId || !resourceId) {
      throw new Error("projectId and resourceId are required");
    }
    await projectsRepo.removeResource(projectId, resourceId);
  },

  // Cross-aggregate query: stitch projects ⨯ entities at the service layer.
  // The repo never touches the entities/issues schema — callers cross the
  // seam via `getIssuesByResourceIds` on the entities barrel.
  async listIssues(projectId: string): Promise<{ issues: unknown[] }> {
    if (!projectId) {
      throw new Error("projectId is required");
    }
    const resourceIds = await projectsRepo.listLinkedResourceIds(projectId);
    if (resourceIds.length === 0) {
      return { issues: [] };
    }
    const rows = await getIssuesByResourceIds(resourceIds);
    const serialized = rows.map((item) => ({
      issue: item.issue,
      entity: {
        ...item.entity,
        occurredAt:
          item.entity.occurredAt instanceof Date
            ? item.entity.occurredAt.toISOString()
            : item.entity.occurredAt,
        createdAt:
          item.entity.createdAt instanceof Date
            ? item.entity.createdAt.toISOString()
            : item.entity.createdAt,
        updatedAt:
          item.entity.updatedAt instanceof Date
            ? item.entity.updatedAt.toISOString()
            : item.entity.updatedAt,
      },
    }));
    return { issues: serialized };
  },
};
