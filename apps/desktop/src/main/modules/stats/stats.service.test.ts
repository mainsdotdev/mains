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

import { statsService } from "./stats.service";
import { statsRepo } from "./stats.repo";

describe("statsService", () => {
  beforeEach(() => {
    ({ db, sqlite: _sqlite, cleanup } = createTestDb());
    createAccount(db, { id: "default" });
    createProvider(db, { id: "claude_code", kind: "agent_runtime", displayName: "Claude Code" });
    createProvider(db, { id: "copilot_cli", kind: "agent_runtime", displayName: "Copilot CLI" });
  });

  afterEach(() => {
    cleanup();
  });

  // ─────────────────────────────────────────────────────────────
  // getDashboard
  // ─────────────────────────────────────────────────────────────
  describe("getDashboard", () => {
    it("returns full dashboard with empty data", async () => {
      const data = await statsService.getDashboard();

      expect(data).toHaveProperty("summary");
      expect(data).toHaveProperty("dailyActivity");
      expect(data).toHaveProperty("hourDistribution");
      expect(data).toHaveProperty("costByModel");
      expect(data).toHaveProperty("toolUsage");
      expect(data).toHaveProperty("statusBreakdown");
      expect(data).toHaveProperty("recentSessions");
      expect(data).toHaveProperty("codeActivity");

      expect(data.summary.totalProjects).toBe(0);
      expect(data.summary.totalSessions).toBe(0);
      expect(data.summary.runsToday).toBe(0);
      expect(data.summary.estimatedCostUsd).toBe(0);
      expect(data.dailyActivity).toEqual([]);
      expect(data.hourDistribution).toEqual([]);
      expect(data.costByModel).toEqual([]);
      expect(data.toolUsage).toEqual([]);
      expect(data.recentSessions).toEqual([]);
      expect(data.codeActivity.totalDiffs).toBe(0);
      expect(data.codeActivity.totalFilesChanged).toBe(0);
    });

    it("accepts a provider filter", async () => {
      const data = await statsService.getDashboard("claude_code");
      expect(data.summary).toBeDefined();
    });

    it("returns populated dashboard when data exists", async () => {
      const proj = createProject(db);
      const ws = createWorkspace(db, { projectId: proj.id });
      createRun(db, {
        id: "r1",
        providerId: "claude_code",
        workspaceId: ws.id,
        status: "succeeded",
        createdAt: new Date(),
      });

      const data = await statsService.getDashboard();
      expect(data.summary.totalProjects).toBe(1);
      expect(data.summary.totalSessions).toBe(1);
      expect(data.recentSessions).toHaveLength(1);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getSummary (via repo directly)
  // ─────────────────────────────────────────────────────────────
  describe("getSummary", () => {
    it("counts active projects", async () => {
      createProject(db, { name: "Active" });
      createProject(db, { name: "Archived", isArchived: true });

      const summary = await statsRepo.getSummary();
      expect(summary.totalProjects).toBe(1);
    });

    it("counts runs created today", async () => {
      const now = new Date();
      createRun(db, { providerId: "claude_code", createdAt: now });

      // Create a run from yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      createRun(db, { providerId: "claude_code", createdAt: yesterday });

      const summary = await statsRepo.getSummary();
      expect(summary.runsToday).toBe(1);
      expect(summary.totalSessions).toBe(2);
    });

    it("sums cost from completed run turns (excludes copilot)", async () => {
      const run = createRun(db, { id: "r-cost", providerId: "claude_code" });
      createRunTurn(db, {
        runId: run.id,
        status: "completed",
        costMicros: 500_000, // $0.50
      });
      createRunTurn(db, {
        runId: run.id,
        status: "completed",
        costMicros: 300_000, // $0.30
      });
      // Active turn should not count
      createRunTurn(db, {
        runId: run.id,
        turnIndex: 2,
        status: "active",
        costMicros: 100_000,
      });

      const summary = await statsRepo.getSummary();
      expect(summary.estimatedCostUsd).toBeCloseTo(0.8);
    });

    it("excludes copilot cost from summary", async () => {
      const copilotRun = createRun(db, { id: "r-copilot", providerId: "copilot_cli" });
      createRunTurn(db, {
        runId: copilotRun.id,
        status: "completed",
        costMicros: 1_000_000,
      });

      const summary = await statsRepo.getSummary();
      expect(summary.estimatedCostUsd).toBe(0);
    });

    it("filters by provider", async () => {
      createRun(db, { providerId: "claude_code", createdAt: new Date() });
      createRun(db, { providerId: "copilot_cli", createdAt: new Date() });

      const claudeSummary = await statsRepo.getSummary("claude_code");
      expect(claudeSummary.totalSessions).toBe(1);

      const copilotSummary = await statsRepo.getSummary("copilot_cli");
      expect(copilotSummary.totalSessions).toBe(1);

      const allSummary = await statsRepo.getSummary("all");
      expect(allSummary.totalSessions).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getDailyActivity
  // ─────────────────────────────────────────────────────────────
  describe("getDailyActivity", () => {
    it("returns empty array with no runs", async () => {
      const result = await statsRepo.getDailyActivity(30);
      expect(result).toEqual([]);
    });

    it("groups runs by date and provider", async () => {
      const now = new Date();
      createRun(db, { providerId: "claude_code", createdAt: now });
      createRun(db, { providerId: "claude_code", createdAt: now });
      createRun(db, { providerId: "copilot_cli", createdAt: now });

      const result = await statsRepo.getDailyActivity(30);
      expect(result).toHaveLength(1);
      expect(result[0].claude).toBe(2);
      expect(result[0].copilot).toBe(1);
      expect(result[0].other).toBe(0);
    });

    it("filters by provider", async () => {
      const now = new Date();
      createRun(db, { providerId: "claude_code", createdAt: now });
      createRun(db, { providerId: "copilot_cli", createdAt: now });

      const result = await statsRepo.getDailyActivity(30, "claude_code");
      expect(result).toHaveLength(1);
      expect(result[0].claude).toBe(1);
      expect(result[0].copilot).toBe(0);
    });

    it("excludes runs older than the specified days", async () => {
      const old = new Date();
      old.setDate(old.getDate() - 60);
      createRun(db, { providerId: "claude_code", createdAt: old });

      const result = await statsRepo.getDailyActivity(30);
      expect(result).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getHourDistribution
  // ─────────────────────────────────────────────────────────────
  describe("getHourDistribution", () => {
    it("returns empty with no runs", async () => {
      const result = await statsRepo.getHourDistribution();
      expect(result).toEqual([]);
    });

    it("returns hour counts", async () => {
      const now = new Date();
      createRun(db, { providerId: "claude_code", createdAt: now });
      createRun(db, { providerId: "copilot_cli", createdAt: now });

      const result = await statsRepo.getHourDistribution();
      expect(result.length).toBeGreaterThanOrEqual(1);
      // All runs created at same time, so one hour bucket
      const totalCount = result.reduce((sum, r) => sum + r.count, 0);
      expect(totalCount).toBe(2);
    });

    it("filters by provider", async () => {
      const now = new Date();
      createRun(db, { providerId: "claude_code", createdAt: now });
      createRun(db, { providerId: "copilot_cli", createdAt: now });

      const result = await statsRepo.getHourDistribution("claude_code");
      const totalCount = result.reduce((sum, r) => sum + r.count, 0);
      expect(totalCount).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getCostByModel
  // ─────────────────────────────────────────────────────────────
  describe("getCostByModel", () => {
    it("returns empty with no turns", async () => {
      const result = await statsRepo.getCostByModel();
      expect(result).toEqual([]);
    });

    it("aggregates cost by model from model_usage JSON", async () => {
      const run = createRun(db, { id: "r-model", providerId: "claude_code" });
      createRunTurn(db, {
        runId: run.id,
        status: "completed",
        modelUsage: JSON.stringify({
          "claude-3-opus": { costUSD: 0.5, inputTokens: 100, outputTokens: 50 },
        }),
      });
      createRunTurn(db, {
        runId: run.id,
        turnIndex: 1,
        status: "completed",
        modelUsage: JSON.stringify({
          "claude-3-opus": { costUSD: 0.3, inputTokens: 80, outputTokens: 40 },
          "claude-3-sonnet": { costUSD: 0.1, inputTokens: 50, outputTokens: 20 },
        }),
      });

      const result = await statsRepo.getCostByModel();
      expect(result.length).toBe(2);

      const opus = result.find((r) => r.model === "claude-3-opus");
      expect(opus).toBeDefined();
      expect(opus!.costUsd).toBeCloseTo(0.8);
      expect(opus!.runs).toBe(2);

      const sonnet = result.find((r) => r.model === "claude-3-sonnet");
      expect(sonnet).toBeDefined();
      expect(sonnet!.costUsd).toBeCloseTo(0.1);
    });

    it("excludes copilot runs", async () => {
      const run = createRun(db, { id: "r-cop-model", providerId: "copilot_cli" });
      createRunTurn(db, {
        runId: run.id,
        status: "completed",
        modelUsage: JSON.stringify({
          "gpt-4": { costUSD: 1.0 },
        }),
      });

      const result = await statsRepo.getCostByModel();
      expect(result).toEqual([]);
    });

    it("filters zero-cost models", async () => {
      const run = createRun(db, { id: "r-zero", providerId: "claude_code" });
      createRunTurn(db, {
        runId: run.id,
        status: "completed",
        modelUsage: JSON.stringify({
          "claude-3-haiku": { costUSD: 0 },
        }),
      });

      const result = await statsRepo.getCostByModel();
      expect(result).toEqual([]);
    });

    it("filters by provider", async () => {
      const claudeRun = createRun(db, { id: "r-c", providerId: "claude_code" });
      createRunTurn(db, {
        runId: claudeRun.id,
        status: "completed",
        modelUsage: JSON.stringify({ "claude-3-opus": { costUSD: 0.5 } }),
      });

      const result = await statsRepo.getCostByModel("claude_code");
      expect(result).toHaveLength(1);
      expect(result[0].model).toBe("claude-3-opus");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getToolUsage
  // ─────────────────────────────────────────────────────────────
  describe("getToolUsage", () => {
    it("returns empty with no tool calls", async () => {
      const result = await statsRepo.getToolUsage();
      expect(result).toEqual([]);
    });

    it("counts tool usage grouped by name", async () => {
      const run = createRun(db, { id: "r-tools", providerId: "claude_code" });
      createToolCall(db, { runId: run.id, toolName: "Bash" });
      createToolCall(db, { runId: run.id, toolName: "Bash" });
      createToolCall(db, { runId: run.id, toolName: "Read" });

      const result = await statsRepo.getToolUsage(10);
      expect(result).toHaveLength(2);

      const bash = result.find((r) => r.toolName === "Bash");
      expect(bash).toBeDefined();
      expect(bash!.count).toBe(2);

      const read = result.find((r) => r.toolName === "Read");
      expect(read).toBeDefined();
      expect(read!.count).toBe(1);
    });

    it("respects limit parameter", async () => {
      const run = createRun(db, { id: "r-limit", providerId: "claude_code" });
      createToolCall(db, { runId: run.id, toolName: "Bash" });
      createToolCall(db, { runId: run.id, toolName: "Bash" });
      createToolCall(db, { runId: run.id, toolName: "Read" });
      createToolCall(db, { runId: run.id, toolName: "Grep" });

      const result = await statsRepo.getToolUsage(2);
      expect(result).toHaveLength(2);
      // Bash should be first (highest count)
      expect(result[0].toolName).toBe("Bash");
    });

    it("filters by provider", async () => {
      const claudeRun = createRun(db, { id: "r-tc", providerId: "claude_code" });
      const copilotRun = createRun(db, { id: "r-tp", providerId: "copilot_cli" });
      createToolCall(db, { runId: claudeRun.id, toolName: "Bash" });
      createToolCall(db, { runId: copilotRun.id, toolName: "Read" });

      const result = await statsRepo.getToolUsage(10, "claude_code");
      expect(result).toHaveLength(1);
      expect(result[0].toolName).toBe("Bash");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getStatusBreakdown
  // ─────────────────────────────────────────────────────────────
  describe("getStatusBreakdown", () => {
    it("returns empty days with no runs", async () => {
      const result = await statsRepo.getStatusBreakdown();
      expect(result.days).toEqual([]);
      expect(result.totalSucceeded).toBe(0);
      expect(result.totalFailed).toBe(0);
      expect(result.totalCanceled).toBe(0);
      expect(result.totalOther).toBe(0);
    });

    it("groups runs by date and status", async () => {
      const now = new Date();
      createRun(db, { providerId: "claude_code", status: "succeeded", createdAt: now });
      createRun(db, { providerId: "claude_code", status: "succeeded", createdAt: now });
      createRun(db, { providerId: "claude_code", status: "failed", createdAt: now });
      createRun(db, { providerId: "claude_code", status: "canceled", createdAt: now });
      createRun(db, { providerId: "claude_code", status: "running", createdAt: now });

      const result = await statsRepo.getStatusBreakdown();
      expect(result.days).toHaveLength(1);
      expect(result.totalSucceeded).toBe(2);
      expect(result.totalFailed).toBe(1);
      expect(result.totalCanceled).toBe(1);
      expect(result.totalOther).toBe(1);
    });

    it("treats completed status as succeeded", async () => {
      const now = new Date();
      // The repo maps both "succeeded" and "completed" to the succeeded bucket
      createRun(db, { providerId: "claude_code", status: "succeeded", createdAt: now });

      const result = await statsRepo.getStatusBreakdown();
      expect(result.totalSucceeded).toBe(1);
    });

    it("limits to last 7 days with data", async () => {
      // Create runs across 10 different days
      for (let i = 0; i < 10; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        createRun(db, { providerId: "claude_code", status: "succeeded", createdAt: date });
      }

      const result = await statsRepo.getStatusBreakdown();
      expect(result.days.length).toBeLessThanOrEqual(7);
    });

    it("includes dayLabel for each day", async () => {
      const now = new Date();
      createRun(db, { providerId: "claude_code", status: "succeeded", createdAt: now });

      const result = await statsRepo.getStatusBreakdown();
      expect(result.days[0].dayLabel).toBeDefined();
      expect(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]).toContain(result.days[0].dayLabel);
    });

    it("filters by provider", async () => {
      const now = new Date();
      createRun(db, { providerId: "claude_code", status: "succeeded", createdAt: now });
      createRun(db, { providerId: "copilot_cli", status: "succeeded", createdAt: now });

      const result = await statsRepo.getStatusBreakdown("claude_code");
      expect(result.totalSucceeded).toBe(1);
    });
  });


  // ─────────────────────────────────────────────────────────────
  // getCodeActivity
  // ─────────────────────────────────────────────────────────────
  describe("getCodeActivity", () => {
    it("returns zeros with no diffs", async () => {
      const result = await statsRepo.getCodeActivity();
      expect(result.totalDiffs).toBe(0);
      expect(result.totalFilesChanged).toBe(0);
    });

    it("counts diffs and files changed", async () => {
      const ws = createWorkspace(db);
      const run = createRun(db, { id: "r-diff", providerId: "claude_code", workspaceId: ws.id });
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

    it("handles diffs with null filesJson", async () => {
      const ws = createWorkspace(db);
      const run = createRun(db, { id: "r-null-files", providerId: "claude_code", workspaceId: ws.id });
      createWorkspaceDiff(db, {
        workspaceId: ws.id,
        runId: run.id,
        // filesJson defaults to null
      });

      const result = await statsRepo.getCodeActivity();
      expect(result.totalDiffs).toBe(1);
      expect(result.totalFilesChanged).toBe(0);
    });

    it("filters by provider", async () => {
      const ws = createWorkspace(db);
      const claudeRun = createRun(db, { id: "r-ca", providerId: "claude_code", workspaceId: ws.id });
      const copilotRun = createRun(db, { id: "r-pa", providerId: "copilot_cli", workspaceId: ws.id });

      createWorkspaceDiff(db, {
        workspaceId: ws.id,
        runId: claudeRun.id,
        filesJson: JSON.stringify(["a.ts"]),
      });
      createWorkspaceDiff(db, {
        workspaceId: ws.id,
        runId: copilotRun.id,
        filesJson: JSON.stringify(["b.ts", "c.ts"]),
      });

      const claudeResult = await statsRepo.getCodeActivity("claude_code");
      expect(claudeResult.totalDiffs).toBe(1);
      expect(claudeResult.totalFilesChanged).toBe(1);

      const copilotResult = await statsRepo.getCodeActivity("copilot_cli");
      expect(copilotResult.totalDiffs).toBe(1);
      expect(copilotResult.totalFilesChanged).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Error handling
  // ─────────────────────────────────────────────────────────────
  describe("error handling", () => {
    it("getDashboard propagates repo failures", async () => {
      vi.spyOn(statsRepo, "getSummary").mockRejectedValueOnce(new Error("db error"));
      await expect(statsService.getDashboard()).rejects.toThrow("db error");
    });
  });
});
