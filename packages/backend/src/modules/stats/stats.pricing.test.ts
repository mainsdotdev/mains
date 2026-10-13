import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPricingLoader, estimateRecord, findModelPrice, parseModelPrices } from "./stats.pricing";
import type { ConsumptionRecord } from "./stats.transcripts";

const document = { "claude-test": { input_cost_per_token: 2, output_cost_per_token: 8,
  cache_read_input_token_cost: 0.2, cache_creation_input_token_cost: 2.5 } };
const record: ConsumptionRecord = { providerId: "claude_code", timestamp: 0, sessionId: "s", model: "claude-test",
  inputTokens: 150, uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 40, cacheWriteTokens: 10,
  reportedCostUsd: null, dedupeKey: null };
let root: string;

describe("API-equivalent estimates", () => {
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "mains-usage-prices-")); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it("prices every input category once and computes cache read savings", () => {
    expect(estimateRecord(record, parseModelPrices(document))).toEqual({ cost: 393, savings: 72, reported: false });
  });
  it("preserves provider-reported zero and unknown model prices", () => {
    expect(estimateRecord({ ...record, reportedCostUsd: 0 }, parseModelPrices(document))).toMatchObject({ cost: 0, reported: true });
    expect(estimateRecord({ ...record, model: "new-unpriced-model" }, parseModelPrices(document))).toEqual({ cost: null, savings: null, reported: false });
    expect(estimateRecord({ ...record, cacheReadTokens: null }, parseModelPrices(document))).toEqual({ cost: null, savings: null, reported: false });
  });
  it("does not require an absent legacy Codex write counter or charge inclusive cache twice", () => {
    expect(estimateRecord({ ...record, providerId: "codex", inputTokens: 100, uncachedInputTokens: 60, cacheWriteTokens: null }, parseModelPrices(document)))
      .toEqual({ cost: 288, savings: 72, reported: false });
  });
  it("does not guess family prices, ambiguous aliases, half-priced entries or negative rates", () => {
    const prices = parseModelPrices({
      "vendor-a/shared": { input_cost_per_token: 1, output_cost_per_token: 2 },
      "vendor-b/shared": { input_cost_per_token: 3, output_cost_per_token: 4 },
      "vendor/unique": { input_cost_per_token: 1, output_cost_per_token: 2 },
      opus: { input_cost_per_token: 1, output_cost_per_token: 2 },
      partial: { input_cost_per_token: 1 },
      negative: { input_cost_per_token: -1, output_cost_per_token: 2 },
    });
    expect(findModelPrice(prices, "shared")).toBeNull();
    expect(findModelPrice(prices, "vendor-a/shared")).not.toBeNull();
    expect(findModelPrice(prices, "unique")).not.toBeNull();
    expect(findModelPrice(prices, "opus")).toBeNull();
    expect(findModelPrice(prices, "partial")).toBeNull();
    expect(findModelPrice(prices, "negative")).toBeNull();
  });
  it("keeps unspecified cache prices unknown while preserving explicitly free prices", () => {
    const unknownCaches = parseModelPrices({ "claude-test": { input_cost_per_token: 2, output_cost_per_token: 8 } });
    expect(estimateRecord(record, unknownCaches)).toMatchObject({ cost: null, savings: null });
    expect(estimateRecord({ ...record, inputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 }, unknownCaches)).toMatchObject({ cost: 360, savings: 0 });
    const prices = parseModelPrices({ "claude-test": { input_cost_per_token: 0, output_cost_per_token: 0,
      cache_read_input_token_cost: 0, cache_creation_input_token_cost: 0 } });
    expect(estimateRecord(record, prices)).toEqual({ cost: 0, savings: 0, reported: false });
  });
  it("prices multi-model Mains turns by their components and preserves a recorded total", () => {
    const prices = parseModelPrices({ ...document, "second-model": { input_cost_per_token: 1, output_cost_per_token: 1,
      cache_read_input_token_cost: 1, cache_creation_input_token_cost: 1 } });
    const multi = { ...record, inputTokens: 300, outputTokens: 40, cacheReadTokens: 80, cacheWriteTokens: 20,
      model: null, components: [record, { ...record, model: "second-model" }] };
    expect(estimateRecord(multi, prices)).toEqual({ cost: 563, savings: 72, reported: false });
    expect(estimateRecord({ ...multi, reportedCostUsd: 12 }, prices)).toEqual({ cost: 12, savings: 72, reported: true });
    expect(estimateRecord({ ...multi, components: [record, { ...record, model: "unknown" }] }, prices)).toMatchObject({ cost: null, savings: null });
    expect(estimateRecord({ ...record, providerId: "copilot_cli", reportedCostUsd: 999 }, prices)).toMatchObject({ cost: null, savings: null });
    expect(estimateRecord({ ...multi, inputTokens: 999 }, prices)).toMatchObject({ cost: null, savings: null });
    expect(estimateRecord({ ...multi, inputTokens: 999, reportedCostUsd: 12 }, prices)).toMatchObject({ cost: 12, savings: null });
  });
  it("deduplicates price requests, persists a table and reuses it after restart", async () => {
    const cacheFile = path.join(root, "prices.json");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(document)));
    const loader = createPricingLoader(cacheFile, fetcher);
    const results = await Promise.all([loader.read(), loader.read()]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(results[0].pricing.status).toBe("fresh");
    await loader.read();
    expect(fetcher).toHaveBeenCalledOnce();
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    const restarted = await createPricingLoader(cacheFile, offline).read();
    expect(restarted.prices.get("claude-test")).toMatchObject({ input: 2 });
    expect(offline).not.toHaveBeenCalled();
  });
  it("retains an expired table offline and leaves costs unknown without any table", async () => {
    const cacheFile = path.join(root, "prices.json");
    await fs.writeFile(cacheFile, JSON.stringify({ fetchedAt: Date.now() - 2 * 24 * 60 * 60 * 1000, document }));
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    const cached = await createPricingLoader(cacheFile, offline).read();
    expect(cached.pricing.status).toBe("cached");
    expect(cached.prices.size).toBeGreaterThan(0);
    const empty = await createPricingLoader(path.join(root, "missing.json"), offline).read();
    expect(empty.pricing).toMatchObject({ status: "unavailable", fetchedAt: null });
    expect(estimateRecord(record, empty.prices).cost).toBeNull();
  });
});
