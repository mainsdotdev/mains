import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createAsyncResourceLifecycle } from "../../runtime/async-resource-lifecycle";
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
  const cache = createAsyncResourceLifecycle<{ prices: ModelPrices; document: unknown }>({
    ttlMs: DAY_MS, retryMs: 60_000,
    async prepare() {
      try {
        const saved = object(JSON.parse(await fs.readFile(cacheFile, "utf8")));
        const fetchedAt = measured(saved?.fetchedAt);
        const prices = parseModelPrices(saved?.document);
        if (fetchedAt !== null && fetchedAt <= Date.now() && prices.size) return { value: { prices, document: saved?.document }, fetchedAt };
      } catch { /* Missing/corrupt snapshots leave pricing unavailable until refresh. */ }
      return undefined;
    },
    async load(_key, context) {
      const response = await fetchPrices(MODEL_PRICES_URL, { signal: AbortSignal.any([context.signal, AbortSignal.timeout(5_000)]) });
      context.assertCurrent();
      if (!response.ok) throw new Error(`Price refresh failed (${response.status}).`);
      const document: unknown = await response.json();
      context.assertCurrent();
      const prices = parseModelPrices(document);
      if (!prices.size) throw new Error("Price refresh returned no valid model rates.");
      return { prices, document };
    },
    async publish(_key, snapshot, context) {
      const temporary = `${cacheFile}.${randomUUID()}.tmp`;
      try {
        context.assertCurrent(); await fs.mkdir(path.dirname(cacheFile), { recursive: true }); context.assertCurrent();
        await fs.writeFile(temporary, JSON.stringify({ fetchedAt: snapshot.fetchedAt, document: snapshot.value.document }), { mode: 0o600 });
        context.assertCurrent(); await fs.rename(temporary, cacheFile);
      } catch { /* Read-only cache storage affects the next launch, not current prices. */ }
      finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
    },
  });
  return { async read() {
    const snapshot = await cache.read().catch(() => cache.peek());
    const fetchedAt = snapshot?.fetchedAt ?? null;
    return { prices: snapshot?.value.prices ?? new Map() as ModelPrices,
      pricing: { status: fetchedAt === null ? "unavailable" : Date.now() >= fetchedAt && Date.now() - fetchedAt < DAY_MS ? "fresh" : "cached",
        source: MODEL_PRICES_URL, fetchedAt: fetchedAt === null ? null : new Date(fetchedAt).toISOString() } as UsagePricingStatus };
  }, dispose: cache.dispose };
}

let hostLoader: { runtime: ReturnType<typeof getBackendRuntime>; cacheFile: string; loader: ReturnType<typeof createPricingLoader> } | undefined;
let pricingOpen = true;
export function startUsagePrices() { pricingOpen = true; }
export function shutdownUsagePrices() {
  pricingOpen = false; hostLoader?.loader.dispose(); hostLoader = undefined;
}
export function readUsagePrices() {
  if (!pricingOpen) return Promise.resolve({ prices: new Map() as ModelPrices,
    pricing: { status: "unavailable", source: MODEL_PRICES_URL, fetchedAt: null } as UsagePricingStatus });
  const runtime = getBackendRuntime();
  const cacheFile = path.join(runtime.getPath("userData"), "usage", "model-prices.json");
  if (!hostLoader || hostLoader.runtime !== runtime || hostLoader.cacheFile !== cacheFile) {
    hostLoader?.loader.dispose(); hostLoader = { runtime, cacheFile, loader: createPricingLoader(cacheFile) };
  }
  return hostLoader.loader.read();
}
