import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import { createRun, createRunTurn, createToolCall } from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";
import { resolveDashboardRange } from "./stats.range";

let db: DatabaseInstance;
let cleanup: () => void;
vi.mock("../../db/client", () => ({ getDb: () => db }));
import { statsRepo } from "./stats.repo";

const now = new Date("2026-10-11T12:00:00Z");
const range = resolveDashboardRange({ period: "week", timeZone: "UTC", provider: "codex" }, now);

describe("statsRepo period reads", () => {
  beforeEach(() => { ({ db, cleanup } = createTestDb()); });
  afterEach(() => cleanup());

  it("bounds activity by turn time, joins the provider, and preserves null/zero", async () => {
    createRun(db, { id: "old", providerId: "codex", createdAt: new Date("2024-01-01T00:00:00Z") });
    createRunTurn(db, { runId: "old", status: "completed", startedAt: new Date("2026-10-10T00:00:00Z"), costMicros: 0, inputTokens: 0 });
    createRunTurn(db, { runId: "old", turnIndex: 1, startedAt: new Date("2024-01-01T00:00:00Z") });
    createRun(db, { id: "other", providerId: "claude_code", createdAt: now });
    createRunTurn(db, { runId: "other", startedAt: now });
    const rows = await statsRepo.listActivityRows(range);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ runId: "old", providerId: "codex", costMicros: 0, inputTokens: 0, outputTokens: null });
  });

  it("falls back to turn creation time and includes no-turn sessions", async () => {
    createRun(db, { id: "fallback", providerId: "codex", createdAt: new Date("2024-01-01T00:00:00Z") });
    createRunTurn(db, { runId: "fallback", createdAt: now });
    createRun(db, { id: "waiting", providerId: "codex", createdAt: now });
    const rows = await statsRepo.listActivityRows(range);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.runId === "waiting")?.turnId).toBeNull();
    expect(rows.find((row) => row.runId === "fallback")?.activityAt).toBe(now.getTime() / 1000);
  });

  it("reads tools by their own time and excludes other providers and future rows", async () => {
    createRun(db, { id: "codex", providerId: "codex" });
    createRun(db, { id: "claude", providerId: "claude_code" });
    createToolCall(db, { runId: "codex", toolName: "Read", createdAt: now });
    createToolCall(db, { runId: "codex", toolName: "Old", startedAt: new Date("2024-01-01T00:00:00Z") });
    createToolCall(db, { runId: "codex", toolName: "Future", createdAt: new Date("2026-10-12T00:00:00Z") });
    createToolCall(db, { runId: "claude", toolName: "Write", createdAt: now });
    expect(await statsRepo.listToolRows(range)).toEqual([{ toolName: "Read", activityAt: now.getTime() / 1000 }]);
  });
});
