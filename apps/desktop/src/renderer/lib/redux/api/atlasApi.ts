import { CHANNELS } from "@mains/contracts/channels";
import type { AtlasCreatePage, AtlasGeneratedOptions, AtlasGeneratedPage, AtlasIdentity, AtlasItem, AtlasListItem, AtlasListOptions,
  AtlasPage, AtlasPageRevision, AtlasSaveFile, AtlasSavePage, AtlasUpdateItem, AtlasUploadFile } from "@mains/contracts/atlas";
import { baseApi } from "./baseApi";
import type { RootState } from "../index";
import { closeAtlasPageTab } from "../slices/atlasSlice";

export const atlasApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    listAtlas: builder.query<AtlasListItem[], AtlasListOptions>({
      query: (options) => ({ handler: CHANNELS.atlas.list, args: [options] }),
      providesTags: ["Atlas"],
    }),
    atlasGenerated: builder.query<AtlasGeneratedPage, AtlasGeneratedOptions>({
      query: (options) => ({ handler: CHANNELS.atlas.generated, args: [options] }),
      providesTags: ["RunArtifacts", "RunOutputs", "Runs"],
    }),
    atlasPage: builder.query<AtlasPage | null, AtlasIdentity>({
      query: (options) => ({ handler: CHANNELS.atlas.get, args: [options] }),
      providesTags: (_r, _e, { id }) => [{ type: "AtlasPage", id }],
      async onQueryStarted(_identity, { dispatch, getState, getCacheEntry, queryFulfilled }) {
        const previous = getCacheEntry().data?.item;
        const backendId = (getState() as RootState).backends.activeBackendId;
        try {
          const { data } = await queryFulfilled;
          if ((getState() as RootState).backends.activeBackendId !== backendId) return;
          const next = data?.item;
          // Agent writes bypass renderer mutations. The editor's polling read
          // must also refresh library/Recents metadata when the Page changes.
          if (previous?.version !== next?.version || previous?.title !== next?.title ||
            previous?.updatedAt !== next?.updatedAt || previous?.trashedAt !== next?.trashedAt) {
            dispatch(baseApi.util.invalidateTags(["Atlas"]));
          }
        } catch { /* Keep the library's last successful data when a Page read fails. */ }
      },
    }),
    createAtlasPage: builder.mutation<AtlasPage, AtlasCreatePage>({
      query: (input) => ({ handler: CHANNELS.atlas.createPage, args: [input] }),
      invalidatesTags: ["Atlas"],
    }),
    saveAtlasPage: builder.mutation<AtlasPage, AtlasSavePage>({
      query: (input) => ({ handler: CHANNELS.atlas.savePage, args: [input] }),
      invalidatesTags: (_r, e, { id }) => e ? [] : ["Atlas", { type: "AtlasPage", id }],
    }),
    atlasRevisions: builder.query<Omit<AtlasPageRevision, "blocks" | "markdown">[], AtlasIdentity>({
      query: (input) => ({ handler: CHANNELS.atlas.revisions, args: [input] }),
      providesTags: (_r, _e, { id }) => [{ type: "AtlasPage", id }],
    }),
    restoreAtlasPage: builder.mutation<AtlasPage, AtlasIdentity & { version: number; expectedVersion: number }>({
      query: (input) => ({ handler: CHANNELS.atlas.restore, args: [input] }),
      invalidatesTags: (_r, e, { id }) => e ? [] : ["Atlas", { type: "AtlasPage", id }],
    }),
    saveToAtlas: builder.mutation<AtlasItem, AtlasSaveFile>({
      query: (input) => ({ handler: CHANNELS.atlas.saveFile, args: [input] }),
      invalidatesTags: ["Atlas"],
    }),
    uploadAtlasFile: builder.mutation<AtlasItem, AtlasUploadFile>({
      query: (input) => ({ handler: CHANNELS.atlas.uploadFile, args: [input] }),
      invalidatesTags: ["Atlas"],
    }),
    updateAtlasItem: builder.mutation<AtlasItem, AtlasUpdateItem>({
      query: (input) => ({ handler: CHANNELS.atlas.update, args: [input] }),
      invalidatesTags: (_r, e, { id }) => e ? [] : ["Atlas", { type: "AtlasPage", id }],
      async onQueryStarted({ accountId, id, trashed }, { dispatch, getState, queryFulfilled }) {
        if (!trashed) return;
        const ownerKey = JSON.stringify([(getState() as RootState).backends.activeBackendId ?? "local", accountId]);
        try {
          const { data } = await queryFulfilled;
          if (data.kind === "page" && data.trashedAt) dispatch(closeAtlasPageTab({ ownerKey, id }));
        } catch { /* Keep the tab open when moving to Trash fails. */ }
      },
    }),
    removeAtlasItem: builder.mutation<void, AtlasIdentity>({
      query: (input) => ({ handler: CHANNELS.atlas.remove, args: [input] }),
      invalidatesTags: (_r, e, { id }) => e ? [] : ["Atlas", { type: "AtlasPage", id }],
      async onQueryStarted({ accountId, id }, { dispatch, getState, queryFulfilled }) {
        const ownerKey = JSON.stringify([(getState() as RootState).backends.activeBackendId ?? "local", accountId]);
        try {
          await queryFulfilled;
          dispatch(closeAtlasPageTab({ ownerKey, id }));
        } catch { /* Keep the tab open when permanent deletion fails. */ }
      },
    }),
  }),
});
export const { useListAtlasQuery, useAtlasGeneratedQuery, useAtlasPageQuery, useCreateAtlasPageMutation,
  useSaveAtlasPageMutation, useAtlasRevisionsQuery, useRestoreAtlasPageMutation, useSaveToAtlasMutation,
  useUploadAtlasFileMutation, useUpdateAtlasItemMutation, useRemoveAtlasItemMutation } = atlasApi;
