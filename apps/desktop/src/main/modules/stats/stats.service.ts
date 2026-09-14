import { statsRepo } from "./stats.repo";
import type { DashboardData, ProviderFilter } from "./stats.dto";

// Throw-style: returns plain data, throws on failure; the ServiceResponse
// envelope is applied by handle() at the IPC seam. See CONTEXT.md "handle".
export const statsService = {
  async getDashboard(
    filter: ProviderFilter = "all",
  ): Promise<DashboardData> {
    const [
      summary,
      dailyActivity,
      hourDistribution,
      costByModel,
      toolUsage,
      statusBreakdown,
      recentSessions,
      codeActivity,
    ] = await Promise.all([
      statsRepo.getSummary(filter),
      statsRepo.getDailyActivity(30, filter),
      statsRepo.getHourDistribution(filter),
      statsRepo.getCostByModel(filter),
      statsRepo.getToolUsage(15, filter),
      statsRepo.getStatusBreakdown(filter),
      statsRepo.getRecentSessions(15, filter),
      statsRepo.getCodeActivity(filter),
    ]);

    return {
      summary,
      dailyActivity,
      hourDistribution,
      costByModel,
      toolUsage,
      statusBreakdown,
      recentSessions,
      codeActivity,
    };
  },
};
