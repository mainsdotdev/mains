import { PROVIDER_IDS } from "@mains/contracts/provider-ids";
import { statsRepo } from "./stats.repo";
import { resolveDashboardRange, type ResolvedDashboardRange } from "./stats.range";
import { addUsage, emptyUsage, modelEntryUsage, readModelEntries, turnUsage } from "./stats.usage";
import { cliHistoryScanner, cliHistorySources } from "./stats.cli-history";
import { aggregateConsumptionAsync, mainsConsumptionRecordsAsync } from "./stats.consumption";
import { readUsagePrices } from "./stats.pricing";
import { createStatsWorkBudget } from "./stats.work";
import type {
  DashboardData, DashboardQuery, ProviderFilter, ProviderUsage, ModelUsage,
  RecentSession, DailyActivity, StatusBreakdownDay, DashboardConsumptionData,
} from "./stats.dto";

const consumptionRequests = new Map<string, Promise<DashboardConsumptionData>>();

async function loadConsumption(range: ResolvedDashboardRange): Promise<DashboardConsumptionData> {
  const sources = cliHistorySources().filter((source) => range.provider === "all" || source.providerId === range.provider);
  const [history, rows, pricing] = await Promise.all([
    cliHistoryScanner.read(sources, range.fromSeconds), statsRepo.listActivityRows(range), readUsagePrices(),
  ]);
  const mains = await mainsConsumptionRecordsAsync(rows);
  const cliReport = await aggregateConsumptionAsync(history.records, range, pricing.prices);
  const mainsReport = await aggregateConsumptionAsync(mains.records, range, pricing.prices, mains.modelRecords);
  return { range: range.range, scannedAt: new Date().toISOString(), sources: history.sources, pricing: pricing.pricing,
    cli: cliReport, mains: mainsReport };
}

export const statsService = {
  /** Independent from activity reads so a large cold scan or offline pricing
   * never prevents the existing Mains dashboard from loading. */
  async getConsumption(query: DashboardQuery = {}): Promise<DashboardConsumptionData> {
    const range = resolveDashboardRange(query);
    // Multiple clients/pollers asking for the same projection share one job;
    // completion or failure releases it so explicit refreshes remain fresh.
    const key = JSON.stringify([range.provider, range.range]);
    let request = consumptionRequests.get(key);
    if (!request) {
      request = loadConsumption(range).finally(() => { consumptionRequests.delete(key); });
      consumptionRequests.set(key, request);
    }
    return request;
  },
  async getDashboard(query: DashboardQuery | ProviderFilter = {}): Promise<DashboardData> {
    const resolved = resolveDashboardRange(query);
    const [activityRows, toolRows] = await Promise.all([
      statsRepo.listActivityRows(resolved), statsRepo.listToolRows(resolved),
    ]);
    const summary = { ...emptyUsage(), totalSessions: 0, totalTurns: 0 };
    const tokenUsage = resolved.dates.map((date) => ({ date, ...emptyUsage() }));
    const tokenActivity = resolved.range.granularity === "day" ? tokenUsage
      : resolved.dailyDates.map((date) => ({ date, ...emptyUsage() }));
    const activityBuckets = new Map(tokenActivity.map((bucket) => [bucket.date, bucket]));
    const dailyActivity: DailyActivity[] = resolved.dates.map((date) => ({ date, claude: 0, copilot: 0, codex: 0, cursor: 0, other: 0 }));
    const statusDays: StatusBreakdownDay[] = resolved.dates.map((date) => ({ date, succeeded: 0, failed: 0, canceled: 0, other: 0 }));
    const bucketIndex = new Map(resolved.dates.map((date, index) => [date, index]));
    const hourDistribution = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
    const providers = new Map<string, ProviderUsage>();
    const models = new Map<string, ModelUsage>();
    const sessions = new Map<string, RecentSession>();
    const providerKeys = new Map<string, "claude" | "copilot" | "codex" | "cursor">(
      Object.entries(PROVIDER_IDS).map(([key, id]) => [id, key as "claude" | "copilot" | "codex" | "cursor"]),
    );
    const pause = createStatsWorkBudget();

    for (const row of activityRows) {
      const yielding = pause();
      if (yielding) await yielding;
      if (!resolved.includes(row.activityAt)) continue;
      const local = resolved.localTime(row.activityAt);
      const index = bucketIndex.get(resolved.bucketDate(local.date))!;
      let session = sessions.get(row.runId);
      if (!session) {
        session = {
          ...emptyUsage(), runId: row.runId, title: row.title, goal: row.goal,
          status: row.status, providerId: row.providerId, projectName: row.projectName,
          lastActivityAt: row.activityAt,
        };
        sessions.set(row.runId, session);
      }
      session.lastActivityAt = Math.max(session.lastActivityAt, row.activityAt);
      // Sessions awaiting their first turn have no fabricated turn or usage.
      if (row.turnId === null) continue;
      summary.totalTurns++;
      dailyActivity[index][providerKeys.get(row.providerId) ?? "other"]++;
      hourDistribution[local.hour].count++;
      const entries = readModelEntries(row);
      const usage = turnUsage(row, entries);
      addUsage(summary, usage);
      addUsage(tokenUsage[index], usage);
      const activityBucket = activityBuckets.get(local.date)!;
      if (activityBucket !== tokenUsage[index]) addUsage(activityBucket, usage);
      addUsage(session, usage);
      const provider = providers.get(row.providerId) ?? { ...emptyUsage(), providerId: row.providerId, turns: 0 };
      provider.turns++;
      addUsage(provider, usage);
      providers.set(row.providerId, provider);
      const modelRows = entries.length
        ? entries.map((entry) => ({ model: entry.model, usage: modelEntryUsage(row, entry) }))
        : [{ model: row.model, usage }];
      // Several aliases for one canonical model can occur within a turn.
      // Sum their usage, but count that turn once for model coverage.
      const perTurn = new Map<string, ModelUsage>();
      for (const modelRow of modelRows) {
        const key = JSON.stringify([row.providerId, modelRow.model]);
        const model = perTurn.get(key) ?? { ...emptyUsage(), providerId: row.providerId, model: modelRow.model, turns: 1 };
        addUsage(model, modelRow.usage);
        perTurn.set(key, model);
      }
      for (const [key, model] of perTurn) {
        model.tokenReportedTurns = model.completedTurns > 0 && model.tokenReportedTurns === model.completedTurns ? 1 : 0;
        model.costReportedTurns = model.completedTurns > 0 && model.costReportedTurns === model.completedTurns ? 1 : 0;
        model.completedTurns = Math.min(model.completedTurns, 1);
        const total = models.get(key) ?? { ...emptyUsage(), providerId: model.providerId, model: model.model, turns: 0 };
        total.turns++;
        addUsage(total, model);
        models.set(key, total);
      }
    }
    summary.totalSessions = sessions.size;
    const statusBreakdown = { days: statusDays, totalSucceeded: 0, totalFailed: 0, totalCanceled: 0, totalOther: 0 };
    for (const session of sessions.values()) {
      const yielding = pause();
      if (yielding) await yielding;
      const index = bucketIndex.get(resolved.bucketDate(resolved.localTime(session.lastActivityAt).date))!;
      if (session.status === "succeeded" || session.status === "completed") {
        statusDays[index].succeeded++; statusBreakdown.totalSucceeded++;
      } else if (session.status === "failed") {
        statusDays[index].failed++; statusBreakdown.totalFailed++;
      } else if (session.status === "canceled") {
        statusDays[index].canceled++; statusBreakdown.totalCanceled++;
      } else {
        statusDays[index].other++; statusBreakdown.totalOther++;
      }
    }
    const tools = new Map<string, number>();
    for (const row of toolRows) {
      const yielding = pause();
      if (yielding) await yielding;
      if (resolved.includes(row.activityAt)) tools.set(row.toolName, (tools.get(row.toolName) ?? 0) + 1);
    }
    return {
      range: resolved.range, summary, tokenUsage, tokenActivity,
      providerUsage: [...providers.values()].sort((a, b) => (b.totalTokens ?? -1) - (a.totalTokens ?? -1) || b.turns - a.turns),
      modelUsage: [...models.values()].sort((a, b) => (b.totalTokens ?? -1) - (a.totalTokens ?? -1) || b.turns - a.turns),
      dailyActivity, hourDistribution, statusBreakdown,
      toolUsage: [...tools].map(([toolName, count]) => ({ toolName, count })).sort((a, b) => b.count - a.count || a.toolName.localeCompare(b.toolName)).slice(0, 15),
      recentSessions: [...sessions.values()].sort((a, b) => b.lastActivityAt - a.lastActivityAt || a.runId.localeCompare(b.runId)).slice(0, 15),
    };
  },
};
