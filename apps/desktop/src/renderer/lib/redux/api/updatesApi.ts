import { baseApi } from "./baseApi";
import { CHANNELS } from "../../../../shared/ipc-kit/channels";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

export type UpdateInfo = {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
};

export type UpdateProgress = {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
};

export type UpdateState = {
  status: UpdateStatus;
  info: UpdateInfo | null;
  progress: UpdateProgress | null;
  error: string | null;
};

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
