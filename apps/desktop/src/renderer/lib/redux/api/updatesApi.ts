import { baseApi } from "./baseApi";
import { CHANNELS } from "../../../../shared/ipc-kit/channels";

import type { UpdateState } from "../../../../shared/update-lifecycle";
export type { UpdateStatus, UpdateInfo, UpdateProgress, UpdateState } from "../../../../shared/update-lifecycle";

export const updatesApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getUpdateStatus: builder.query<UpdateState, void>({
      query: () => ({ handler: CHANNELS.updates.getStatus }),
      providesTags: ["Updates"],
    }),
    checkForUpdates: builder.mutation<UpdateState, void>({
      query: () => ({ handler: CHANNELS.updates.check }),
      invalidatesTags: ["Updates"],
    }),
    downloadUpdate: builder.mutation<UpdateState, void>({
      query: () => ({ handler: CHANNELS.updates.download }),
      invalidatesTags: ["Updates"],
    }),
    installUpdate: builder.mutation<null, void>({
      query: () => ({ handler: CHANNELS.updates.quitAndInstall }),
    }),
  }),
});

export const {
  useGetUpdateStatusQuery,
  useCheckForUpdatesMutation,
  useDownloadUpdateMutation,
  useInstallUpdateMutation,
} = updatesApi;
