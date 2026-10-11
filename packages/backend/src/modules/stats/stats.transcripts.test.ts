import { describe, expect, it } from "vitest";
import { initialCodexState, parseTranscriptLine } from "./stats.transcripts";

const timestamp = "2026-10-10T12:00:00Z";
const claude = (usage: unknown) => JSON.stringify({ type: "assistant", timestamp, sessionId: "session",
  message: { id: "message", model: "claude-recorded", usage } });
const codex = (payload: unknown, type = "event_msg", time = timestamp) => JSON.stringify({ type, timestamp: time, payload });

describe("CLI transcript usage", () => {
  it("normalizes Claude's separate cache input and projects no conversation bodies", () => {
    const record = parseTranscriptLine(claude({ input_tokens: 10, output_tokens: 5,
      cache_read_input_tokens: 100, cache_creation_input_tokens: 20 }), "claude_code", initialCodexState());
    expect(record).toMatchObject({ inputTokens: 130, uncachedInputTokens: 10, outputTokens: 5,
      cacheReadTokens: 100, cacheWriteTokens: 20, model: "claude-recorded", sessionId: "session", reportedCostUsd: null });
    expect(record).not.toHaveProperty("message");
  });

  it("preserves measured zero without turning absent fields into zero", () => {
    expect(parseTranscriptLine(claude({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0 }), "claude_code", initialCodexState())).toMatchObject({ inputTokens: 0, outputTokens: 0 });
    expect(parseTranscriptLine(claude({ input_tokens: 10, output_tokens: 5 }), "claude_code", initialCodexState()))
      .toMatchObject({ inputTokens: null, uncachedInputTokens: 10, cacheReadTokens: null, cacheWriteTokens: null });
    expect(parseTranscriptLine(claude({ input_tokens: -10, output_tokens: 5, cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0 }), "claude_code", initialCodexState())).toMatchObject({ inputTokens: null });
  });

  it("reads Codex deltas with inclusive input and keeps reasoning inside output", () => {
    const state = initialCodexState();
    parseTranscriptLine(codex({ id: "native-id" }, "session_meta"), "codex", state);
    parseTranscriptLine(codex({ model: "gpt-recorded" }, "turn_context"), "codex", state);
    const record = parseTranscriptLine(codex({ type: "token_count", info: {
      last_token_usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 20, reasoning_output_tokens: 15 },
      total_token_usage: { total_tokens: 120 },
    } }), "codex", state);
    expect(record).toMatchObject({ inputTokens: 100, uncachedInputTokens: 20, cacheReadTokens: 80,
      cacheWriteTokens: null, outputTokens: 20, model: "gpt-recorded", sessionId: "native-id" });
  });

  it("drops retransmitted Codex snapshots but counts genuine equal turn deltas", () => {
    const state = initialCodexState();
    const info = { last_token_usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 },
      total_token_usage: { total_tokens: 15 } };
    expect(parseTranscriptLine(codex({ type: "token_count", info }), "codex", state)).not.toBeNull();
    expect(parseTranscriptLine(codex({ type: "token_count", info }), "codex", state)).toBeNull();
    expect(parseTranscriptLine(codex({ type: "token_count", info: { ...info, total_token_usage: { total_tokens: 30 } } }), "codex", state)).not.toBeNull();
  });

  it("uses the first session metadata and suppresses a fork's re-stamped parent history", () => {
    const state = initialCodexState();
    parseTranscriptLine(codex({ id: "child", forked_from_id: "parent" }, "session_meta"), "codex", state);
    parseTranscriptLine(codex({ id: "parent" }, "session_meta"), "codex", state);
    parseTranscriptLine(codex({ model: "new-model" }, "turn_context"), "codex", state);
    const payload = { type: "token_count", info: { last_token_usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } } };
    expect(parseTranscriptLine(codex(payload, "event_msg", "2026-10-10T12:00:00.050Z"), "codex", state)).toBeNull();
    expect(parseTranscriptLine(codex(payload, "event_msg", "2026-10-10T12:00:05Z"), "codex", state)).toMatchObject({ sessionId: "child", model: "new-model" });
  });

  it("rejects undated usage and ignores unrelated records", () => {
    const line = JSON.parse(claude({ input_tokens: 10 }));
    line.timestamp = "not a date";
    expect(parseTranscriptLine(JSON.stringify(line), "claude_code", initialCodexState())).toBeNull();
    expect(parseTranscriptLine('{"type":"user","message":"hello"}', "claude_code", initialCodexState())).toBeNull();
  });
});
