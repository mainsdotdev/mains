import { PROVIDER_IDS } from "@mains/contracts/provider-ids";

export type CliProviderId = "claude_code" | "codex";

/** Thin usage projection only: prompt, response and tool bodies never enter a
 * cache or the dashboard wire payload. Input is inclusive of cached tokens. */
export interface ConsumptionRecord {
  providerId: string;
  timestamp: number;
  sessionId: string;
  model: string | null;
  inputTokens: number | null;
  uncachedInputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reportedCostUsd: number | null;
  dedupeKey: string | null;
  /** Per-model pricing for a Mains turn that used several models. */
  components?: ConsumptionRecord[];
}

export function measured(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export interface CodexTranscriptState {
  sessionId: string;
  model: string | null;
  initialized: boolean;
  forkAnchor: number | null;
  lastSignature: string | null;
}

export function initialCodexState(): CodexTranscriptState {
  return { sessionId: "", model: null, initialized: false, forkAnchor: null, lastSignature: null };
}

/** Decode a usage line while also tracking Codex's model/session metadata. */
export function parseTranscriptLine(
  line: string, providerId: CliProviderId, state: CodexTranscriptState,
): ConsumptionRecord | null {
  // Most log lines are tool bodies. Avoid allocating their parsed JSON.
  if (providerId === PROVIDER_IDS.claude ? !line.includes('"usage"')
    : !line.includes('"token_count"') && !line.includes('"turn_context"') && !line.includes('"session_meta"')) return null;
  const row = object(JSON.parse(line));
  if (!row) return null;
  const timestampMs = typeof row.timestamp === "string" ? Date.parse(row.timestamp) : NaN;
  const timestamp = timestampMs / 1000;

  if (providerId === PROVIDER_IDS.claude) {
    if (row.type !== "assistant" || !Number.isFinite(timestamp)) return null;
    const message = object(row.message);
    const usage = object(message?.usage);
    if (!usage) return null;
    const input = measured(usage.input_tokens);
    const read = measured(usage.cache_read_input_tokens);
    const write = measured(usage.cache_creation_input_tokens);
    const id = text(message?.id);
    const request = text(row.requestId);
    return {
      providerId, timestamp, sessionId: text(row.sessionId) ?? "", model: text(message?.model),
      inputTokens: input !== null && read !== null && write !== null ? input + read + write : null,
      uncachedInputTokens: input, outputTokens: measured(usage.output_tokens),
      cacheReadTokens: read, cacheWriteTokens: write, reportedCostUsd: measured(row.costUSD),
      dedupeKey: id || request ? JSON.stringify([providerId, id, request]) : null,
    };
  }

  const payload = object(row.payload);
  if (!payload) return null;
  if (row.type === "session_meta") {
    // Copied ancestor metadata in a fork must not replace this file's identity.
    if (state.initialized) return null;
    state.initialized = true;
    state.sessionId = text(payload.id) ?? text(payload.session_id) ?? "";
    const spawn = object(object(object(payload.source)?.subagent)?.thread_spawn);
    if ((text(payload.forked_from_id) || text(spawn?.parent_thread_id)) && Number.isFinite(timestamp)) {
      state.forkAnchor = timestamp;
    }
    return null;
  }
  if (row.type === "turn_context") {
    state.model = text(payload.model) ?? state.model;
    return null;
  }
  if (payload.type !== "token_count" || !Number.isFinite(timestamp)) return null;
  const info = object(payload.info);
  const usage = object(info?.last_token_usage);
  if (!usage) return null;
  if (state.forkAnchor !== null) {
    // Forks re-stamp a burst of copied history. It was already counted in the
    // parent's log; the first event separated by a real turn ends the burst.
    if (timestamp - state.forkAnchor < 1) {
      state.forkAnchor = timestamp;
      return null;
    }
    state.forkAnchor = null;
  }
  // Include the cumulative counter: consecutive genuine turns can have equal
  // deltas, whereas retransmitted snapshots repeat both counters.
  const signature = JSON.stringify([info?.total_token_usage ?? null, usage]);
  if (signature === state.lastSignature) return null;
  state.lastSignature = signature;
  const input = measured(usage.input_tokens);
  const read = measured(usage.cached_input_tokens);
  const write = measured(usage.cache_write_input_tokens);
  return {
    providerId, timestamp, sessionId: state.sessionId, model: state.model,
    inputTokens: input,
    // Older Codex schemas have no separate cache-write counter; their remaining
    // inclusive input is normal input. The missing write metric stays null.
    uncachedInputTokens: input !== null && read !== null && read + (write ?? 0) <= input
      ? input - read - (write ?? 0) : null,
    outputTokens: measured(usage.output_tokens), cacheReadTokens: read, cacheWriteTokens: write,
    reportedCostUsd: null, dedupeKey: null,
  };
}
