import { baseApi } from "./baseApi";

export interface DashboardSummary {
  totalProjects: number;
  runsToday: number;
  totalSessions: number;
  estimatedCostUsd: number;
}

export interface DailyActivity {
  date: string;
  claude: number;
  copilot: number;
  codex: number;
  cursor: number;
  other: number;
}

export interface HourDistribution {
  hour: number;
  count: number;
}

export interface CostByModel {
  model: string;
  costUsd: number;
  runs: number;
}

export interface ToolUsageItem {
  toolName: string;
  count: number;
}

export interface StatusBreakdownDay {
  date: string;
  dayLabel: string;
  succeeded: number;
  failed: number;
  canceled: number;
  other: number;
}

export interface StatusBreakdown {
  days: StatusBreakdownDay[];
  totalSucceeded: number;
  totalFailed: number;
  totalCanceled: number;
  totalOther: number;
}

export interface RecentSession {
  runId: string;
  title: string | null;
  goal: string | null;
  status: string;
  providerId: string;
  projectName: string | null;
  durationMs: number | null;
  totalCostUsd: number | null;
  createdAt: number;
}

export interface CodeActivityStats {
  totalDiffs: number;
  totalFilesChanged: number;
}

export interface DashboardData {
  summary: DashboardSummary;
  dailyActivity: DailyActivity[];
  hourDistribution: HourDistribution[];
  costByModel: CostByModel[];
  toolUsage: ToolUsageItem[];
  statusBreakdown: StatusBreakdown;
  recentSessions: RecentSession[];
  codeActivity: CodeActivityStats;
}

import type { ProviderId } from "../../../../shared/provider-ids";
import { CHANNELS } from "../../../../shared/ipc-kit/channels";

export type ProviderFilter = "all" | ProviderId;

export const statsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getDashboard: builder.query<DashboardData, ProviderFilter | void>({
      query: (filter) => ({
        handler: CHANNELS.stats.getDashboard,
        args: [filter ?? "all"],
      }),
      providesTags: ["Stats"],
    }),
  }),
});

export const { useGetDashboardQuery, useLazyGetDashboardQuery } = statsApi;
