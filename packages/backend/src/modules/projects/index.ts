export { registerProjectsIpc, unregisterProjectsIpc } from "./projects.ipc";
export { projectsService } from "./projects.service";
export { LINKABLE_KINDS, normalizeRemoteOrigin } from "./projects.utils";
export type {
  AddResourcePayload,
  AvailableResource,
  CreateProjectPayload,
  ProjectResource,
  ProjectResourceWithDetails,
  ProjectResponse,
  RemoveResourcePayload,
  UpdateProjectPayload,
} from "./projects.dto";
