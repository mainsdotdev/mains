import { CHANNELS } from "../../../../shared/ipc-kit/channels";
import { baseApi } from "./baseApi";

export interface Collection {
  id: string;
  accountId: string;
  name: string;
  icon: string | null;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCollectionPayload {
  accountId: string;
  name: string;
  icon?: string;
}

export interface CollectionIdentityOptions {
  id: string;
  accountId: string;
}

export interface CollectionSource {
  id: string;
  collectionId: string;
  kind: "file" | "text";
  name: string;
  mimeType: string;
  byteSize: number;
  contentHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export type AddCollectionSourcePayload =
  | {
      accountId: string;
      collectionId: string;
      kind: "file";
      name: string;
      mimeType: string;
      data: string;
    }
  | {
      accountId: string;
      collectionId: string;
      kind: "text";
      name: string;
      text: string;
    };

export const collectionsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    listCollections: builder.query<
      Collection[],
      { accountId: string; includeArchived?: boolean }
    >({
      query: (options) => ({
        handler: CHANNELS.collections.list,
        args: [options],
      }),
      providesTags: ["Collections"],
    }),
    getCollection: builder.query<Collection | null, CollectionIdentityOptions>({
      query: (options) => ({
        handler: CHANNELS.collections.get,
        args: [options],
      }),
      providesTags: (_result, _error, { id }) => [
        { type: "Collections", id },
      ],
    }),
    createCollection: builder.mutation<Collection, CreateCollectionPayload>({
      query: (payload) => ({
        handler: CHANNELS.collections.create,
        args: [payload],
      }),
      invalidatesTags: ["Collections"],
    }),
    updateCollection: builder.mutation<
      Collection,
      CollectionIdentityOptions & {
        payload: { name?: string; icon?: string | null };
      }
    >({
      query: ({ id, accountId, payload }) => ({
        handler: CHANNELS.collections.update,
        args: [{ id, accountId }, payload],
      }),
      invalidatesTags: ["Collections"],
    }),
    archiveCollection: builder.mutation<Collection, CollectionIdentityOptions>({
      query: (options) => ({
        handler: CHANNELS.collections.archive,
        args: [options],
      }),
      invalidatesTags: ["Collections"],
    }),
    unarchiveCollection: builder.mutation<Collection, CollectionIdentityOptions>({
      query: (options) => ({
        handler: CHANNELS.collections.unarchive,
        args: [options],
      }),
      invalidatesTags: ["Collections"],
    }),
    removeCollection: builder.mutation<void, CollectionIdentityOptions>({
      query: (options) => ({
        handler: CHANNELS.collections.remove,
        args: [options],
      }),
      invalidatesTags: ["Collections", "RunsRecent"],
    }),
    listCollectionSources: builder.query<
      CollectionSource[],
      { accountId: string; collectionId: string }
    >({
      query: (options) => ({
        handler: CHANNELS.collections.listSources,
        args: [options],
      }),
      providesTags: (_result, _error, { collectionId }) => [
        { type: "CollectionSources", id: collectionId },
      ],
    }),
    addCollectionSource: builder.mutation<
      CollectionSource,
      AddCollectionSourcePayload
    >({
      query: (payload) => ({
        handler: CHANNELS.collections.addSource,
        args: [payload],
      }),
      invalidatesTags: (_result, _error, { collectionId }) => [
        { type: "CollectionSources", id: collectionId },
      ],
    }),
    removeCollectionSource: builder.mutation<
      void,
      { accountId: string; id: string; collectionId: string }
    >({
      query: ({ accountId, id }) => ({
        handler: CHANNELS.collections.removeSource,
        args: [{ accountId, id }],
      }),
      invalidatesTags: (_result, _error, { collectionId }) => [
        { type: "CollectionSources", id: collectionId },
      ],
    }),
  }),
});

export const {
  useListCollectionsQuery,
  useGetCollectionQuery,
  useCreateCollectionMutation,
  useUpdateCollectionMutation,
  useArchiveCollectionMutation,
  useUnarchiveCollectionMutation,
  useRemoveCollectionMutation,
  useListCollectionSourcesQuery,
  useAddCollectionSourceMutation,
  useRemoveCollectionSourceMutation,
} = collectionsApi;
