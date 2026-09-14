import { ipcMain } from "../../ipc-kit/ipc-main";
import { handle } from "../../ipc-kit/handle";
import { projectsService } from "./projects.service";
import type {
  AddResourcePayload,
  CreateProjectPayload,
  RemoveResourcePayload,
  UpdateProjectPayload,
} from "./projects.dto";
import { CHANNELS } from "../../../shared/ipc-kit/channels";

// ─────────────────────────────────────────────────────────────
// Projects IPC Handlers
// ─────────────────────────────────────────────────────────────
export function registerProjectsIpc(): void {
  // ── lifecycle ──
  ipcMain.handle(
    CHANNELS.projects.list,
    handle(() => projectsService.list()),
  );

  ipcMain.handle(
    CHANNELS.projects.get,
    handle((id: string) => projectsService.get(id)),
  );

  ipcMain.handle(
    CHANNELS.projects.listByAccount,
    handle((accountId: string) => projectsService.listByAccount(accountId)),
  );

  ipcMain.handle(
    CHANNELS.projects.findByRemoteOrigin,
    handle((accountId: string, remoteOrigin: string) => projectsService.findByRemoteOrigin(accountId, remoteOrigin)),
  );

  ipcMain.handle(
    CHANNELS.projects.findOrCreate,
    handle((payload: CreateProjectPayload) => projectsService.findOrCreate(payload)),
  );

  ipcMain.handle(
    CHANNELS.projects.create,
    handle((payload: CreateProjectPayload) => projectsService.create(payload)),
  );

  ipcMain.handle(
    CHANNELS.projects.update,
    handle((id: string, payload: UpdateProjectPayload) => projectsService.update(id, payload)),
  );

  ipcMain.handle(
    CHANNELS.projects.remove,
    handle((id: string) => projectsService.remove(id)),
  );

  ipcMain.handle(
    CHANNELS.projects.delete,
    handle((id: string) => projectsService.delete(id)),
  );

  ipcMain.handle(
    CHANNELS.projects.listBranches,
    handle((id: string) => projectsService.listBranchNames(id)),
  );

  ipcMain.handle(
    CHANNELS.projects.archive,
    handle((id: string) => projectsService.archive(id)),
  );

  // ── resources ──
  ipcMain.handle(
    CHANNELS.projects.listResources,
    handle((projectId: string) => projectsService.listResources(projectId)),
  );

  ipcMain.handle(
    CHANNELS.projects.listAvailableResources,
    handle((projectId: string) => projectsService.listAvailableResources(projectId)),
  );

  ipcMain.handle(
    CHANNELS.projects.addResource,
    handle((payload: AddResourcePayload) => projectsService.addResource(payload.projectId, payload.resourceId)),
  );

  ipcMain.handle(
    CHANNELS.projects.removeResource,
    handle((payload: RemoveResourcePayload) => projectsService.removeResource(payload.projectId, payload.resourceId)),
  );

  // ── issues (via linked resources) ──
  ipcMain.handle(
    CHANNELS.projects.listIssues,
    handle((projectId: string) => projectsService.listIssues(projectId)),
  );
}

export function unregisterProjectsIpc(): void {
  [
    CHANNELS.projects.list,
    CHANNELS.projects.get,
    CHANNELS.projects.listByAccount,
    CHANNELS.projects.findByRemoteOrigin,
    CHANNELS.projects.findOrCreate,
    CHANNELS.projects.create,
    CHANNELS.projects.update,
    CHANNELS.projects.remove,
    CHANNELS.projects.delete,
    CHANNELS.projects.listBranches,
    CHANNELS.projects.archive,
    CHANNELS.projects.listResources,
    CHANNELS.projects.listAvailableResources,
    CHANNELS.projects.addResource,
    CHANNELS.projects.removeResource,
    CHANNELS.projects.listIssues,
  ].forEach((channel) => ipcMain.removeHandler(channel));
}
