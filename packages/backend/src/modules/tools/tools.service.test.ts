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

import { toolsService } from "./tools.service";
import { toolsRepo } from "./tools.repo";

// Throw-style service: tests assert plain values and rejections — the
// ServiceResponse envelope only exists at the IPC seam (handle()).

describe("toolsService", () => {
  beforeEach(() => {
    ({ db, sqlite: _sqlite, cleanup } = createTestDb());
    createAccount(db, { id: "default" });
    createProvider(db, { id: "copilot_cli" });
  });

  afterEach(() => {
    cleanup();
  });

  describe("getToolCallsByRun", () => {
    it("returns tool calls for run", async () => {
      const run = createRun(db, { id: "run-1" });
      createToolCall(db, { runId: run.id, toolName: "Bash" });

      const calls = await toolsService.getToolCallsByRun("run-1");
      expect(calls).toHaveLength(1);
    });

    it("returns empty for run with no tool calls", async () => {
      const calls = await toolsService.getToolCallsByRun("run-empty");
      expect(calls).toEqual([]);
    });
  });

  describe("getToolCallsByAccount", () => {
    it("returns tool calls for account", async () => {
      const run = createRun(db, { id: "run-1" });
      createToolCall(db, { accountId: "default", runId: run.id, toolName: "Read" });

      const calls = await toolsService.getToolCallsByAccount("default");
      expect(calls).toHaveLength(1);
    });
  });

  describe("createToolCall", () => {
    it("creates a tool call and returns id", async () => {
      const id = await toolsService.createToolCall({
        accountId: "default",
        toolName: "Bash",
      });
      expect(typeof id).toBe("number");
      expect(id).toBeGreaterThan(0);
    });
  });

  describe("updateToolCall", () => {
    it("updates tool call status", async () => {
      const run = createRun(db, { id: "run-1" });
      const tc = createToolCall(db, { runId: run.id, toolName: "Bash" });

      await toolsService.updateToolCall(tc.id, { status: "running" });

      const calls = await toolsRepo.findToolCallsByRun("run-1");
      expect(calls[0].status).toBe("running");
    });
  });

  describe("startToolCall", () => {
    it("sets status to running and startedAt", async () => {
      const run = createRun(db, { id: "run-1" });
      const tc = createToolCall(db, { runId: run.id, toolName: "Bash" });

      await toolsService.startToolCall(tc.id);

      const calls = await toolsRepo.findToolCallsByRun("run-1");
      expect(calls[0].status).toBe("running");
      expect(calls[0].startedAt).not.toBeNull();
    });
  });

  describe("completeToolCall", () => {
    it("sets status to done with output", async () => {
      const run = createRun(db, { id: "run-1" });
      const tc = createToolCall(db, { runId: run.id, toolName: "Bash" });

      await toolsService.completeToolCall(tc.id, { stdout: "hello" }, 120);

      const calls = await toolsRepo.findToolCallsByRun("run-1");
      expect(calls[0].status).toBe("done");
      expect(calls[0].output).toEqual({ stdout: "hello" });
      expect(calls[0].latencyMs).toBe(120);
      expect(calls[0].endedAt).not.toBeNull();
    });
  });

  describe("failToolCall", () => {
    it("sets status to error with error message", async () => {
      const run = createRun(db, { id: "run-1" });
      const tc = createToolCall(db, { runId: run.id, toolName: "Bash" });

      await toolsService.failToolCall(tc.id, "Command failed");

      const calls = await toolsRepo.findToolCallsByRun("run-1");
      expect(calls[0].status).toBe("error");
      expect(calls[0].error).toBe("Command failed");
      expect(calls[0].endedAt).not.toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Error paths
  // ─────────────────────────────────────────────────────────────
  describe("error handling", () => {
    it("propagates repo failures", async () => {
      vi.spyOn(toolsRepo, "findToolCallsByRun").mockRejectedValueOnce(
        new Error("db error"),
      );
      await expect(toolsService.getToolCallsByRun("r1")).rejects.toThrow(
        "db error",
      );
    });
  });
});
