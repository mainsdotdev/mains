import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import { createRun, createRunTurn, createToolCall, createProject, createWorkspace } from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";
import { runTurns } from "../../db/schema";
import { PROVIDER_IDS } from "@mains/contracts/provider-ids";
import type { ProviderId } from "@mains/contracts/provider-ids";

let db: DatabaseInstance;
let cleanup: () => void;
vi.mock("../../db/client", () => ({ getDb: () => db }));
import { statsService } from "./stats.service";

const now = new Date("2026-10-11T12:00:00Z");
const week = { period: "week" as const, timeZone: "Europe/Istanbul" };

function turn(id: string, providerId: ProviderId, date = "2026-10-10T12:00:00Z",
  overrides: Partial<typeof runTurns.$inferInsert> = {}) {
  createRun(db, { id, providerId, createdAt: new Date("2024-01-01T00:00:00Z"), status: "succeeded" });
  return createRunTurn(db, {
    runId: id, status: "completed", startedAt: new Date(date), createdAt: new Date(date),
    inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, cacheWriteTokens: 10,
    model: "recorded-model", ...overrides,
  });
}

describe("statsService dashboard", () => {
  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("returns calendar buckets and null usage when nothing is reported", async () => {
    const data = await statsService.getDashboard(week);
    expect(data.range).toMatchObject({ startDate: "2026-10-05", endDate: "2026-10-11", granularity: "day" });
    expect(data.summary).toMatchObject({ totalTurns: 0, totalSessions: 0, totalTokens: null, estimatedCostUsd: null });
    expect(data.tokenUsage.map((bucket) => bucket.date)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
    expect(data.tokenUsage.every((bucket) => bucket.totalTokens === null)).toBe(true);
    expect(data.dailyActivity.every((day) => day.codex === 0)).toBe(true);
    expect(data.providerUsage).toEqual([]);
    expect(data.recentSessions).toEqual([]);
  });

  it("includes a recent continuation of an old session, using client-local dates and hours", async () => {
    turn("old", PROVIDER_IDS.codex, "2026-10-04T21:00:00Z", { turnIndex: 1, costMicros: 0 });
    turn("old", PROVIDER_IDS.codex, "2026-10-10T22:00:00Z", { turnIndex: 2 });
    turn("outside", PROVIDER_IDS.codex, "2026-10-04T20:59:59Z");
    turn("future", PROVIDER_IDS.codex, "2026-10-11T12:00:01Z");
    const data = await statsService.getDashboard(week);
    expect(data.summary).toMatchObject({ totalTurns: 2, totalSessions: 1, totalTokens: 240, estimatedCostUsd: 0, costReportedTurns: 1 });
    expect(data.dailyActivity[0].codex).toBe(1);
    expect(data.dailyActivity[6].codex).toBe(1);
    expect(data.hourDistribution[0].count).toBe(1);
    expect(data.hourDistribution[1].count).toBe(1);
    expect(data.recentSessions[0]).toMatchObject({ runId: "old", totalTokens: 240, lastActivityAt: Date.parse("2026-10-10T22:00:00Z") / 1000 });
    expect(data.statusBreakdown.totalSucceeded).toBe(1);
    expect(data.statusBreakdown.days[6].succeeded).toBe(1);
  });

  it("normalizes Claude's separate cache tokens while not double-counting inclusive input", async () => {
    turn("claude", PROVIDER_IDS.claude);
    turn("codex", PROVIDER_IDS.codex);
    turn("copilot", PROVIDER_IDS.copilot);
    const data = await statsService.getDashboard(week);
    expect(data.summary).toMatchObject({ inputTokens: 350, outputTokens: 60, totalTokens: 410, tokenReportedTurns: 3, estimatedCostUsd: null });
    expect(data.providerUsage.find((provider) => provider.providerId === PROVIDER_IDS.claude)?.totalTokens).toBe(170);
    expect(data.providerUsage.find((provider) => provider.providerId === PROVIDER_IDS.codex)?.totalTokens).toBe(120);
    expect(data.providerUsage.find((provider) => provider.providerId === PROVIDER_IDS.copilot)?.totalTokens).toBe(120);
  });

  it("preserves measured zero and exposes partial coverage without fabricating unknown usage", async () => {
    turn("zero", PROVIDER_IDS.claude, undefined, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicros: 0, elapsedMs: 0 });
    turn("missing", PROVIDER_IDS.cursor, undefined, { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null });
    const data = await statsService.getDashboard(week);
    expect(data.summary).toMatchObject({ totalTokens: 0, estimatedCostUsd: 0, durationMs: 0, completedTurns: 2, tokenReportedTurns: 1, costReportedTurns: 1 });
    expect(data.providerUsage.find((provider) => provider.providerId === PROVIDER_IDS.cursor)?.totalTokens).toBeNull();
    expect(data.recentSessions.find((session) => session.runId === "missing")?.estimatedCostUsd).toBeNull();
  });

  it("does not include active turns in consumption totals", async () => {
    turn("active", PROVIDER_IDS.codex, undefined, { status: "active", inputTokens: 500, costMicros: 2_000_000 });
    const data = await statsService.getDashboard(week);
    expect(data.summary).toMatchObject({ totalTurns: 1, completedTurns: 0, totalTokens: null, estimatedCostUsd: null });
    expect(data.providerUsage[0].turns).toBe(1);
  });

  it("distinguishes no report from an incomplete report", async () => {
    turn("partial-codex", PROVIDER_IDS.codex, undefined, { outputTokens: null });
    turn("partial-claude", PROVIDER_IDS.claude, undefined, { cacheReadTokens: null });
    const data = await statsService.getDashboard(week);
    expect(data.summary).toMatchObject({ totalTokens: null, inputTokens: null, outputTokens: null, completedTurns: 2, tokenReportedTurns: 0 });
  });

  it("recovers legacy usage and recorded canonical model names from model JSON", async () => {
    turn("legacy", PROVIDER_IDS.claude, undefined, {
      inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, model: null,
      modelUsage: JSON.stringify({ default: { canonicalModel: "claude-recorded-version", inputTokens: 5, outputTokens: 10, cacheReadInputTokens: 50, cacheCreationInputTokens: 0, costUSD: 0.123456 } }),
    });
    const data = await statsService.getDashboard(week);
    expect(data.summary).toMatchObject({ inputTokens: 55, outputTokens: 10, totalTokens: 65, estimatedCostUsd: 0.123456 });
    expect(data.modelUsage[0]).toMatchObject({ providerId: PROVIDER_IDS.claude, model: "claude-recorded-version", totalTokens: 65 });
  });

  it("does not reinterpret Codex placeholders or Copilot costs as USD", async () => {
    const modelUsage = JSON.stringify({ model: { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 40, cacheCreationInputTokens: 0, costUSD: 0 } });
    turn("codex", PROVIDER_IDS.codex, undefined, { modelUsage });
    turn("copilot", PROVIDER_IDS.copilot, undefined, { modelUsage, costMicros: 999_000_000 });
    const data = await statsService.getDashboard(week);
    expect(data.summary.estimatedCostUsd).toBeNull();
    expect(data.modelUsage.every((model) => model.estimatedCostUsd === null)).toBe(true);
    expect(data.summary.costReportedTurns).toBe(0);
  });

  it("groups identical model ids by provider and counts multiple aliases once per turn", async () => {
    const entry = { canonicalModel: "same-model", inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.01 };
    turn("claude", PROVIDER_IDS.claude, undefined, { modelUsage: JSON.stringify({ default: entry, alias: entry }) });
    turn("copilot", PROVIDER_IDS.copilot, undefined, { modelUsage: JSON.stringify({ default: entry }) });
    const data = await statsService.getDashboard(week);
    expect(data.modelUsage).toHaveLength(2);
    expect(data.modelUsage.find((model) => model.providerId === PROVIDER_IDS.claude)).toMatchObject({ model: "same-model", turns: 1, completedTurns: 1, tokenReportedTurns: 1, totalTokens: 30 });
  });

  it("uses recorded turn model ids, preserves unknown models and tolerates malformed JSON", async () => {
    turn("unknown", PROVIDER_IDS.codex, undefined, { model: null, modelUsage: "{broken" });
    turn("recorded", PROVIDER_IDS.codex, undefined, { model: "default" });
    const data = await statsService.getDashboard(week);
    expect(data.modelUsage.map((model) => model.model)).toEqual(expect.arrayContaining([null, "default"]));
    expect(data.summary.totalTokens).toBe(240);
  });

  it("applies the same provider and period to all activity, tools, status and recents", async () => {
    turn("claude", PROVIDER_IDS.claude);
    turn("codex", PROVIDER_IDS.codex);
    createToolCall(db, { runId: "claude", toolName: "Read", startedAt: new Date("2026-10-10T00:00:00Z") });
    createToolCall(db, { runId: "codex", toolName: "Write", startedAt: new Date("2026-10-10T00:00:00Z") });
    createToolCall(db, { runId: "claude", toolName: "Old", startedAt: new Date("2026-10-01T00:00:00Z") });
    const data = await statsService.getDashboard({ ...week, provider: PROVIDER_IDS.claude });
    expect(data.summary.totalTurns).toBe(1);
    expect(data.providerUsage.map((provider) => provider.providerId)).toEqual([PROVIDER_IDS.claude]);
    expect(data.modelUsage.map((model) => model.providerId)).toEqual([PROVIDER_IDS.claude]);
    expect(data.toolUsage).toEqual([{ toolName: "Read", count: 1 }]);
    expect(data.recentSessions.map((session) => session.runId)).toEqual(["claude"]);
    expect(data.hourDistribution.reduce((sum, hour) => sum + hour.count, 0)).toBe(1);
    expect(data.statusBreakdown.totalSucceeded).toBe(1);
  });

  it("returns 30 calendar days and 12 correctly aligned monthly buckets", async () => {
    turn("included", PROVIDER_IDS.codex, "2025-10-31T22:00:00Z");
    turn("excluded", PROVIDER_IDS.codex, "2025-10-31T20:59:59Z");
    const month = await statsService.getDashboard({ timeZone: week.timeZone });
    expect(month.tokenUsage).toHaveLength(30);
    expect(month.range.startDate).toBe("2026-09-12");
    const year = await statsService.getDashboard({ period: "year", timeZone: week.timeZone });
    expect(year.tokenUsage).toHaveLength(12);
    expect(year.range).toMatchObject({ startDate: "2025-11-01", granularity: "month" });
    expect(year.tokenUsage[0]).toMatchObject({ date: "2025-11-01", totalTokens: 120 });
    expect(year.tokenUsage[11]).toMatchObject({ date: "2026-10-01", totalTokens: null });
    expect(year.summary.totalSessions).toBe(1);
    expect(year.tokenActivity).toHaveLength(345);
    expect(year.tokenActivity[0]).toMatchObject({ date: "2025-11-01", totalTokens: 120, completedTurns: 1 });
    expect(year.tokenActivity.at(-1)).toMatchObject({ date: "2026-10-11", totalTokens: null, completedTurns: 0 });
    expect(year.tokenActivity.reduce((sum, day) => sum + (day.totalTokens ?? 0), 0)).toBe(year.summary.totalTokens);
    expect(month.tokenActivity).toEqual(month.tokenUsage);
  });

  it("keeps a session with no first turn visible without claiming zero consumption", async () => {
    createProject(db, { id: "project", name: "Example" });
    createWorkspace(db, { id: "workspace", projectId: "project" });
    createRun(db, { id: "waiting", providerId: PROVIDER_IDS.codex, workspaceId: "workspace", createdAt: now, status: "running" });
    const data = await statsService.getDashboard(week);
    expect(data.summary).toMatchObject({ totalSessions: 1, totalTurns: 0, totalTokens: null });
    expect(data.recentSessions[0]).toMatchObject({ projectName: "Example", totalTokens: null });
    expect(data.statusBreakdown.totalOther).toBe(1);
  });

  it("propagates repository errors to the IPC seam", async () => {
    const { statsRepo } = await import("./stats.repo");
    vi.spyOn(statsRepo, "listActivityRows").mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(statsService.getDashboard(week)).rejects.toThrow("Database unavailable");
  });
});
