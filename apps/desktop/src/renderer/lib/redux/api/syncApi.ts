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
  }),
  overrideExisting: false,
});

export const { useRunEntitySyncMutation } = syncApi;
