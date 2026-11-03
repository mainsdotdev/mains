import type {
  ResourceIssueStates,
  SetIssueStatusMappingInput,
} from "@mains/contracts/issue-status";
import { baseApi } from "./baseApi";
import { CHANNELS } from "../../../../shared/ipc-kit/channels";

export interface SyncStats {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

export interface SyncResult {
  success: boolean;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  total: number;
  duration: number;
  stats: {
    itemsPerSecond: number;
  };
}

export const syncApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    runEntitySync: builder.mutation<SyncResult, string | void>({
      query: (provider) => ({
        handler: CHANNELS.sync.runEntitySync,
        args: provider ? [provider] : [],
      }),
      // A sync writes `entities`, `issues`, and `signals` — every tag family
      // reading those rows has to refresh, or a freshly connected provider's
      // issues only show up after a reload.
      invalidatesTags: ["Entity", "Issue", "ProjectIssues", "ProjectSignals"],
    }),

    /** A resource's provider workflow states and the status each maps to. */
    getIssueStates: builder.query<ResourceIssueStates, string>({
      query: (resourceId) => ({
        handler: CHANNELS.sync.listIssueStates,
        args: [resourceId],
      }),
      providesTags: (_result, _error, resourceId) => [{ type: "IssueStates", id: resourceId }],
    }),

    setIssueStatusMapping: builder.mutation<{ updated: number }, SetIssueStatusMappingInput>({
      query: (input) => ({
        handler: CHANNELS.sync.setIssueStatusMapping,
        args: [input],
      }),
      // The mapping re-labels stored issues, so the inbox refetches. The state
      // list is patched in place instead: refetching it is a provider call.
      invalidatesTags: ["Issue", "ProjectIssues"],
      async onQueryStarted({ resourceId, stateId, statusId }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          syncApi.util.updateQueryData("getIssueStates", resourceId, (draft) => {
            const state = draft.states.find((s) => s.id === stateId);
            if (!state) return;
            state.statusId = statusId ?? state.defaultStatusId;
            state.mapped = statusId !== null;
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          patch.undo();
        }
      },
    }),
  }),
  overrideExisting: false,
});

export const {
  useRunEntitySyncMutation,
  useGetIssueStatesQuery,
  useSetIssueStatusMappingMutation,
} = syncApi;
