import type { BridgeStatus, BridgeProjectScope } from "@mains/contracts/bridge";
import type { BridgeAuthStatus } from "@mains/contracts/bridge-auth";
import { CHANNELS } from "@mains/contracts/channels";
import { subscribeEvent } from "@/lib/transport";
import { baseApi } from "./baseApi";

export const bridgeApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getBridgeProjectScopes: builder.query<BridgeProjectScope[], void>({
      query: () => ({ handler: CHANNELS.bridge.getProjectScopes }), providesTags: ["Bridge", "Projects"],
    }),
    getBridgeAuthStatus: builder.query<BridgeAuthStatus, void>({
      query: () => ({ handler: CHANNELS.bridge.getAuthStatus }),
      providesTags: ["Bridge"],
      async onCacheEntryAdded(_arg, { dispatch, cacheEntryRemoved }) {
        const status = subscribeEvent(CHANNELS.bridge.statusChanged, () => { dispatch(baseApi.util.invalidateTags(["Bridge"])); });
        const approval = subscribeEvent(CHANNELS.bridge.deviceApprovalRequested, () => { dispatch(baseApi.util.invalidateTags(["Bridge"])); });
        try { await cacheEntryRemoved; } finally { status(); approval(); }
      },
    }),
    getBridgeStatus: builder.query<BridgeStatus, void>({
      query: () => ({ handler: CHANNELS.bridge.getStatus }),
      providesTags: ["Bridge"],
      async onCacheEntryAdded(_arg, { dispatch, cacheEntryRemoved }) {
        const status = subscribeEvent(CHANNELS.bridge.statusChanged, () => { dispatch(baseApi.util.invalidateTags(["Bridge"])); });
        const records = subscribeEvent(CHANNELS.bridge.recordsApplied, (value) => {
          const tables = (value as { tables?: unknown })?.tables;
          if (!Array.isArray(tables)) return;
          if (tables.some((table) => typeof table === "string" && table.startsWith("atlas_"))) dispatch(baseApi.util.invalidateTags(["Atlas", "AtlasPage"]));
          if (tables.includes("workspaces")) dispatch(baseApi.util.invalidateTags(["Workspaces"]));
          if (tables.includes("projects")) dispatch(baseApi.util.invalidateTags(["Projects"]));
          if (tables.includes("spaces")) dispatch(baseApi.util.invalidateTags(["Spaces"]));
          if (tables.some((table) => table === "collections" || table === "collection_sources")) dispatch(baseApi.util.invalidateTags(["Collections", "CollectionSources"]));
          if (tables.some((table) => typeof table === "string" && (table === "runs" || table.startsWith("run_") || table === "tool_calls")))
            dispatch(baseApi.util.invalidateTags(["Runs", "RunsRecent", "RunTurns", "RunArtifacts"]));
        });
        try { await cacheEntryRemoved; } finally { status(); records(); }
      },
    }),
    syncBridgeNow: builder.mutation<void, void>({
      query: () => ({ handler: CHANNELS.bridge.syncNow }), invalidatesTags: ["Bridge"],
    }),
  }),
});
export const { useGetBridgeAuthStatusQuery, useGetBridgeStatusQuery, useGetBridgeProjectScopesQuery, useSyncBridgeNowMutation } = bridgeApi;
