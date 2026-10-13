import fs from "node:fs/promises";
import path from "node:path";
import { getBackendRuntime } from "../../runtime/backend-runtime";
import type { UsagePricingStatus } from "./stats.dto";
import { measured, object, type ConsumptionRecord } from "./stats.transcripts";

export const MODEL_PRICES_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number | null;
  cacheWrite: number | null;
}
export type ModelPrices = ReadonlyMap<string, ModelPrice>;

export function parseModelPrices(document: unknown): ModelPrices {
  const prices = new Map<string, ModelPrice>();
  for (const [model, value] of Object.entries(object(document) ?? {})) {
    const row = object(value);
    const input = measured(row?.input_cost_per_token);
    const output = measured(row?.output_cost_per_token);
    if (input === null || output === null) continue;
    prices.set(model.trim().toLowerCase(), {
      input, output,
      cacheRead: measured(row?.cache_read_input_token_cost),
      cacheWrite: measured(row?.cache_creation_input_token_cost),
    });
  }
  // Only unambiguous qualified names may supply a missing bare model rate.
  const aliases = new Map<string, ModelPrice | null>();
  for (const [model, price] of prices) {
    const bare = model.slice(model.lastIndexOf("/") + 1);
    if (prices.has(bare)) continue;
    const previous = aliases.get(bare);
    aliases.set(bare, previous === undefined ? price
      : previous === null || JSON.stringify(previous) !== JSON.stringify(price) ? null : previous);
  }
  for (const [model, price] of aliases) if (price !== null) prices.set(model, price);
  return prices;
}

export function findModelPrice(prices: ModelPrices, model: string | null): ModelPrice | null {
  if (!model) return null;
  const key = model.trim().toLowerCase().replace(/\[[^\]]*\]$/, "");
  // A family alias does not identify a generation. Never guess its price.
  if (["opus", "sonnet", "haiku", "fable", "<synthetic>", "synthetic"].includes(key.slice(key.lastIndexOf("/") + 1))) return null;
  return prices.get(key) ?? null;
}

export function estimateRecord(record: ConsumptionRecord, prices: ModelPrices): {
  cost: number | null; savings: number | null; reported: boolean;
} {
  if (record.providerId === "copilot_cli") return { cost: null, savings: null, reported: false };
  if (record.components?.length) {
    const reconciled = (["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"] as const).every((key) =>
      record[key] === null || record.components!.every((component) => component[key] !== null)
        && record.components!.reduce((sum, component) => sum + component[key]!, 0) === record[key]);
    if (!reconciled) return { cost: record.reportedCostUsd, savings: null, reported: record.reportedCostUsd !== null };
    const estimates = record.components.map((component) => estimateRecord(component, prices));
    return {
      cost: record.reportedCostUsd ?? (estimates.every((estimate) => estimate.cost !== null)
        ? estimates.reduce((sum, estimate) => sum + estimate.cost!, 0) : null),
      savings: estimates.every((estimate) => estimate.savings !== null)
        ? estimates.reduce((sum, estimate) => sum + estimate.savings!, 0) : null,
      reported: record.reportedCostUsd !== null,
    };
  }
  const price = findModelPrice(prices, record.model);
  const read = record.cacheReadTokens;
  const savings = price && read !== null ? read === 0 ? 0
    : price.cacheRead !== null ? read * (price.input - price.cacheRead) : null : null;
  if (record.reportedCostUsd !== null) return { cost: record.reportedCostUsd, savings, reported: true };
  const write = record.cacheWriteTokens;
  // Codex's legacy schema reports no separate writes; those tokens are already
  // inside normal inclusive input. Claude needs every separate input category.
  const canPrice = price && record.uncachedInputTokens !== null && record.outputTokens !== null
    && read !== null && (read === 0 || price.cacheRead !== null)
    && (write !== null || record.providerId === "codex")
    && ((write ?? 0) === 0 || price.cacheWrite !== null);
  const cost = canPrice ? record.uncachedInputTokens! * price!.input
    + record.outputTokens! * price!.output + read! * (price!.cacheRead ?? 0) + (write ?? 0) * (price!.cacheWrite ?? 0) : null;
  return { cost, savings, reported: false };
}

/** One loader per host, with a disk snapshot so offline dashboards still work. */
export function createPricingLoader(cacheFile: string, fetchPrices: typeof fetch = fetch) {
  let prices: ModelPrices = new Map();
  let fetchedAt: number | null = null;
  let nextAttempt = 0;
  let loadedDisk = false;
  let pending: Promise<{ prices: ModelPrices; pricing: UsagePricingStatus }> | null = null;
  const snapshot = (): { prices: ModelPrices; pricing: UsagePricingStatus } => ({
    prices,
    pricing: { status: fetchedAt === null ? "unavailable" : Date.now() - fetchedAt < DAY_MS ? "fresh" : "cached",
      source: MODEL_PRICES_URL, fetchedAt: fetchedAt === null ? null : new Date(fetchedAt).toISOString() },
  });
  const load = async () => {
    if (!loadedDisk) {
      loadedDisk = true;
      try {
        const saved = object(JSON.parse(await fs.readFile(cacheFile, "utf8")));
        const savedAt = measured(saved?.fetchedAt);
        const parsed = parseModelPrices(saved?.document);
        if (savedAt !== null && savedAt <= Date.now() && parsed.size > 0) { prices = parsed; fetchedAt = savedAt; }
      } catch { /* A missing or corrupt price cache does not affect token history. */ }
    }
    if ((fetchedAt !== null && Date.now() - fetchedAt < DAY_MS) || Date.now() < nextAttempt) return snapshot();
    nextAttempt = Date.now() + 60_000;
    try {
      const response = await fetchPrices(MODEL_PRICES_URL, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) return snapshot();
      const document: unknown = await response.json();
      const parsed = parseModelPrices(document);
      if (!parsed.size) return snapshot();
      prices = parsed; fetchedAt = Date.now();
      try {
        await fs.mkdir(path.dirname(cacheFile), { recursive: true });
        const temporary = `${cacheFile}.tmp`;
        await fs.writeFile(temporary, JSON.stringify({ fetchedAt, document }), { mode: 0o600 });
        await fs.rename(temporary, cacheFile);
      } catch { /* A read-only cache location only affects the next launch. */ }
    } catch { /* A cached table or unpriced metrics are valid offline states. */ }
    return snapshot();
  };
  return { read: () => {
    pending ??= load().finally(() => { pending = null; });
    return pending;
  } };
}

let hostLoader: ReturnType<typeof createPricingLoader> | undefined;
export function readUsagePrices() {
  hostLoader ??= createPricingLoader(path.join(getBackendRuntime().getPath("userData"), "usage", "model-prices.json"));
  return hostLoader.read();
}
