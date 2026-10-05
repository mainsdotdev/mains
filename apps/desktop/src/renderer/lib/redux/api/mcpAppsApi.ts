import type { McpAppEntrypoint } from "@mains/contracts/mcp-apps";
import { CHANNELS } from "@mains/contracts/channels";
import { baseApi } from "./baseApi";

export const mcpAppsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getMcpAppEntrypoints: builder.query<McpAppEntrypoint[], string>({
      query: (providerId) => ({
        handler: CHANNELS.mcpApps.listEntrypoints,
        args: [{ providerId }],
      }),
      // Plugin mutations already invalidate this dependency, including
      // install, update, enablement and removal.
      providesTags: (_result, _error, providerId) => [
        { type: "ProviderInstalledPlugins", id: providerId },
      ],
    }),
  }),
});

export const { useGetMcpAppEntrypointsQuery } = mcpAppsApi;
