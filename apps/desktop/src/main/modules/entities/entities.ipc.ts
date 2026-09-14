import { ipcMain } from "../../ipc-kit/ipc-main";
import { handle } from "../../ipc-kit/handle";
import { entitiesService } from "./entities.service";
import { CHANNELS } from "../../../shared/ipc-kit/channels";
import type {
  CreateEntityPayload,
  UpdateEntityPayload,
  CreateTaskPayload,
  UpdateTaskPayload,
  CreateIssuePayload,
  UpdateIssuePayload,
  CreateSignalPayload,
  UpdateSignalPayload,
  EntityQueryOptions,
  TaskQueryOptions,
  IssueQueryOptions,
  SignalQueryOptions,
  SearchOptions,
} from "./entities.dto";

// ─────────────────────────────────────────────────────────────
// IPC Channel Constants
// ─────────────────────────────────────────────────────────────
// Register Handlers
// ─────────────────────────────────────────────────────────────
export function registerEntitiesHandlers(): void {
  // Entity handlers
  ipcMain.handle(
    CHANNELS.entities.getAll,
    handle((options: EntityQueryOptions = {}) => entitiesService.getAll(options)),
  );

  ipcMain.handle(
    CHANNELS.entities.getById,
    handle((id: string) => entitiesService.getById(id)),
  );

  ipcMain.handle(
    CHANNELS.entities.create,
    handle((payload: CreateEntityPayload) => entitiesService.create(payload)),
  );

  ipcMain.handle(
    CHANNELS.entities.update,
    handle((id: string, payload: UpdateEntityPayload) => entitiesService.update(id, payload)),
  );

  ipcMain.handle(
    CHANNELS.entities.delete,
    handle((id: string) => entitiesService.delete(id)),
  );

  ipcMain.handle(
    CHANNELS.entities.search,
    handle((query: string, options: SearchOptions = {}) => entitiesService.search(query, options)),
  );

  // Task handlers
  ipcMain.handle(
    CHANNELS.tasks.getAll,
    handle((options: TaskQueryOptions = {}) => entitiesService.getAllTasks(options)),
  );

  ipcMain.handle(
    CHANNELS.tasks.getById,
    handle((entityId: string) => entitiesService.getTaskById(entityId)),
  );

  ipcMain.handle(
    CHANNELS.tasks.create,
    handle((payload: CreateTaskPayload) => entitiesService.createTask(payload)),
  );

  ipcMain.handle(
    CHANNELS.tasks.update,
    handle((entityId: string, payload: UpdateTaskPayload) => entitiesService.updateTask(entityId, payload)),
  );

  ipcMain.handle(
    CHANNELS.tasks.delete,
    handle((entityId: string) => entitiesService.deleteTask(entityId)),
  );

  // Issue handlers
  ipcMain.handle(
    CHANNELS.issues.getAll,
    handle((options: IssueQueryOptions = {}) => entitiesService.getAllIssues(options)),
  );

  ipcMain.handle(
    CHANNELS.issues.getById,
    handle((entityId: string) => entitiesService.getIssueById(entityId)),
  );

  ipcMain.handle(
    CHANNELS.issues.getDetail,
    handle((entityId: string) => entitiesService.getIssueDetail(entityId)),
  );

  ipcMain.handle(
    CHANNELS.issues.create,
    handle((payload: CreateIssuePayload) => entitiesService.createIssue(payload)),
  );

  ipcMain.handle(
    CHANNELS.issues.update,
    handle((entityId: string, payload: UpdateIssuePayload) => entitiesService.updateIssue(entityId, payload)),
  );

  ipcMain.handle(
    CHANNELS.issues.delete,
    handle((entityId: string) => entitiesService.deleteIssue(entityId)),
  );

  // Signal handlers
  ipcMain.handle(
    CHANNELS.signals.getAll,
    handle((options: SignalQueryOptions = {}) => entitiesService.getAllSignals(options)),
  );

  ipcMain.handle(
    CHANNELS.signals.getById,
    handle((entityId: string) => entitiesService.getSignalById(entityId)),
  );

  ipcMain.handle(
    CHANNELS.signals.create,
    handle((payload: CreateSignalPayload) => entitiesService.createSignal(payload)),
  );

  ipcMain.handle(
    CHANNELS.signals.update,
    handle((entityId: string, payload: UpdateSignalPayload) => entitiesService.updateSignal(entityId, payload)),
  );

  ipcMain.handle(
    CHANNELS.signals.delete,
    handle((entityId: string) => entitiesService.deleteSignal(entityId)),
  );

}

// ─────────────────────────────────────────────────────────────
// Unregister Handlers
// ─────────────────────────────────────────────────────────────
export function unregisterEntitiesHandlers(): void {
  [
    CHANNELS.entities.getAll,
    CHANNELS.entities.getById,
    CHANNELS.entities.create,
    CHANNELS.entities.update,
    CHANNELS.entities.delete,
    CHANNELS.entities.search,
    CHANNELS.tasks.getAll,
    CHANNELS.tasks.getById,
    CHANNELS.tasks.create,
    CHANNELS.tasks.update,
    CHANNELS.tasks.delete,
    CHANNELS.issues.getAll,
    CHANNELS.issues.getById,
    CHANNELS.issues.getDetail,
    CHANNELS.issues.create,
    CHANNELS.issues.update,
    CHANNELS.issues.delete,
    CHANNELS.signals.getAll,
    CHANNELS.signals.getById,
    CHANNELS.signals.create,
    CHANNELS.signals.update,
    CHANNELS.signals.delete,
  ].forEach((channel) => ipcMain.removeHandler(channel));
  console.log("Entities IPC handlers unregistered");
}
