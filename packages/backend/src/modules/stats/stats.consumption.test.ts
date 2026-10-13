import { describe, expect, it } from "vitest";
import { aggregateConsumption, aggregateConsumptionAsync, mainsConsumptionRecords } from "./stats.consumption";
import { parseModelPrices } from "./stats.pricing";
import { resolveDashboardRange } from "./stats.range";
import type { ConsumptionRecord } from "./stats.transcripts";
import type { ActivityRow } from "./stats.repo";

const range = resolveDashboardRange({ period: "week", timeZone: "Europe/Istanbul" }, new Date("2026-10-11T12:00:00Z"));
const record: ConsumptionRecord = { providerId: "codex", timestamp: Date.parse("2026-10-10T22:00:00Z") / 1000,
  sessionId: "session", model: "gpt-test", inputTokens: 100, uncachedInputTokens: 60, outputTokens: 20,
  cacheReadTokens: 40, cacheWriteTokens: null, reportedCostUsd: null, dedupeKey: null };
const prices = parseModelPrices({ "gpt-test": { input_cost_per_token: 2, output_cost_per_token: 8, cache_read_input_token_cost: 0.2 } });

describe("scoped consumption reports", () => {
  it("preserves totals, missing metrics and deduplication across asynchronous batches", async () => {
    const records = Array.from({ length: 2000 }, (_, index) => ({ ...record,
      sessionId: `session-${index % 10}`, dedupeKey: `usage-${Math.floor(index / 2)}`,
      model: index % 4 === 0 ? "unpriced" : record.model,
      cacheReadTokens: index % 4 === 0 ? null : record.cacheReadTokens,
    }));
    const report = await aggregateConsumptionAsync(records, range, prices);
    expect(report).toEqual(aggregateConsumption(records, range, prices));
    expect(report.totals).toMatchObject({ records: 1000, sessions: 5, totalTokens: 120_000, costEstimatedRecords: 500 });
  });

  it("groups by client-local date, keeps sessions distinct and applies provider filtering", () => {
    const report = aggregateConsumption([record, { ...record, providerId: "claude_code", cacheWriteTokens: 0 }], range, prices);
    expect(report.totals).toMatchObject({ records: 2, sessions: 2, totalTokens: 240, estimatedCostUsd: 576, cacheSavingsUsd: 144 });
    expect(report.buckets.at(-1)).toMatchObject({ date: "2026-10-11", records: 2 });
    expect(report.models).toHaveLength(2);
    const codex = resolveDashboardRange({ provider: "codex", period: "week", timeZone: "Europe/Istanbul" }, new Date("2026-10-11T12:00:00Z"));
    expect(aggregateConsumption([record, { ...record, providerId: "claude_code" }], codex, prices).totals.totalTokens).toBe(120);
  });
  it("marks partial measurements and prices without inventing zero for unreported categories", () => {
    const report = aggregateConsumption([record, { ...record, model: "unknown", inputTokens: null, cacheReadTokens: null, uncachedInputTokens: null }], range, prices);
    expect(report.totals).toMatchObject({ records: 2, tokenReportedRecords: 1, costEstimatedRecords: 1,
      cacheSavingsEstimatedRecords: 1, totalTokens: 120, estimatedCostUsd: 288, cacheWriteTokens: null });
    expect(report.totals.reportedMetrics).toMatchObject({ outputTokens: 2, inputTokens: 1, cacheWriteTokens: 0, estimatedCostUsd: 1 });
    expect(report.models.find((row) => row.model === "unknown")).toMatchObject({ totalTokens: null, estimatedCostUsd: null, cacheSavingsUsd: null });
  });
  it("does not fabricate consumption for empty or out-of-period reports", () => {
    expect(aggregateConsumption([], range, prices).totals).toMatchObject({ sessions: 0, records: 0, totalTokens: null, estimatedCostUsd: null, cacheSavingsUsd: null });
    expect(aggregateConsumption([{ ...record, timestamp: Date.parse("2026-10-01T00:00:00Z") / 1000 },
      { ...record, timestamp: Date.parse("2026-10-11T12:00:01Z") / 1000 }], range, prices).totals.records).toBe(0);
  });
  it("projects Mains turns independently of identical CLI usage and does not mutate stored USD", () => {
    const row: ActivityRow = { runId: "mains-run", turnId: 1, providerId: "codex", title: "run", goal: null, status: "succeeded",
      projectName: null, activityAt: record.timestamp, turnStatus: "completed", inputTokens: 100, outputTokens: 20,
      cacheReadTokens: 40, cacheWriteTokens: null, costMicros: null, elapsedMs: 1000, model: "gpt-test", modelUsage: null };
    const mains = mainsConsumptionRecords([row, { ...row, turnId: 2, turnStatus: "active" }]);
    const cliReport = aggregateConsumption([record], range, prices);
    const mainsReport = aggregateConsumption(mains.records, range, prices, mains.modelRecords);
    expect(cliReport.totals.totalTokens).toBe(120);
    expect(mainsReport.totals).toMatchObject({ records: 1, sessions: 1, totalTokens: 120, estimatedCostUsd: 288, cacheSavingsUsd: 72 });
    expect(row.costMicros).toBeNull();
  });
  it("recovers the exact recorded Claude model and normalizes its Mains cache input", () => {
    const row: ActivityRow = { runId: "mains-run", turnId: 1, providerId: "claude_code", title: null, goal: null, status: "succeeded",
      projectName: null, activityAt: record.timestamp, turnStatus: "completed", inputTokens: null, outputTokens: null,
      cacheReadTokens: null, cacheWriteTokens: null, costMicros: 0, elapsedMs: null, model: "default",
      modelUsage: JSON.stringify({ default: { canonicalModel: "gpt-test", inputTokens: 60, outputTokens: 20,
        cacheReadInputTokens: 40, cacheCreationInputTokens: 0, costUSD: 0 } }) };
    const mains = mainsConsumptionRecords([row]);
    const report = aggregateConsumption(mains.records, range, prices, mains.modelRecords);
    expect(report.totals).toMatchObject({ totalTokens: 120, estimatedCostUsd: 0, cacheSavingsUsd: 72, providerReportedCostRecords: 1 });
    expect(report.models[0]).toMatchObject({ model: "gpt-test", totalTokens: 120 });
  });
});
