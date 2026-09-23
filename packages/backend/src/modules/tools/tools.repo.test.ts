import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import {
  createAccount,
  createRun,
  createProvider,
  createToolCall,
} from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";
import type Database from "better-sqlite3";

let db: DatabaseInstance;
let _sqlite: Database.Database;
let cleanup: () => void;

vi.mock("../../db/client", () => ({
  getDb: () => db,
}));

import { toolsRepo } from "./tools.repo";

describe("toolsRepo", () => {
  beforeEach(() => {
    ({ db, sqlite: _sqlite, cleanup } = createTestDb());
    createAccount(db, { id: "default" });
    createProvider(db, { id: "copilot_cli" });
  });

  afterEach(() => {
    cleanup();
  });

  describe("findToolCallsByRun", () => {
    it("returns empty array when no tool calls", async () => {
      const result = await toolsRepo.findToolCallsByRun("run-1");
      expect(result).toEqual([]);
    });

    it("returns tool calls for run", async () => {
      const run = createRun(db, { id: "run-1" });
      createToolCall(db, { runId: run.id, toolName: "Bash" });
      createToolCall(db, { runId: run.id, toolName: "Read" });
      createToolCall(db, { runId: "other-run", toolName: "Grep" });

      const result = await toolsRepo.findToolCallsByRun("run-1");
      expect(result).toHaveLength(2);
    });
  });

  describe("findToolCallsByAccount", () => {
    it("returns tool calls for account", async () => {
      const run = createRun(db, { id: "run-1" });
      createToolCall(db, { accountId: "default", runId: run.id, toolName: "Bash" });

      const result = await toolsRepo.findToolCallsByAccount("default");
      expect(result).toHaveLength(1);
      expect(result[0].toolName).toBe("Bash");
    });

    it("respects limit parameter", async () => {
      const run = createRun(db, { id: "run-1" });
      for (let i = 0; i < 5; i++) {
        createToolCall(db, { accountId: "default", runId: run.id, toolName: `Tool${i}` });
      }

      const result = await toolsRepo.findToolCallsByAccount("default", 3);
      expect(result).toHaveLength(3);
    });
  });

  describe("insertToolCall", () => {
    it("inserts a tool call and returns autoincrement id", async () => {
      const id = await toolsRepo.insertToolCall({
        accountId: "default",
        toolName: "Bash",
      });
      expect(typeof id).toBe("number");
      expect(id).toBeGreaterThan(0);
    });

    it("stores input as JSON", async () => {
      const run = createRun(db, { id: "run-1" });
      const id = await toolsRepo.insertToolCall({
        accountId: "default",
        runId: run.id,
        toolName: "Read",
        input: { file: "test.ts" },
      });

      const calls = await toolsRepo.findToolCallsByRun("run-1");
      const call = calls.find((c) => c.id === id);
      expect(call!.input).toEqual({ file: "test.ts" });
    });

    it("stores metadata as JSON", async () => {
      const run = createRun(db, { id: "run-1" });
      const id = await toolsRepo.insertToolCall({
        accountId: "default",
        runId: run.id,
        toolName: "Bash",
        metadata: { source: "agent" },
      });

      const calls = await toolsRepo.findToolCallsByRun("run-1");
      const call = calls.find((c) => c.id === id);
      expect(call!.metadata).toEqual({ source: "agent" });
    });

    it("defaults status to queued", async () => {
      const run = createRun(db, { id: "run-1" });
      const id = await toolsRepo.insertToolCall({
        accountId: "default",
        runId: run.id,
        toolName: "Bash",
      });

      const calls = await toolsRepo.findToolCallsByRun("run-1");
      const call = calls.find((c) => c.id === id);
      expect(call!.status).toBe("queued");
    });

    it("supports parentToolCallId", async () => {
      const run = createRun(db, { id: "run-1" });
      const _parentId = await toolsRepo.insertToolCall({
        accountId: "default",
        runId: run.id,
        toolName: "Agent",
        toolCallId: "tc-parent",
      });

      await toolsRepo.insertToolCall({
        accountId: "default",
        runId: run.id,
        toolName: "Bash",
        parentToolCallId: "tc-parent",
      });

      const calls = await toolsRepo.findToolCallsByRun("run-1");
      const child = calls.find((c) => c.parentToolCallId === "tc-parent");
      expect(child).toBeDefined();
      expect(child!.toolName).toBe("Bash");
    });
  });

  describe("updateToolCall", () => {
    it("updates status", async () => {
      const run = createRun(db, { id: "run-1" });
      const id = await toolsRepo.insertToolCall({
        accountId: "default",
        runId: run.id,
        toolName: "Bash",
      });

      await toolsRepo.updateToolCall(id, { status: "running" });

      const calls = await toolsRepo.findToolCallsByRun("run-1");
      expect(calls[0].status).toBe("running");
    });

    it("updates output and error", async () => {
      const run = createRun(db, { id: "run-1" });
      const id = await toolsRepo.insertToolCall({
        accountId: "default",
        runId: run.id,
        toolName: "Bash",
      });

      await toolsRepo.updateToolCall(id, {
        output: { result: "success" },
        error: null as any,
      });

      const calls = await toolsRepo.findToolCallsByRun("run-1");
      expect(calls[0].output).toEqual({ result: "success" });
    });

    it("updates latencyMs and costMicros", async () => {
      const run = createRun(db, { id: "run-1" });
      const id = await toolsRepo.insertToolCall({
        accountId: "default",
        runId: run.id,
        toolName: "Bash",
      });

      await toolsRepo.updateToolCall(id, { latencyMs: 150, costMicros: 5000 });

      const calls = await toolsRepo.findToolCallsByRun("run-1");
      expect(calls[0].latencyMs).toBe(150);
      expect(calls[0].costMicros).toBe(5000);
    });
  });

  describe("findToolCallRowIdByRunAndToolCallId", () => {
    it("returns row id when found", async () => {
      const run = createRun(db, { id: "run-1" });
      const id = await toolsRepo.insertToolCall({
        accountId: "default",
        runId: run.id,
        toolName: "Bash",
        toolCallId: "tc-123",
      });

      const result = await toolsRepo.findToolCallRowIdByRunAndToolCallId(
        "run-1",
        "tc-123",
      );
      expect(result).toBe(id);
    });

    it("returns null when not found", async () => {
      const result = await toolsRepo.findToolCallRowIdByRunAndToolCallId(
        "run-1",
        "nonexistent",
      );
      expect(result).toBeNull();
    });
  });

  describe("findOpenToolCallRowIdByRunAndToolName", () => {
    it("returns open tool call id", async () => {
      const run = createRun(db, { id: "run-1" });
      const id = await toolsRepo.insertToolCall({
        accountId: "default",
        runId: run.id,
        toolName: "Bash",
        status: "running",
      });

      // Set startedAt but NOT endedAt (open)
      await toolsRepo.updateToolCall(id, { startedAt: new Date() });

      const result = await toolsRepo.findOpenToolCallRowIdByRunAndToolName(
        "run-1",
        "Bash",
      );
      expect(result).toBe(id);
    });

    it("returns null when tool call is closed", async () => {
      const run = createRun(db, { id: "run-1" });
      const id = await toolsRepo.insertToolCall({
        accountId: "default",
        runId: run.id,
        toolName: "Bash",
      });

      await toolsRepo.updateToolCall(id, {
        startedAt: new Date(),
        endedAt: new Date(),
      });

      const result = await toolsRepo.findOpenToolCallRowIdByRunAndToolName(
        "run-1",
        "Bash",
      );
      expect(result).toBeNull();
    });

    it("returns null when no matching tool name", async () => {
      const result = await toolsRepo.findOpenToolCallRowIdByRunAndToolName(
        "run-1",
        "NonexistentTool",
      );
      expect(result).toBeNull();
    });
  });
});
