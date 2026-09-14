import { baseApi } from './baseApi';
import { CHANNELS } from "../../../../shared/ipc-kit/channels";

export interface InstalledApp {
  id: string;
  name: string;
  bundleId: string;
  path: string;
  icon: string | null;
}

/** Launch Services–reported app that can open a given file (macOS). */
export interface FileHandlerApp {
  bundleId: string;
  name: string;
  path: string;
  icon: string | null;
}

export const shellApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getInstalledApps: builder.query<InstalledApp[], void>({
      query: () => ({
        handler: CHANNELS.shell.getInstalledApps,
      }),
      providesTags: ['InstalledApps'],
      keepUnusedDataFor: 3600,
    }),
    getAppsForFile: builder.query<FileHandlerApp[], string>({
      query: (filePath) => ({
        handler: CHANNELS.shell.getAppsForFile,
        args: [filePath],
      }),
      providesTags: (_result, _err, filePath) => [{ type: 'AppsForFile' as const, id: filePath }],
      keepUnusedDataFor: 300,
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetInstalledAppsQuery,
  useLazyGetAppsForFileQuery,
} = shellApi;
