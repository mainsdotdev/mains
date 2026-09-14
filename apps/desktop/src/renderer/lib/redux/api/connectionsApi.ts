import { baseApi } from './baseApi';
import { CHANNELS } from "../../../../shared/ipc-kit/channels";
import { syncApi } from './syncApi';
import { toast } from '@/components/ui';

// ─────────────────────────────────────────────────────────────
// Connection identity + integration state
// ─────────────────────────────────────────────────────────────

/** A row in the connections table — one external account. */
export interface Connection {
  id: string;
  provider: string;
  status: string;
  metadata?: any;
}

/** A row in the connection_states table — one supported integration shown on the Settings page. */
export interface ConnectionState {
  id: string;
  displayName: string;
  iconPath: string;
  isConnected: boolean;
  connectionId: string | null;
  category: string;
  sortOrder: number;
  enabledFeatures: string | null;
  config: string | null;
}

export interface UpdateConnectionStatePayload {
  isConnected: boolean;
  connectionId?: string | null;
}

// ─────────────────────────────────────────────────────────────
// Resource types per provider
// ─────────────────────────────────────────────────────────────

export interface GitHubRepo {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  private: boolean;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  defaultBranch: string;
  htmlUrl: string;
  updatedAt: string;
}

export interface SelectedRepo {
  id: string;
  fullName: string;
  name: string;
  metadata: any;
}

// Mirrors src/main/modules/connections/github-device-flow.ts
export interface GitHubDeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Seconds until the user code expires. */
  expiresIn: number;
  /** Minimum seconds between polls. */
  interval: number;
}

export type GitHubDevicePollResult =
  | { status: "pending" }
  | { status: "slow_down"; interval: number }
  | { status: "expired" }
  | { status: "denied" }
  | { status: "success"; token: string };

export interface LinearTeam {
  id: string;
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  issueCount: number;
}

export interface SelectedTeam {
  id: string;
  key: string;
  name: string;
  metadata: any;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string;
  avatarUrl: string | null;
}

export interface AsanaProject {
  gid: string;
  name: string;
  archived: boolean;
  color: string | null;
  workspaceGid: string;
  workspaceName: string;
  teamGid?: string | null;
  teamName?: string | null;
}

export interface SelectedAsanaProject {
  id: string;
  gid: string;
  name: string;
  metadata: any;
}

export interface SelectedProject {
  id: string;
  key: string;
  name: string;
  metadata: any;
}

export interface GitLabProject {
  id: number;
  name: string;
  pathWithNamespace: string;
  webUrl: string;
  description: string | null;
  visibility: string;
  lastActivityAt: string | null;
}

export interface SelectedGitLabProject {
  id: string;
  externalId: string;
  name: string;
  metadata: any;
}

export interface TrelloBoard {
  id: string;
  name: string;
  shortLink: string;
  shortUrl: string;
  desc: string;
  closed: boolean;
  organizationName?: string | null;
}

export interface SelectedTrelloBoard {
  id: string;
  boardId: string;
  name: string;
  metadata: any;
}

export interface SentryProject {
  id: string;
  slug: string;
  name: string;
  platform: string | null;
  dateCreated: string;
  status: string;
  organization: string;
}

export interface SelectedSentryProject {
  id: string;
  slug: string;
  name: string;
  metadata: any;
}

export interface SocketDevOrganization {
  id: string;
  slug: string;
  name: string;
  plan: string | null;
}

export interface SelectedSocketDevOrganization {
  id: string;
  slug: string;
  name: string;
  metadata: any;
}

// ─────────────────────────────────────────────────────────────
// Payload types
// ─────────────────────────────────────────────────────────────

export interface SaveCredentialsPayload {
  provider: string;
  connectionId: string;
  token?: string;
  apiKey?: string;
  userId?: string;
  developerToken?: string;
  userToken?: string;
  accessToken?: string;
  apiToken?: string; // jira
  domain?: string; // jira
  email?: string; // jira
  organization?: string; // sentry
}

export interface SaveResourcesPayload {
  provider: string;
  connectionId: string;
  resources: any[];
}

// ─────────────────────────────────────────────────────────────
// Endpoints
// ─────────────────────────────────────────────────────────────
// Split RTK Query tag types so the Settings integration list
// (`ConnectionState`) refreshes independently from per-connection
// queries (`Connection`). See ADR-0002.
// ─────────────────────────────────────────────────────────────
// Deleting a connection or one of its resources cascade-deletes the `entities`
// rows behind it — and with them `issues` and `signals` (FK onDelete: cascade).
// Every tag family reading synced content has to refresh, or the Tasks screen
// keeps listing issues from a connection that no longer exists.
const SYNCED_CONTENT_TAGS = [
  'Entity',
  'Issue',
  'ProjectIssues',
  'ProjectSignals',
] as const;

export const connectionsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({

    // ── integration-state list (Settings page) ──
    getConnectionStates: builder.query<ConnectionState[], void>({
      query: () => ({
        handler: CHANNELS.connections.listStates,
      }),
      providesTags: ['ConnectionState'],
    }),

    updateConnectionState: builder.mutation<
      void,
      { id: string } & UpdateConnectionStatePayload
    >({
      query: ({ id, ...body }) => ({
        handler: CHANNELS.connections.updateState,
        args: [id, body],
      }),
      invalidatesTags: ['ConnectionState'],
    }),

    // ── identity ──
    getConnection: builder.query<Connection, string>({
      query: (provider) => ({
        handler: CHANNELS.connections.getByProvider,
        args: [provider],
      }),
      transformResponse: (response: { connection: Connection }) =>
        response.connection,
      providesTags: ['Connection'],
    }),

    saveCredentials: builder.mutation<void, SaveCredentialsPayload>({
      query: (body) => ({
        handler: CHANNELS.connections.saveCredentials,
        args: [body],
      }),
      // Saving credentials flips `isConnected` in connection_states AND mints
      // a new connection row, so both tag families must refresh.
      invalidatesTags: ['Connection', 'ConnectionState'],
    }),

    revokeConnection: builder.mutation<void, string>({
      query: (provider) => ({
        handler: CHANNELS.connections.revoke,
        args: [provider],
      }),
      invalidatesTags: ['Connection', 'ConnectionState', ...SYNCED_CONTENT_TAGS],
    }),

    // ── per-provider resource discovery ──
    getGitHubRepos: builder.query<GitHubRepo[], string>({
      query: (connectionId) => ({
        handler: CHANNELS.connections.getGithubRepos,
        args: [connectionId],
      }),
      transformResponse: (response: { repos: GitHubRepo[] }) => response.repos,
    }),

    getLinearTeams: builder.query<LinearTeam[], string>({
      query: (connectionId) => ({
        handler: CHANNELS.connections.getLinearTeams,
        args: [connectionId],
      }),
      transformResponse: (response: { teams: LinearTeam[] }) => response.teams,
    }),

    getJiraProjects: builder.query<JiraProject[], string>({
      query: (connectionId) => ({
        handler: CHANNELS.connections.getJiraProjects,
        args: [connectionId],
      }),
      transformResponse: (response: { projects: JiraProject[] }) => response.projects,
    }),

    getAsanaProjects: builder.query<AsanaProject[], string>({
      query: (connectionId) => ({
        handler: CHANNELS.connections.getAsanaProjects,
        args: [connectionId],
      }),
      transformResponse: (response: { projects: AsanaProject[] }) => response.projects,
    }),

    getGitLabProjects: builder.query<GitLabProject[], string>({
      query: (connectionId) => ({
        handler: CHANNELS.connections.getGitlabProjects,
        args: [connectionId],
      }),
      transformResponse: (response: { projects: GitLabProject[] }) => response.projects,
    }),

    getTrelloBoards: builder.query<TrelloBoard[], string>({
      query: (connectionId) => ({
        handler: CHANNELS.connections.getTrelloBoards,
        args: [connectionId],
      }),
      transformResponse: (response: { boards: TrelloBoard[] }) => response.boards,
    }),

    getSentryProjects: builder.query<SentryProject[], string>({
      query: (connectionId) => ({
        handler: CHANNELS.connections.getSentryProjects,
        args: [connectionId],
      }),
      transformResponse: (response: { projects: SentryProject[] }) => response.projects,
    }),

    getSocketDevOrganizations: builder.query<SocketDevOrganization[], string>({
      query: (connectionId) => ({
        handler: CHANNELS.connections.getSocketDevOrganizations,
        args: [connectionId],
      }),
      transformResponse: (response: { organizations: SocketDevOrganization[] }) => response.organizations,
    }),

    /**
     * Generic accessor for the items the user has linked under a connection.
     * Main returns `{ [providerSpecificKey]: items, connectionId }` (e.g. `repos`,
     * `teams`, `projects`, `boards`, `organizations`); we strip the wrapping key
     * here so the renderer always sees `{ items, connectionId }`.
     */
    getSelectedResources: builder.query<
      { items: any[]; connectionId: string },
      string
    >({
      query: (provider) => ({
        handler: CHANNELS.connections.getSelectedResources,
        args: [provider],
      }),
      transformResponse: (response: any) => {
        const { connectionId = '', ...rest } = response ?? {};
        const items = (Object.values(rest)[0] as any[]) ?? [];
        return { items, connectionId };
      },
      providesTags: ['Connection'],
    }),

    saveResources: builder.mutation<void, SaveResourcesPayload>({
      query: (body) => ({
        handler: CHANNELS.connections.saveResources,
        args: [body],
      }),
      invalidatesTags: ['Connection'],
      async onQueryStarted(arg, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled;
          const syncPromise = dispatch(syncApi.endpoints.runEntitySync.initiate(arg.provider)).unwrap();
          toast.promise(syncPromise, {
            loading: "Syncing...",
            success: (data) => `Synced ${data.total} items`,
            error: "Sync failed",
          });
        } catch {
          // save itself failed — no sync needed
        }
      },
    }),

    deleteResource: builder.mutation<void, string>({
      query: (resourceId) => ({
        handler: CHANNELS.connections.deleteResource,
        args: [resourceId],
      }),
      invalidatesTags: ['Connection', ...SYNCED_CONTENT_TAGS],
    }),

    // ── GitHub OAuth device flow (token acquisition; the token is then
    //    saved through the normal saveCredentials mutation) ──
    startGithubDeviceFlow: builder.mutation<GitHubDeviceAuthorization, void>({
      query: () => ({
        handler: CHANNELS.connections.githubDeviceStart,
      }),
    }),

    pollGithubDeviceFlow: builder.mutation<GitHubDevicePollResult, string>({
      query: (deviceCode) => ({
        handler: CHANNELS.connections.githubDevicePoll,
        args: [deviceCode],
      }),
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetConnectionStatesQuery,
  useUpdateConnectionStateMutation,
  useGetConnectionQuery,
  useLazyGetConnectionQuery,
  useSaveCredentialsMutation,
  useRevokeConnectionMutation,
  useLazyGetGitHubReposQuery,
  useLazyGetLinearTeamsQuery,
  useLazyGetJiraProjectsQuery,
  useLazyGetAsanaProjectsQuery,
  useLazyGetGitLabProjectsQuery,
  useLazyGetTrelloBoardsQuery,
  useLazyGetSentryProjectsQuery,
  useLazyGetSocketDevOrganizationsQuery,
  useGetSelectedResourcesQuery,
  useLazyGetSelectedResourcesQuery,
  useSaveResourcesMutation,
  useDeleteResourceMutation,
  useStartGithubDeviceFlowMutation,
  usePollGithubDeviceFlowMutation,
} = connectionsApi;
