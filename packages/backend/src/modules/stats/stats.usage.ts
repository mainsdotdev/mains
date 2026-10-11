import { PROVIDER_IDS } from "@mains/contracts/provider-ids";
import type { UsageTotals } from "./stats.dto";
import type { ActivityRow } from "./stats.repo";

export function emptyUsage(): UsageTotals {
  return {
    inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
    totalTokens: null, estimatedCostUsd: null, durationMs: null,
    completedTurns: 0, tokenReportedTurns: 0, costReportedTurns: 0,
  };
}

function measured(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

type ModelEntry = { model: string; usage: Record<string, unknown> };

export function readModelEntries(row: ActivityRow): ModelEntry[] {
  if (!row.modelUsage) return [];
  try {
    const parsed: unknown = JSON.parse(row.modelUsage);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    return Object.entries(parsed).flatMap(([model, usage]) => {
      if (!usage || typeof usage !== "object" || Array.isArray(usage)) return [];
      const entry = usage as Record<string, unknown>;
      return [{ model: typeof entry.canonicalModel === "string" && entry.canonicalModel ? entry.canonicalModel : model, usage: entry }];
    });
  } catch {
    // A malformed legacy record must not hide the rest of the dashboard.
    return [];
  }
}

function sumReported(entries: ModelEntry[], key: string): number | null {
  if (!entries.length) return null;
  const values = entries.map((entry) => measured(entry.usage[key]));
  return values.every((value) => value !== null) ? values.reduce<number>((sum, value) => sum + value!, 0) : null;
}

function normalizeUsage(
  providerId: string, input: number | null, output: number | null,
  read: number | null, write: number | null, cost: number | null, duration: number | null,
): UsageTotals {
  // Claude reports uncached input separately. Codex/Copilot input is inclusive;
  // adding their cache count again would double-count those tokens.
  const inclusiveInput = providerId === PROVIDER_IDS.claude
    ? input !== null && read !== null && write !== null ? input + read + write : null
    : input;
  const hasTokens = inclusiveInput !== null && output !== null;
  return {
    inputTokens: hasTokens ? inclusiveInput : null, outputTokens: hasTokens ? output : null,
    cacheReadTokens: read, cacheWriteTokens: write,
    totalTokens: hasTokens ? inclusiveInput + output : null,
    estimatedCostUsd: cost, durationMs: duration, completedTurns: 1,
    tokenReportedTurns: hasTokens ? 1 : 0, costReportedTurns: cost !== null ? 1 : 0,
  };
}

export function turnUsage(row: ActivityRow, entries = readModelEntries(row)): UsageTotals {
  if (row.turnStatus !== "completed") return emptyUsage();
  const input = measured(row.inputTokens) ?? sumReported(entries, "inputTokens");
  const output = measured(row.outputTokens) ?? sumReported(entries, "outputTokens");
  const read = measured(row.cacheReadTokens) ?? sumReported(entries, "cacheReadInputTokens");
  const write = measured(row.cacheWriteTokens) ?? sumReported(entries, "cacheCreationInputTokens");
  // Copilot cost fields are not USD. Codex per-model costUSD is a placeholder.
  // Only Claude's model breakdown supplies a USD estimate.
  const cost = row.providerId === PROVIDER_IDS.copilot ? null
    : measured(row.costMicros) !== null ? row.costMicros! / 1_000_000
    : row.providerId === PROVIDER_IDS.claude ? sumReported(entries, "costUSD") : null;
  return normalizeUsage(row.providerId, input, output, read, write, cost, measured(row.elapsedMs));
}

export function modelEntryUsage(row: ActivityRow, entry: ModelEntry): UsageTotals {
  if (row.turnStatus !== "completed") return emptyUsage();
  return normalizeUsage(
    row.providerId, measured(entry.usage.inputTokens), measured(entry.usage.outputTokens),
    measured(entry.usage.cacheReadInputTokens), measured(entry.usage.cacheCreationInputTokens),
    row.providerId === PROVIDER_IDS.claude ? measured(entry.usage.costUSD) : null, null,
  );
}

export function addUsage(target: UsageTotals, usage: UsageTotals): void {
  const keys = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens", "estimatedCostUsd", "durationMs"] as const;
  for (const key of keys) {
    if (usage[key] !== null) target[key] = (target[key] ?? 0) + usage[key];
  }
  target.completedTurns += usage.completedTurns;
  target.tokenReportedTurns += usage.tokenReportedTurns;
  target.costReportedTurns += usage.costReportedTurns;
}
