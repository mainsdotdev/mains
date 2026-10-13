import type { ConsumptionTotals, ConsumptionRow, ConsumptionReport, UsageTotals } from "./stats.dto";
import type { ActivityRow } from "./stats.repo";
import type { ResolvedDashboardRange } from "./stats.range";
import { modelEntryUsage, readModelEntries, turnUsage } from "./stats.usage";
import { estimateRecord, type ModelPrices } from "./stats.pricing";
import type { ConsumptionRecord } from "./stats.transcripts";
import { finishStatsWork, runStatsWork } from "./stats.work";

export function emptyConsumption(): ConsumptionTotals {
  return { inputTokens: null, uncachedInputTokens: null, outputTokens: null, cacheReadTokens: null,
    cacheWriteTokens: null, totalTokens: null, estimatedCostUsd: null, cacheSavingsUsd: null,
    records: 0, tokenReportedRecords: 0, costEstimatedRecords: 0, cacheSavingsEstimatedRecords: 0,
    providerReportedCostRecords: 0, sessions: 0,
    reportedMetrics: { inputTokens: 0, uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
      cacheWriteTokens: 0, totalTokens: 0, estimatedCostUsd: 0, cacheSavingsUsd: 0 } };
}

const metricKeys = ["inputTokens", "uncachedInputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens",
  "totalTokens", "estimatedCostUsd", "cacheSavingsUsd"] as const;

function* consumptionSteps(
  records: ConsumptionRecord[], range: ResolvedDashboardRange, prices: ModelPrices,
  modelRecords: ConsumptionRecord[] = records,
): Generator<void, ConsumptionReport> {
  const totals = emptyConsumption();
  const providers = new Map<string, ConsumptionRow>();
  const models = new Map<string, ConsumptionRow>();
  const buckets = range.dates.map((date) => ({ date, ...emptyConsumption(), providers: [] as ConsumptionRow[] }));
  const bucketMap = new Map(buckets.map((bucket) => [bucket.date, bucket]));
  const sessions = new Map<ConsumptionTotals, Set<string>>();
  const prepare = (record: ConsumptionRecord) => {
    const estimate = estimateRecord(record, prices);
    const totalTokens = record.inputTokens !== null && record.outputTokens !== null ? record.inputTokens + record.outputTokens : null;
    const values = { ...record, totalTokens, estimatedCostUsd: estimate.cost, cacheSavingsUsd: estimate.savings };
    return { values, estimate, identity: JSON.stringify([record.providerId, record.sessionId]) };
  };
  const add = (target: ConsumptionTotals, { values, estimate, identity }: ReturnType<typeof prepare>) => {
    for (const key of metricKeys) if (values[key] !== null) {
      target[key] = (target[key] ?? 0) + values[key]!;
      target.reportedMetrics[key]++;
    }
    target.records++;
    target.tokenReportedRecords += Number(values.totalTokens !== null);
    target.costEstimatedRecords += Number(estimate.cost !== null);
    target.cacheSavingsEstimatedRecords += Number(estimate.savings !== null);
    target.providerReportedCostRecords += Number(estimate.reported);
    const identities = sessions.get(target) ?? new Set<string>();
    identities.add(identity);
    sessions.set(target, identities);
    target.sessions = identities.size;
  };
  const eligible = (record: ConsumptionRecord, seen: Set<string>) => {
    if (range.provider !== "all" && record.providerId !== range.provider) return null;
    const date = range.dateInRange(record.timestamp);
    if (date === null) return null;
    if (record.dedupeKey !== null) {
      if (seen.has(record.dedupeKey)) return null;
      seen.add(record.dedupeKey);
    }
    return range.bucketDate(date);
  };
  const addModel = (record: ConsumptionRecord, values: ReturnType<typeof prepare>) => {
    const key = JSON.stringify([record.providerId, record.model]);
    const model = models.get(key) ?? { ...emptyConsumption(), providerId: record.providerId, model: record.model };
    add(model, values); models.set(key, model);
  };
  let processed = 0;
  const seen = new Set<string>();
  for (const record of records) {
    if (++processed % 128 === 0) yield;
    const date = eligible(record, seen);
    if (date === null) continue;
    const values = prepare(record);
    add(totals, values);
    const provider = providers.get(record.providerId) ?? { ...emptyConsumption(), providerId: record.providerId, model: null };
    add(provider, values); providers.set(record.providerId, provider);
    const bucket = bucketMap.get(date)!;
    add(bucket, values);
    let bucketProvider = bucket.providers.find((row) => row.providerId === record.providerId);
    if (!bucketProvider) { bucketProvider = { ...emptyConsumption(), providerId: record.providerId, model: null }; bucket.providers.push(bucketProvider); }
    add(bucketProvider, values);
    if (modelRecords === records) addModel(record, values);
  }
  const seenModels = new Set<string>();
  if (modelRecords !== records) for (const record of modelRecords) {
    if (++processed % 128 === 0) yield;
    if (eligible(record, seenModels) !== null) addModel(record, prepare(record));
  }
  const sort = (a: ConsumptionRow, b: ConsumptionRow) => (b.totalTokens ?? -1) - (a.totalTokens ?? -1)
    || a.providerId.localeCompare(b.providerId) || (a.model ?? "").localeCompare(b.model ?? "");
  return { totals, providers: [...providers.values()].sort(sort), models: [...models.values()].sort(sort), buckets };
}

/** Pure synchronous projection retained for small callers and parity tests. */
export function aggregateConsumption(
  records: ConsumptionRecord[], range: ResolvedDashboardRange, prices: ModelPrices, modelRecords = records,
): ConsumptionReport {
  return finishStatsWork(consumptionSteps(records, range, prices, modelRecords));
}

/** Production requests yield between batches so history cannot monopolize IPC. */
export function aggregateConsumptionAsync(
  records: ConsumptionRecord[], range: ResolvedDashboardRange, prices: ModelPrices, modelRecords = records,
): Promise<ConsumptionReport> {
  return runStatsWork(consumptionSteps(records, range, prices, modelRecords));
}

/** Keep turn totals authoritative. Model rows price multi-model turns without
 * guessing that all their tokens belonged to the turn's main model. */
function* mainsRecordSteps(rows: ActivityRow[]) {
  const records: ConsumptionRecord[] = [];
  const modelRecords: ConsumptionRecord[] = [];
  let processed = 0;
  for (const row of rows) {
    if (++processed % 128 === 0) yield;
    if (row.turnStatus !== "completed") continue;
    const fromUsage = (usage: UsageTotals, model: string | null): ConsumptionRecord => ({
      providerId: row.providerId, timestamp: row.activityAt, sessionId: row.runId, model,
      inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
      uncachedInputTokens: usage.inputTokens !== null && usage.cacheReadTokens !== null
        && (usage.cacheWriteTokens !== null || row.providerId === "codex")
        && usage.cacheReadTokens + (usage.cacheWriteTokens ?? 0) <= usage.inputTokens
        ? usage.inputTokens - usage.cacheReadTokens - (usage.cacheWriteTokens ?? 0) : null,
      cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens,
      // Copilot charges are credits, never USD or public-model API estimates.
      reportedCostUsd: row.providerId === "copilot_cli" ? null : usage.estimatedCostUsd, dedupeKey: null,
    });
    const entries = readModelEntries(row);
    const record = fromUsage(turnUsage(row, entries), row.model);
    const components = entries.map((entry) => fromUsage(modelEntryUsage(row, entry), entry.model));
    if (components.length > 0) record.components = components;
    records.push(record);
    for (const component of components.length > 0 ? components : [record]) modelRecords.push(component);
  }
  return { records, modelRecords };
}

export function mainsConsumptionRecords(rows: ActivityRow[]) {
  return finishStatsWork(mainsRecordSteps(rows));
}

export function mainsConsumptionRecordsAsync(rows: ActivityRow[]) {
  return runStatsWork(mainsRecordSteps(rows));
}
