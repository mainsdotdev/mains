import { createApi, BaseQueryFn } from '@reduxjs/toolkit/query/react';
import type { ServiceResponse } from '../../../../shared/ipc-kit/service-response';
import { getTransport } from '../../transport';

// `handler` is a "domain:action" channel (from CHANNELS); `args` are the
// positional arguments. The call is routed through the active transport
// (local Electron IPC by default), not `window.api` directly, so the same
// endpoints can target a remote backend by swapping the transport.
// See docs/design/remote-backend.md.
//
// The base query owns unwrapping: the ServiceResponse envelope is opened HERE,
// exactly once — endpoints receive plain `T` and must not re-unwrap in
// `transformResponse`. See CONTEXT.md "assertOk / assertFail / unwrap".
const ipcBaseQuery = (): BaseQueryFn<
  {
    handler: string;
    args?: any[];
  },
  unknown,
  unknown
> => async ({ handler, args = [] }) => {
  try {
    const result: ServiceResponse<unknown> = await getTransport().invoke(
      handler,
      args,
    );

    if (!result.success) {
      return { error: result.error };
    }

    return { data: result.data };
  } catch (error: any) {
    return {
      error: {
        status: 'CUSTOM_ERROR',
        error: error.message || 'An error occurred',
      },
    };
  }
};

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: ipcBaseQuery(),
  // Drop unused cache entries after 60s by default to keep RAM bounded.
  // Individual endpoints can override this if they need longer retention.
  keepUnusedDataFor: 60,
  refetchOnFocus: true,
  refetchOnReconnect: true,
  tagTypes: [
    'ConnectionState',
    'Connection',
    'Collections',
    'CollectionSources',
    'Entity',
    'Task',
    'Issue',
    'Account',
    'Spaces',
    'AppSettings',
    'Providers',
    'ProviderModels',
    'ProviderCommands',
    'ProviderSkills',
    'ProviderPlugins',
    'ProviderInstalledPlugins',
    'ProviderAccountInfo',
    'ToolCalls',
    'Workspaces',
    'WorkspaceGitStates',
    'Runs',
    'RunsRecent',
    'RunContext',
    'RunArtifacts',
    'RunTurns',
    'ProjectResources',
    'ProjectIssues',
    'WorkspaceDiffs',
    'Reviews',
    'ReviewFindings',
    'Projects',
    'Updates',
    'InstalledApps',
    'AppsForFile',
    'Stats',
    'WorkspaceActivity',
    'Automations',
    'Pulse',
    'ProjectSignals',
    'PullRequests',
    'PullRequestDetail',
  ],
  endpoints: () => ({}),
});
