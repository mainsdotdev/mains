import type {
  GlobalSearchQuery,
  GlobalSearchResult,
} from "@mains/contracts/search";
import { CHANNELS } from "@mains/contracts/channels";
import { baseApi } from "./baseApi";

export const searchApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    globalSearch: builder.query<GlobalSearchResult[], GlobalSearchQuery>({
      query: (input) => ({
        handler: CHANNELS.search.query,
        args: [input],
      }),
      keepUnusedDataFor: 15,
    }),
  }),
  overrideExisting: false,
});

export const { useGlobalSearchQuery } = searchApi;
export type { GlobalSearchQuery, GlobalSearchResult };
