import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import { createRun, createRunTurn } from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";
import type { CliHistorySource } from "./stats.dto";
import type { ConsumptionRecord } from "./stats.transcripts";
import { parseModelPrices } from "./stats.pricing";

let db: DatabaseInstance;
let cleanup: () => void;
const mocks = vi.hoisted(() => ({ scan: vi.fn(), prices: vi.fn() }));
vi.mock("../../db/client", () => ({ getDb: () => db }));
vi.mock("./stats.cli-history", () => ({
  cliHistoryScanner: { read: mocks.scan },
  cliHistorySources: () => [{ providerId: "claude_code", directories: ["/claude/projects"] },
    { providerId: "codex", directories: ["/codex/sessions"] }],
}));
vi.mock("./stats.pricing", async (importOriginal) => ({ ...await importOriginal<typeof import("./stats.pricing")>(), readUsagePrices: mocks.prices }));
import { statsService } from "./stats.service";

const now = new Date("2026-10-11T12:00:00Z");
const query = { period: "week" as const, timeZone: "Europe/Istanbul" };
const sources: CliHistorySource[] = [{ providerId: "codex", directories: ["/codex/sessions"], status: "available",
  scannedFiles: 1, unreadableFiles: 0, skippedLines: 0 }];
const record: ConsumptionRecord = { providerId: "codex", timestamp: Date.parse("2026-10-10T22:00:00Z") / 1000,
  sessionId: "native-session", model: "gpt-recorded", inputTokens: 100, uncachedInputTokens: 60,
  outputTokens: 20, cacheReadTokens: 40, cacheWriteTokens: null, reportedCostUsd: null, dedupeKey: null };

describe("dashboard consumption service", () => {
  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
    mocks.scan.mockReset().mockResolvedValue({ records: [record], sources });
    mocks.prices.mockReset().mockResolvedValue({ prices: parseModelPrices({
      "gpt-recorded": { input_cost_per_token: 2, output_cost_per_token: 8, cache_read_input_token_cost: 0.2 },
    }), pricing: { status: "fresh", source: "price-table", fetchedAt: now.toISOString() } });
    createRun(db, { id: "mains", providerId: "codex", createdAt: new Date("2024-01-01T00:00:00Z") });
    createRunTurn(db, { runId: "mains", startedAt: new Date(record.timestamp * 1000), status: "completed",
      model: "gpt-recorded", inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, cacheWriteTokens: null, costMicros: null });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("returns overlapping CLI and Mains usage as separate reports, including a continued old run", async () => {
    const report = await statsService.getConsumption(query);
    expect(report.cli.totals).toMatchObject({ totalTokens: 120, estimatedCostUsd: 288, cacheSavingsUsd: 72 });
    expect(report.mains.totals).toMatchObject({ totalTokens: 120, estimatedCostUsd: 288, cacheSavingsUsd: 72 });
    expect(report.mains.buckets.at(-1)).toMatchObject({ date: "2026-10-11", totalTokens: 120 });
    const recorded = await statsService.getDashboard(query);
    expect(recorded.summary.estimatedCostUsd).toBeNull();
    expect(recorded.summary.totalTokens).toBe(120);
  });
  it("applies the provider filter to both the scan and Mains report", async () => {
    const report = await statsService.getConsumption({ ...query, provider: "claude_code" });
    expect(mocks.scan.mock.lastCall?.[0]).toEqual([{ providerId: "claude_code", directories: ["/claude/projects"] }]);
    expect(report.cli.totals.records).toBe(0);
    expect(report.mains.totals.records).toBe(0);
  });
  it("still returns Mains estimates when no CLI history directory exists", async () => {
    mocks.scan.mockResolvedValue({ records: [], sources: [{ ...sources[0], status: "missing", scannedFiles: 0 }] });
    const report = await statsService.getConsumption(query);
    expect(report.cli.totals).toMatchObject({ totalTokens: null, estimatedCostUsd: null });
    expect(report.mains.totals.estimatedCostUsd).toBe(288);
    expect(report.sources[0].status).toBe("missing");
  });
  it("still returns both token scopes with unknown cost when pricing is unavailable", async () => {
    mocks.prices.mockResolvedValue({ prices: new Map(), pricing: { status: "unavailable", source: "price-table", fetchedAt: null } });
    const report = await statsService.getConsumption(query);
    for (const scope of [report.cli, report.mains]) {
      expect(scope.totals).toMatchObject({ totalTokens: 120, estimatedCostUsd: null, cacheSavingsUsd: null });
    }
  });
  it("validates queries before scanning personal history", async () => {
    await expect(statsService.getConsumption({ ...query, timeZone: "invalid-zone" })).rejects.toThrow("Invalid dashboard time zone");
    expect(mocks.scan).not.toHaveBeenCalled();
  });
});
