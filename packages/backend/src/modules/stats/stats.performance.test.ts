import { describe, expect, it, vi } from "vitest";
import type { ConsumptionRecord } from "./stats.transcripts";

const mocks = vi.hoisted(() => ({ scan: vi.fn(), activity: vi.fn() }));
vi.mock("./stats.repo", () => ({ statsRepo: { listActivityRows: mocks.activity } }));
vi.mock("./stats.cli-history", () => ({
  cliHistoryScanner: { read: mocks.scan },
  cliHistorySources: () => [{ providerId: "codex", directories: ["/codex/sessions"] }],
}));
vi.mock("./stats.pricing", async (importOriginal) => ({
  ...await importOriginal<typeof import("./stats.pricing")>(),
  readUsagePrices: async () => ({ prices: new Map(), pricing: { status: "unavailable", source: "prices", fetchedAt: null } }),
}));
import { statsService } from "./stats.service";

function history(size: number): ConsumptionRecord[] {
  const timestamp = Math.floor(Date.now() / 1000) - 60;
  return Array.from({ length: size }, (_, index) => ({
    providerId: "codex", timestamp, sessionId: `session-${index % 100}`, model: "gpt-test",
    inputTokens: 100, outputTokens: 20, uncachedInputTokens: 20, cacheReadTokens: 80,
    cacheWriteTokens: null, reportedCostUsd: null, dedupeKey: `record-${index}`,
  }));
}

describe("dashboard consumption responsiveness", () => {
  it("lets queued main-process work run while aggregating a large history", async () => {
    mocks.scan.mockResolvedValue({ records: history(20_000), sources: [] });
    mocks.activity.mockResolvedValue([]);
    let heartbeat = false;
    const queued = new Promise<void>((resolve) => setImmediate(() => { heartbeat = true; resolve(); }));
    const result = await statsService.getConsumption({ period: "year", timeZone: "UTC" });
    const responded = heartbeat;
    await queued;
    expect(result.cli.totals.totalTokens).toBe(2_400_000);
    expect(responded).toBe(true);
  });

  it("shares concurrent identical requests instead of queuing duplicate scans", async () => {
    mocks.scan.mockReset();
    let finish!: (value: { records: ConsumptionRecord[]; sources: [] }) => void;
    mocks.scan.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    mocks.activity.mockResolvedValue([]);
    const first = statsService.getConsumption({ period: "week", timeZone: "UTC" });
    const second = statsService.getConsumption({ period: "week", timeZone: "UTC" });
    finish({ records: [], sources: [] });
    await Promise.all([first, second]);
    expect(mocks.scan).toHaveBeenCalledOnce();
    await statsService.getConsumption({ period: "week", timeZone: "UTC" });
    expect(mocks.scan).toHaveBeenCalledTimes(2);
  });

  it("releases a failed request so a retry can scan again", async () => {
    mocks.scan.mockReset().mockRejectedValueOnce(new Error("History unavailable"));
    mocks.activity.mockResolvedValue([]);
    const query = { period: "month" as const, timeZone: "UTC" };
    await expect(statsService.getConsumption(query)).rejects.toThrow("History unavailable");
    mocks.scan.mockResolvedValue({ records: history(1), sources: [] });
    expect((await statsService.getConsumption(query)).cli.totals.totalTokens).toBe(120);
    expect(mocks.scan).toHaveBeenCalledTimes(2);
  });

  it("keeps different provider requests independent while they overlap", async () => {
    mocks.scan.mockReset().mockResolvedValue({ records: history(1), sources: [] });
    mocks.activity.mockResolvedValue([]);
    const [all, claude] = await Promise.all([
      statsService.getConsumption({ period: "week", timeZone: "UTC" }),
      statsService.getConsumption({ period: "week", timeZone: "UTC", provider: "claude_code" }),
    ]);
    expect(mocks.scan).toHaveBeenCalledTimes(2);
    expect(all.cli.totals.totalTokens).toBe(120);
    expect(claude.cli.totals.totalTokens).toBeNull();
  });
});
