import { baseApi } from "./baseApi";
import { CHANNELS } from "../../../../shared/ipc-kit/channels";
import type { IssueWithEntity } from "./entitiesApi";

export interface Project {
  id: string;
  accountId: string;
  name: string;
  rootPath: string;
  workspacesPath: string | null;
  branches: string[] | null;
  remoteOrigin: string | null;
  defaultBranch: string | null;
  setupScript: string | null;
  runScript: string | null;
  archiveScript: string | null;
  icon: string | null;
  commitInstructions: string | null;
  prInstructions: string | null;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProjectPayload {
  id?: string;
  accountId: string;
  name: string;
  rootPath: string;
  remoteOrigin?: string | null;
  workspacesPath?: string;
  branches?: string[];
  defaultBranch?: string;
  setupScript?: string;
  runScript?: string;
  archiveScript?: string;
  icon?: string;
  commitInstructions?: string;
  prInstructions?: string;
}

export interface UpdateProjectPayload {
  name?: string;
  rootPath?: string;
  workspacesPath?: string;
  branches?: string[];
  remoteOrigin?: string | null;
  defaultBranch?: string;
  setupScript?: string;
  runScript?: string;
  archiveScript?: string;
  icon?: string | null;
  commitInstructions?: string;
  prInstructions?: string;
}

// ─────────────────────────────────────────────────────────────
// Project resources (formerly workspaceResourcesApi)
// ─────────────────────────────────────────────────────────────

export interface ProjectResource {
  id: string;
  projectId: string;
  resourceId: string;
  createdAt: string;
}

export interface ProjectResourceWithDetails extends ProjectResource {
  resource: {
    id: string;
    connectionId: string;
    externalId: string;
    kind: string;
    name: string | null;
    url: string | null;
    metadata: string | null;
  };
}

export interface AvailableResource {
  id: string;
  connectionId: string;
  externalId: string;
  kind: string;
  name: string | null;
  url: string | null;
  metadata: string | null;
  isLinked: boolean;
}

export type ProjectIssue = IssueWithEntity;

export const projectsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    // ── lifecycle ──
    listProjects: builder.query<Project[], void>({
      query: () => ({
        handler: CHANNELS.projects.list,
      }),
      providesTags: ["Projects"],
    }),

    // Absence rule: a missing project arrives as null data, not an error.
    getProject: builder.query<Project | null, string>({
      query: (id) => ({
        handler: CHANNELS.projects.get,
        args: [id],
      }),
      providesTags: (_result, _error, id) => [{ type: "Projects", id }],
    }),

    // Live branch names of the project's repo (local + remote, deduped).
    listProjectBranches: builder.query<string[], string>({
      query: (id) => ({
        handler: CHANNELS.projects.listBranches,
        args: [id],
      }),
      providesTags: (_result, _error, id) => [{ type: "Projects", id }],
    }),

    listProjectsByAccount: builder.query<Project[], string>({
      query: (accountId) => ({
        handler: CHANNELS.projects.listByAccount,
        args: [accountId],
      }),
      providesTags: ["Projects"],
    }),

    findProjectByRemoteOrigin: builder.query<
      Project | null,
      { accountId: string; remoteOrigin: string }
    >({
      query: ({ accountId, remoteOrigin }) => ({
        handler: CHANNELS.projects.findByRemoteOrigin,
        args: [accountId, remoteOrigin],
      }),
      providesTags: ["Projects"],
    }),

    findOrCreateProject: builder.mutation<Project, CreateProjectPayload>({
      query: (payload) => ({
        handler: CHANNELS.projects.findOrCreate,
        args: [payload],
      }),
      invalidatesTags: ["Projects"],
    }),

    createProject: builder.mutation<Project, CreateProjectPayload>({
      query: (payload) => ({
        handler: CHANNELS.projects.create,
        args: [payload],
      }),
      invalidatesTags: ["Projects"],
    }),

    updateProject: builder.mutation<
      Project,
      { id: string; payload: UpdateProjectPayload }
    >({
      query: ({ id, payload }) => ({
        handler: CHANNELS.projects.update,
        args: [id, payload],
      }),
      invalidatesTags: (_result, _error, { id }) => [
        "Projects",
        { type: "Projects", id },
      ],
    }),

    removeProject: builder.mutation<void, string>({
      query: (id) => ({
        handler: CHANNELS.projects.remove,
        args: [id],
      }),
      invalidatesTags: ["Projects", "Workspaces"],
    }),

    deleteProject: builder.mutation<void, string>({
      query: (id) => ({
        handler: CHANNELS.projects.delete,
        args: [id],
      }),
      invalidatesTags: ["Projects"],
    }),

    archiveProject: builder.mutation<Project, string>({
      query: (id) => ({
        handler: CHANNELS.projects.archive,
        args: [id],
      }),
      invalidatesTags: (_result, _error, id) => [
        "Projects",
        { type: "Projects", id },
      ],
    }),

    // ── resources ──
    listProjectResources: builder.query<ProjectResourceWithDetails[], string>({
      query: (projectId) => ({
        handler: CHANNELS.projects.listResources,
        args: [projectId],
      }),
      transformResponse: (response: { resources: ProjectResourceWithDetails[] }) =>
        response.resources,
      providesTags: (_result, _error, projectId) => [
        { type: "ProjectResources", id: projectId },
      ],
    }),

    listAvailableResources: builder.query<AvailableResource[], string>({
      query: (projectId) => ({
        handler: CHANNELS.projects.listAvailableResources,
        args: [projectId],
      }),
      transformResponse: (response: { resources: AvailableResource[] }) =>
        response.resources,
      providesTags: ["ProjectResources"],
    }),

    addProjectResource: builder.mutation<
      { resource: ProjectResource },
      { projectId: string; resourceId: string }
    >({
      query: (payload) => ({
        handler: CHANNELS.projects.addResource,
        args: [payload],
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: "ProjectResources", id: projectId },
        { type: "ProjectIssues", id: projectId },
      ],
    }),

    removeProjectResource: builder.mutation<
      void,
      { projectId: string; resourceId: string }
    >({
      query: (payload) => ({
        handler: CHANNELS.projects.removeResource,
        args: [payload],
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: "ProjectResources", id: projectId },
        { type: "ProjectIssues", id: projectId },
      ],
    }),

    // ── issues (via linked resources) ──
    listProjectIssues: builder.query<ProjectIssue[], string>({
      query: (projectId) => ({
        handler: CHANNELS.projects.listIssues,
        args: [projectId],
      }),
      transformResponse: (response: { issues: ProjectIssue[] }) =>
        response.issues,
      providesTags: (_result, _error, projectId) => [
        { type: "ProjectIssues", id: projectId },
      ],
    }),
  }),
});

export const {
  // lifecycle
  useListProjectsQuery,
  useLazyListProjectsQuery,
  useGetProjectQuery,
  useLazyGetProjectQuery,
  useListProjectBranchesQuery,
  useListProjectsByAccountQuery,
  useLazyListProjectsByAccountQuery,
  useFindProjectByRemoteOriginQuery,
  useLazyFindProjectByRemoteOriginQuery,
  useFindOrCreateProjectMutation,
  useCreateProjectMutation,
  useUpdateProjectMutation,
  useRemoveProjectMutation,
  useDeleteProjectMutation,
  useArchiveProjectMutation,
  // resources
  useListProjectResourcesQuery,
  useListAvailableResourcesQuery,
  useLazyListAvailableResourcesQuery,
  useAddProjectResourceMutation,
  useRemoveProjectResourceMutation,
  // issues
  useListProjectIssuesQuery,
} = projectsApi;
