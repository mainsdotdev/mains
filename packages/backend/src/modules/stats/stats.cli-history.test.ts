import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cliHistorySources, createCliHistoryScanner } from "./stats.cli-history";
import { aggregateConsumption } from "./stats.consumption";
import { resolveDashboardRange } from "./stats.range";

let root: string;
const line = (id: string, tokens = 10) => JSON.stringify({ type: "assistant", timestamp: "2026-10-10T23:30:00Z", sessionId: "one-session",
  message: { id, model: "claude-test", usage: { input_tokens: tokens, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });

describe("CLI history scanning", () => {
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "mains-cli-history-")); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it("follows default and custom homes, including archived Codex rollouts", () => {
    expect(cliHistorySources({}, "/example")).toEqual([
      { providerId: "claude_code", directories: ["/example/.claude/projects"] },
      { providerId: "codex", directories: ["/example/.codex/sessions", "/example/.codex/archived_sessions"] },
    ]);
    expect(cliHistorySources({ CLAUDE_CONFIG_DIR: "~/custom-claude", CODEX_HOME: "/custom/codex" }, "/example"))
      .toMatchObject([{ directories: ["/example/custom-claude/projects"] }, { directories: ["/custom/codex/sessions", "/custom/codex/archived_sessions"] }]);
  });

  it("reuses unchanged records and resumes growth, including an unfinished UTF-8 tail", async () => {
    const scanner = createCliHistoryScanner();
    const source = [{ providerId: "claude_code" as const, directories: [root] }];
    const file = path.join(root, "history.jsonl");
    const first = line("first");
    const second = line("second-üç");
    await fs.writeFile(file, first + "\n" + second.slice(0, 70));
    expect((await scanner.read(source)).records).toHaveLength(1);
    expect((await scanner.read(source)).records).toHaveLength(1);
    await fs.appendFile(file, second.slice(70) + "\n");
    const result = await scanner.read(source);
    expect(result.records).toHaveLength(2);
    expect(result.sources[0]).toMatchObject({ status: "available", scannedFiles: 1 });
    // Appending a newline after another partial record must not consume it twice.
    await fs.appendFile(file, line("third") + "\n");
    expect((await scanner.read(source)).records).toHaveLength(3);
  });

  it("does not reopen unchanged transcript files on a warm scan", async () => {
    const scanner = createCliHistoryScanner();
    const source = [{ providerId: "claude_code" as const, directories: [root] }];
    await fs.writeFile(path.join(root, "history.jsonl"), line("first") + "\n");
    await scanner.read(source);
    const open = vi.spyOn(fs, "open");
    try {
      expect((await scanner.read(source)).records).toHaveLength(1);
      expect(open).not.toHaveBeenCalled();
    } finally { open.mockRestore(); }
  });

  it("shares identical in-flight scans and allows a new scan after completion", async () => {
    const scanner = createCliHistoryScanner();
    const source = [{ providerId: "claude_code" as const, directories: [root] }];
    await fs.writeFile(path.join(root, "history.jsonl"), line("first") + "\n");
    const first = scanner.read(source);
    expect(scanner.read(source)).toBe(first);
    await first;
    await fs.appendFile(path.join(root, "history.jsonl"), line("second") + "\n");
    expect((await scanner.read(source)).records).toHaveLength(2);
  });

  it("excludes old usage in recently appended files without changing scan coverage", async () => {
    const scanner = createCliHistoryScanner();
    const old = line("old").replace("2026-10-10T23:30:00Z", "2024-01-01T00:00:00Z");
    await fs.writeFile(path.join(root, "history.jsonl"), old + "\n" + line("new") + "\n");
    const source = [{ providerId: "claude_code" as const, directories: [root] }];
    const report = await scanner.read(source, Date.parse("2026-10-05T00:00:00Z") / 1000);
    expect(report.records).toHaveLength(1);
    expect(report.sources[0]).toMatchObject({ status: "available", scannedFiles: 1 });
  });

  it("detects a replaced or rewritten file instead of retaining stale usage", async () => {
    const scanner = createCliHistoryScanner();
    const source = [{ providerId: "claude_code" as const, directories: [root] }];
    const file = path.join(root, "history.jsonl");
    await fs.writeFile(file, line("first", 10) + "\n");
    await scanner.read(source);
    await fs.writeFile(file, line("first", 20) + "\n");
    const future = new Date(Date.now() + 1000);
    await fs.utimes(file, future, future);
    expect((await scanner.read(source)).records[0].inputTokens).toBe(20);
    // Growth alone is insufficient: a changed prefix at the resume guard restarts parsing.
    await fs.writeFile(file, line("first", 30) + "\n" + line("second") + "\n");
    expect((await scanner.read(source)).records.map((record) => record.inputTokens)).toEqual([30, 10]);
    await fs.unlink(file);
    await fs.writeFile(file, line("replacement", 40) + "\n");
    expect((await scanner.read(source)).records.map((record) => record.inputTokens)).toEqual([40]);
  });

  it("deduplicates Claude content blocks and copied files while respecting client-local days", async () => {
    const scanner = createCliHistoryScanner();
    await fs.writeFile(path.join(root, "parent.jsonl"), line("same") + "\n" + line("same") + "\n");
    await fs.writeFile(path.join(root, "fork.jsonl"), line("same") + "\n" + line("new") + "\n");
    const history = await scanner.read([{ providerId: "claude_code", directories: [root, root] }]);
    const range = resolveDashboardRange({ period: "week", timeZone: "Europe/Istanbul" }, new Date("2026-10-11T12:00:00Z"));
    const report = aggregateConsumption(history.records, range, new Map());
    expect(history.sources[0].scannedFiles).toBe(2);
    expect(report.totals).toMatchObject({ totalTokens: 30, records: 2, sessions: 1, estimatedCostUsd: null });
    expect(report.buckets.at(-1)).toMatchObject({ date: "2026-10-11", totalTokens: 30 });
  });

  it("deduplicates archived copies of the same Codex rollout", async () => {
    const active = path.join(root, "sessions");
    const archived = path.join(root, "archived_sessions");
    await fs.mkdir(active); await fs.mkdir(archived);
    const transcript = [
      { type: "session_meta", payload: { id: "codex-native" } },
      { type: "turn_context", payload: { model: "gpt-test" } },
      { type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 20 } } } },
    ].map((row) => JSON.stringify({ ...row, timestamp: "2026-10-10T12:00:00Z" })).join("\n") + "\n";
    await fs.writeFile(path.join(active, "live.jsonl"), transcript);
    await fs.writeFile(path.join(archived, "copy.jsonl"), transcript);
    const scanner = createCliHistoryScanner();
    const source = [{ providerId: "codex" as const, directories: [active, archived] }];
    const history = await scanner.read(source);
    const range = resolveDashboardRange({ period: "week", timeZone: "UTC" }, new Date("2026-10-11T12:00:00Z"));
    expect(aggregateConsumption(history.records, range, new Map()).totals).toMatchObject({ records: 1, totalTokens: 120, sessions: 1 });
    expect((await scanner.read(source)).records[0]).toBe(history.records[0]);
    await fs.appendFile(path.join(active, "live.jsonl"), JSON.stringify({ timestamp: "2026-10-10T12:00:00Z", type: "event_msg",
      payload: { type: "token_count", info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 20 },
        total_token_usage: { input_tokens: 200, output_tokens: 40 } } } }) + "\n");
    expect(aggregateConsumption((await scanner.read(source)).records, range, new Map()).totals)
      .toMatchObject({ records: 2, totalTokens: 240, sessions: 1 });
  });

  it("reports absent roots and malformed usage as missing or partial", async () => {
    const scanner = createCliHistoryScanner();
    const missing = await scanner.read([{ providerId: "codex", directories: [path.join(root, "absent")] }]);
    expect(missing.sources[0].status).toBe("missing");
    expect(missing.records).toEqual([]);
    await fs.writeFile(path.join(root, "bad.jsonl"), '{"usage":broken}\n' + line("valid") + "\n");
    const partial = await scanner.read([{ providerId: "claude_code", directories: [root] }]);
    expect(partial.sources[0]).toMatchObject({ status: "partial", skippedLines: 1 });
    expect(partial.records).toHaveLength(1);
  });
});
