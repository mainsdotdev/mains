import { baseApi } from "./baseApi";
import { CHANNELS } from "../../../../shared/ipc-kit/channels";
import type { ProviderId } from "../../../../shared/provider-ids";
import type { ModeId } from "../../../../shared/modes";

export interface Space {
  id: string;
  accountId: string;
  name: string;
  slug: string;
  description: string | null;
  systemPrompt: string | null;
  model: string | null;
  icon: string | null;
  themeConfig: string | null;
  providerId: ProviderId;
  mode: ModeId;
  sortOrder: number;
  isArchived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreateSpacePayload {
  name: string;
  slug?: string;
  description?: string;
  systemPrompt?: string;
  model?: string;
  icon?: string;
  themeConfig?: string;
  providerId?: ProviderId;
  mode?: ModeId;
  sortOrder?: number;
}

export interface UpdateSpacePayload {
  name?: string;
  slug?: string;
  description?: string;
  systemPrompt?: string;
  model?: string;
  icon?: string;
  themeConfig?: string;
  providerId?: ProviderId;
  mode?: ModeId;
  sortOrder?: number;
}

export const spaceApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getSpaces: builder.query<Space[], void>({
      query: () => ({
        handler: CHANNELS.space.getAll,
      }),
      providesTags: ["Spaces"],
    }),

    // Absence rule: a missing space arrives as null data, not an error.
    getSpaceById: builder.query<Space | null, string>({
      query: (spaceId) => ({
        handler: CHANNELS.space.getById,
        args: [spaceId],
      }),
      providesTags: (_result, _error, id) => [{ type: "Spaces", id }],
    }),

    createSpace: builder.mutation<Space, CreateSpacePayload>({
      query: (payload) => ({
        handler: CHANNELS.space.create,
        args: [payload],
      }),
      invalidatesTags: ["Spaces"],
    }),

    updateSpace: builder.mutation<
      Space,
      { id: string; payload: UpdateSpacePayload }
    >({
      query: ({ id, payload }) => ({
        handler: CHANNELS.space.update,
        args: [id, payload],
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: "Spaces", id },
        "Spaces",
      ],
    }),

    deleteSpace: builder.mutation<void, string>({
      query: (spaceId) => ({
        handler: CHANNELS.space.delete,
        args: [spaceId],
      }),
      invalidatesTags: ["Spaces", "AppSettings"],
    }),

    archiveSpace: builder.mutation<void, string>({
      query: (spaceId) => ({
        handler: CHANNELS.space.archive,
        args: [spaceId],
      }),
      invalidatesTags: ["Spaces"],
    }),

    unarchiveSpace: builder.mutation<void, string>({
      query: (spaceId) => ({
        handler: CHANNELS.space.unarchive,
        args: [spaceId],
      }),
      invalidatesTags: ["Spaces"],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetSpacesQuery,
  useGetSpaceByIdQuery,
  useLazyGetSpaceByIdQuery,
  useCreateSpaceMutation,
  useUpdateSpaceMutation,
  useDeleteSpaceMutation,
  useArchiveSpaceMutation,
  useUnarchiveSpaceMutation,
} = spaceApi;
