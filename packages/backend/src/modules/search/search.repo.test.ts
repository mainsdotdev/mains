import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";

let sqlite: Database.Database;
let cleanup: (() => void) | undefined;

vi.mock("../../db/client", () => ({
  getSqlite: () => sqlite,
}));

import { buildFtsQuery, searchRepo } from "./search.repo";

describe("searchRepo full-text chat search", () => {
  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    cleanup = testDb.cleanup;

    sqlite.exec(`
      INSERT INTO accounts(id) VALUES ('account-1'), ('account-2');
      INSERT INTO providers(id, kind, display_name)
      VALUES ('codex', 'agent_runtime', 'Codex');
      INSERT INTO runs(id, account_id, provider_id, title, is_archived, owner_backend_id) VALUES
        ('run-1', 'account-1', 'codex', 'Gyroscope', 0, 'test-backend'),
        ('run-2', 'account-1', 'codex', 'Physics notes', 0, 'test-backend'),
        ('run-other-account', 'account-2', 'codex', 'Private physics', 0, 'test-backend'),
        ('run-archived', 'account-1', 'codex', 'Old physics', 1, 'test-backend');
      INSERT INTO run_artifacts(run_id, kind, content, metadata) VALUES
        ('run-1', 'user-prompt', 'How does gyroscopic precession work?', '{}'),
        ('run-1', 'report', 'Precession reverses when the spin reverses.', '{}'),
        ('run-2', 'report', 'Increase gravity to accelerate precession.', '{}'),
        ('run-other-account', 'report', 'Private precession detail.', '{}'),
        ('run-archived', 'report', 'Archived precession detail.', '{}'),
        ('run-2', 'log', 'Diagnostic precession noise.', '{}');
    `);
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it("returns the best matching message once per visible account-scoped run", () => {
    const rows = searchRepo.findMessages({
      accountId: "account-1",
      query: "precess",
      limit: 10,
    });

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.id))).toEqual(
      new Set(["run-1", "run-2"]),
    );
    expect(rows.every((row) => row.matchSnippet.toLowerCase().includes("precess"))).toBe(
      true,
    );
  });

  it("quotes FTS operators and punctuation as literal prefix terms", () => {
    expect(buildFtsQuery(' C++ "gyro" OR precession? ')).toBe(
      '"C"* AND "gyro"* AND "OR"* AND "precession"*',
    );
    expect(buildFtsQuery("🛰️")).toBeNull();
  });

  it("searches old titles and visible messages with stable pagination beyond the recent 100 runs", () => {
    const insert = sqlite.prepare("INSERT INTO runs(id, account_id, provider_id, title, created_at, is_archived, owner_backend_id) VALUES (?, 'account-1', 'codex', ?, ?, 0, 'test-backend')");
    for (let index = 0; index < 130; index++) insert.run(`old-${String(index).padStart(3, "0")}`, `Historical telescope ${index}`, index + 1);
    const message = sqlite.prepare("INSERT INTO run_artifacts(run_id, kind, content, metadata) VALUES (?, 'report', 'A rare telescope measurement', '{}')");
    message.run("run-1"); message.run("run-1");
    let cursor: { rank: number; createdAt: number; runId: string } | undefined;
    const found: string[] = [];
    do {
      const page = searchRepo.findConversations({ accountId: "account-1", query: "telescope", limit: 17, cursor });
      found.push(...page.map(row => row.id));
      const last = page.at(-1);
      cursor = page.length === 17 && last ? { rank: last.rank, createdAt: last.createdAt, runId: last.id } : undefined;
    } while (cursor);
    expect(found).toHaveLength(131);
    expect(new Set(found).size).toBe(131);
    expect(found).toContain("old-000");
    expect(found.filter(id => id === "run-1")).toHaveLength(1);
  });

  it("keeps messages account scoped, excludes archives and logs, and returns a bounded matching cursor/snippet", () => {
    const insert = sqlite.prepare("INSERT INTO run_artifacts(run_id, kind, content, metadata) VALUES ('run-1', 'report', 'Hidden search marker', ?)");
    for (const metadata of [{ kind: "thinking" }, { source: "agent_thinking_streaming" }, { source: "assistant.reasoning_delta" }, { agentId: "child" }, { isFromSubagent: true }, { voice: true }, { parentToolCallId: 5 }]) insert.run(JSON.stringify(metadata));
    const rows = searchRepo.findConversations({ accountId: "account-1", query: "precess", limit: 26 });
    expect(new Set(rows.map(row => row.id))).toEqual(new Set(["run-1", "run-2"]));
    expect(rows.every(row => row.artifactId != null && row.messageTime != null && row.matchSnippet!.length <= 400)).toBe(true);
    expect(searchRepo.findConversations({ accountId: "account-1", query: "Diagnostic", limit: 26 })).toEqual([]);
    expect(searchRepo.findConversations({ accountId: "account-1", query: "Private", limit: 26 })).toEqual([]);
    expect(searchRepo.findConversations({ accountId: "account-1", query: "Hidden search marker", limit: 26 })).toEqual([]);
    expect(searchRepo.findConversations({ accountId: "account-1", query: '" OR )*', limit: 26 })).toEqual([]);
  });
});
