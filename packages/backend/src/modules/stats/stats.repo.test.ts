import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import {
  createAccount,
  createProvider,
  createProject,
  createWorkspace,
  createRun,
  createRunTurn,
  createToolCall,
  createWorkspaceDiff,
} from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";
import type Database from "better-sqlite3";

let db: DatabaseInstance;
let _sqlite: Database.Database;
let cleanup: () => void;

vi.mock("../../db/client", () => ({
  getDb: () => db,
}));

import { statsRepo } from "./stats.repo";

describe("statsRepo", () => {
  beforeEach(() => {
    ({ db, sqlite: _sqlite, cleanup } = createTestDb());
    createAccount(db, { id: "default" });
    createProvider(db, { id: "claude_code", kind: "agent_runtime", displayName: "Claude Code" });
    createProvider(db, { id: "copilot_cli", kind: "agent_runtime", displayName: "Copilot CLI" });
  });

  afterEach(() => {
    cleanup();
  });

  describe("getSummary", () => {
    it("returns zeros when no data", async () => {
      const result = await statsRepo.getSummary();
      expect(result.totalProjects).toBe(0);
      expect(result.runsToday).toBe(0);
      expect(result.totalSessions).toBe(0);
      expect(result.estimatedCostUsd).toBe(0);
    });

    it("counts total projects", async () => {
      createProject(db, { id: "p1", name: "Project 1" });
      createProject(db, { id: "p2", name: "Project 2" });

      const result = await statsRepo.getSummary();
      expect(result.totalProjects).toBe(2);
    });

    it("counts total sessions", async () => {
      createRun(db, { id: "r1", providerId: "claude_code" });
      createRun(db, { id: "r2", providerId: "copilot_cli" });

      const result = await statsRepo.getSummary();
      expect(result.totalSessions).toBe(2);
    });

    it("filters by provider", async () => {
      createRun(db, { id: "r1", providerId: "claude_code" });
      createRun(db, { id: "r2", providerId: "copilot_cli" });

      const result = await statsRepo.getSummary("claude_code");
      expect(result.totalSessions).toBe(1);
    });

    it("calculates estimated cost from completed turns", async () => {
      const run = createRun(db, { id: "r1", providerId: "claude_code" });
      createRunTurn(db, {
        runId: run.id,
        turnIndex: 0,
        status: "completed",
        costMicros: 500_000,
      });
      createRunTurn(db, {
        runId: run.id,
        turnIndex: 1,
        status: "completed",
        costMicros: 300_000,
      });

      const result = await statsRepo.getSummary();
      expect(result.estimatedCostUsd).toBe(0.8);
    });
  });

  describe("getDailyActivity", () => {
    it("returns empty array when no runs", async () => {
      const result = await statsRepo.getDailyActivity();
      expect(result).toEqual([]);
    });

    it("groups runs by date and provider", async () => {
      createRun(db, { id: "r1", providerId: "claude_code" });
      createRun(db, { id: "r2", providerId: "copilot_cli" });

      const result = await statsRepo.getDailyActivity();
      expect(result.length).toBeGreaterThanOrEqual(1);
      const today = result[0];
      expect(today.claude).toBe(1);
      expect(today.copilot).toBe(1);
    });
  });

  describe("getHourDistribution", () => {
    it("returns empty array when no runs", async () => {
      const result = await statsRepo.getHourDistribution();
      expect(result).toEqual([]);
    });

    it("returns hour distribution", async () => {
      createRun(db, { id: "r1", providerId: "claude_code" });

      const result = await statsRepo.getHourDistribution();
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0]).toHaveProperty("hour");
      expect(result[0]).toHaveProperty("count");
    });
  });

  describe("getCostByModel", () => {
    it("returns empty when no turns with model_usage", async () => {
      const result = await statsRepo.getCostByModel();
      expect(result).toEqual([]);
    });

    it("aggregates cost by model from turn model_usage JSON", async () => {
      const run = createRun(db, { id: "r1", providerId: "claude_code" });
      createRunTurn(db, {
        runId: run.id,
        turnIndex: 0,
        status: "completed",
        modelUsage: JSON.stringify({
          "claude-3-opus": { costUSD: 0.5, inputTokens: 1000, outputTokens: 500 },
        }),
      });

      const result = await statsRepo.getCostByModel();
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0].model).toBe("claude-3-opus");
      expect(result[0].costUsd).toBeCloseTo(0.5, 1);
    });
  });

  describe("getToolUsage", () => {
    it("returns empty when no tool calls", async () => {
      const result = await statsRepo.getToolUsage();
      expect(result).toEqual([]);
    });

    it("counts tool usage grouped by name", async () => {
      const run = createRun(db, { id: "r1", providerId: "claude_code" });
      createToolCall(db, { runId: run.id, toolName: "Bash" });
      createToolCall(db, { runId: run.id, toolName: "Bash" });
      createToolCall(db, { runId: run.id, toolName: "Read" });

      const result = await statsRepo.getToolUsage();
      expect(result).toHaveLength(2);

      const bash = result.find((t) => t.toolName === "Bash");
      expect(bash!.count).toBe(2);
    });

    it("filters by provider", async () => {
      const r1 = createRun(db, { id: "r1", providerId: "claude_code" });
      const r2 = createRun(db, { id: "r2", providerId: "copilot_cli" });
      createToolCall(db, { runId: r1.id, toolName: "Bash" });
      createToolCall(db, { runId: r2.id, toolName: "Read" });

      const result = await statsRepo.getToolUsage(10, "claude_code");
      expect(result).toHaveLength(1);
      expect(result[0].toolName).toBe("Bash");
    });
  });

  describe("getStatusBreakdown", () => {
    it("returns empty breakdown when no runs", async () => {
      const result = await statsRepo.getStatusBreakdown();
      expect(result.totalSucceeded).toBe(0);
      expect(result.totalFailed).toBe(0);
      expect(result.days).toEqual([]);
    });

    it("groups runs by status", async () => {
      createRun(db, { id: "r1", providerId: "claude_code", status: "succeeded" });
      createRun(db, { id: "r2", providerId: "claude_code", status: "failed" });
      createRun(db, { id: "r3", providerId: "claude_code", status: "succeeded" });

      const result = await statsRepo.getStatusBreakdown();
      expect(result.totalSucceeded).toBe(2);
      expect(result.totalFailed).toBe(1);
    });
  });


  describe("getCodeActivity", () => {
    it("returns zeros when no diffs", async () => {
      const result = await statsRepo.getCodeActivity();
      expect(result.totalDiffs).toBe(0);
      expect(result.totalFilesChanged).toBe(0);
    });

    it("counts diffs and files", async () => {
      const ws = createWorkspace(db, { id: "ws1" });
      const run = createRun(db, { id: "r1", providerId: "claude_code", workspaceId: ws.id });
      createWorkspaceDiff(db, {
        workspaceId: ws.id,
        runId: run.id,
        filesJson: JSON.stringify(["file1.ts", "file2.ts"]),
      });
      createWorkspaceDiff(db, {
        workspaceId: ws.id,
        runId: run.id,
        filesJson: JSON.stringify(["file3.ts"]),
      });

      const result = await statsRepo.getCodeActivity();
      expect(result.totalDiffs).toBe(2);
      expect(result.totalFilesChanged).toBe(3);
    });
  });
});
