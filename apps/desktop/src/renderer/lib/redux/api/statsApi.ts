import { baseApi } from "./baseApi";
import { CHANNELS } from "@mains/contracts/channels";
import type { DashboardConsumptionData, DashboardData, DashboardQuery, ProviderFilter } from "@mains/contracts/stats";

export type * from "@mains/contracts/stats";

export const statsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getConsumption: builder.query<DashboardConsumptionData, DashboardQuery>({
      query: (query) => ({ handler: CHANNELS.stats.getConsumption, args: [query] }),
      providesTags: ["Stats"],
    }),
    getDashboard: builder.query<DashboardData, DashboardQuery | ProviderFilter | void>({
      query: (query) => ({
        handler: CHANNELS.stats.getDashboard,
        args: [query ?? {}],
      }),
      providesTags: ["Stats"],
    }),
  }),
});

export const { useGetDashboardQuery, useLazyGetDashboardQuery, useGetConsumptionQuery } = statsApi;
