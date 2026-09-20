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
      INSERT INTO runs(id, account_id, provider_id, title, is_archived) VALUES
        ('run-1', 'account-1', 'codex', 'Gyroscope', 0),
        ('run-2', 'account-1', 'codex', 'Physics notes', 0),
        ('run-other-account', 'account-2', 'codex', 'Private physics', 0),
        ('run-archived', 'account-1', 'codex', 'Old physics', 1);
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
});
