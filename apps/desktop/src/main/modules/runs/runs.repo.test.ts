import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import {
  createAccount,
  createCollection,
  createProvider,
  createWorkspace,
  createRun,
  createRunTurn,
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

import { runsRepo } from "./runs.repo";

describe("runsRepo", () => {
  beforeEach(() => {
    ({ db, sqlite: _sqlite, cleanup } = createTestDb());
    createAccount(db, { id: "default" });
    createProvider(db, { id: "copilot_cli" });
  });

  afterEach(() => {
    cleanup();
  });

  // ─────────────────────────────────────────────────────────────
  // Run Operations
  // ─────────────────────────────────────────────────────────────
  describe("findAllRuns", () => {
    it("returns empty array when no runs", async () => {
      const result = await runsRepo.findAllRuns();
      expect(result).toEqual([]);
    });

    it("returns non-archived runs by default", async () => {
      createRun(db, { id: "r1" });
      createRun(db, { id: "r2" });
      // Manually archive one
      _sqlite.exec(`UPDATE runs SET is_archived = 1 WHERE id = 'r2'`);

      const result = await runsRepo.findAllRuns();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("r1");
    });

    it("includes archived when flag set", async () => {
      createRun(db, { id: "r1" });
      createRun(db, { id: "r2" });
      _sqlite.exec(`UPDATE runs SET is_archived = 1 WHERE id = 'r2'`);

      const result = await runsRepo.findAllRuns(100, true);
      expect(result).toHaveLength(2);
    });

    it("respects limit", async () => {
      for (let i = 0; i < 5; i++) {
        createRun(db, { id: `r${i}` });
      }
      const result = await runsRepo.findAllRuns(3);
      expect(result).toHaveLength(3);
    });
  });

  describe("findArchivedRuns", () => {
    it("returns archived runs only", async () => {
      createRun(db, { id: "r1" });
      createRun(db, { id: "r2", isArchived: true });

      const result = await runsRepo.findArchivedRuns();

      expect(result.map((run) => run.id)).toEqual(["r2"]);
    });
  });

  describe("findRunById", () => {
    it("returns run by id", async () => {
      createRun(db, { id: "r1" });
      const result = await runsRepo.findRunById("r1");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("r1");
    });

    it("parses JSON fields", async () => {
      createRun(db, { id: "r1" });
      _sqlite.exec(`UPDATE runs SET config_snapshot = '{"temp":0.5}', tool_policy_snapshot = '{"allow":["Bash"]}' WHERE id = 'r1'`);

      const result = await runsRepo.findRunById("r1");
      expect(result!.configSnapshot).toEqual({ temp: 0.5 });
      expect(result!.toolPolicySnapshot).toEqual({ allow: ["Bash"] });
    });

    it("returns null for non-existent", async () => {
      const result = await runsRepo.findRunById("non-existent");
      expect(result).toBeNull();
    });
  });

  describe("findRunsByAccount", () => {
    it("returns runs for account", async () => {
      createRun(db, { id: "r1", accountId: "default" });
      createAccount(db, { id: "other" });
      createRun(db, { id: "r2", accountId: "other" });

      const result = await runsRepo.findRunsByAccount("default");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("r1");
    });
  });

  describe("findRunsByWorkspace", () => {
    it("returns runs for workspace", async () => {
      const ws = createWorkspace(db, { id: "ws1" });
      createRun(db, { id: "r1", workspaceId: ws.id });
      createRun(db, { id: "r2" });

      const result = await runsRepo.findRunsByWorkspace("ws1");
      expect(result).toHaveLength(1);
    });

    it("filters workspace runs by provider and mode before applying the limit", async () => {
      const ws = createWorkspace(db, { id: "ws-experience" });
      createRun(db, {
        id: "claude-developer",
        workspaceId: ws.id,
        providerId: "claude_code",
        mode: "developer",
      });
      createRun(db, {
        id: "claude-work",
        workspaceId: ws.id,
        providerId: "claude_code",
        mode: "work",
      });
      createRun(db, {
        id: "cursor-work",
        workspaceId: ws.id,
        providerId: "cursor",
        mode: "work",
      });

      const result = await runsRepo.findRunsByWorkspace(ws.id, {
        providerId: "claude_code",
        mode: "work",
        limit: 1,
      });

      expect(result.map((run) => run.id)).toEqual(["claude-work"]);
    });
  });

  describe("findRecentRunsByExperience", () => {
    it("scopes rows by account, provider, mode, and archive state", async () => {
      createAccount(db, { id: "other" });
      createRun(db, {
        id: "match",
        accountId: "default",
        providerId: "copilot_cli",
        mode: "work",
      });
      createRun(db, {
        id: "other-account",
        accountId: "other",
        providerId: "copilot_cli",
        mode: "work",
      });
      createRun(db, { id: "other-mode", mode: "chat" });
      createRun(db, { id: "archived", mode: "work", isArchived: true });

      const result = await runsRepo.findRecentRunsByExperience({
        accountId: "default",
        providerId: "copilot_cli",
        mode: "work",
      });

      expect(result.map((run) => run.id)).toEqual(["match"]);
    });
  });

  describe("moveToCollection", () => {
    it("moves a run between a Collection and standalone", async () => {
      createCollection(db, { id: "collection-1" });
      createRun(db, { id: "run-1", mode: "work" });

      expect(
        (await runsRepo.moveToCollection("run-1", "collection-1"))
          ?.collectionId,
      ).toBe("collection-1");
      expect((await runsRepo.moveToCollection("run-1", null))?.collectionId).toBeNull();
    });

    it("leaves updatedAt alone — filing a chat is not activity", async () => {
      // The sidebar prints and sorts on this column; a move must not send an
      // untouched chat to the top of Recents reading "now".
      createCollection(db, { id: "collection-1" });
      createRun(db, { id: "run-1", mode: "work" });
      const before = (await runsRepo.findRunById("run-1"))?.updatedAt;

      const moved = await runsRepo.moveToCollection("run-1", "collection-1");

      expect(moved?.updatedAt).toEqual(before);
    });
  });

  describe("findRunsByStatus", () => {
    it("returns runs with matching status", async () => {
      createRun(db, { id: "r1", status: "running" });
      createRun(db, { id: "r2", status: "succeeded" });
      createRun(db, { id: "r3", status: "running" });

      const result = await runsRepo.findRunsByStatus("default", "running");
      expect(result).toHaveLength(2);
    });
  });

  describe("insertRun", () => {
    it("creates a new run", async () => {
      const id = await runsRepo.insertRun({
        id: "new-run",
        accountId: "default",
        providerId: "copilot_cli",
        title: "Test Run",
        goal: "Fix the bug",
      });

      expect(id).toBe("new-run");
      const found = await runsRepo.findRunById("new-run");
      expect(found!.title).toBe("Test Run");
      expect(found!.goal).toBe("Fix the bug");
      expect(found!.status).toBe("queued");
    });

    it("stores JSON config and tool policy", async () => {
      await runsRepo.insertRun({
        id: "r1",
        accountId: "default",
        providerId: "copilot_cli",
        configSnapshot: { temperature: 0.7 },
        toolPolicySnapshot: { allowList: ["Bash", "Read"] },
      });

      const found = await runsRepo.findRunById("r1");
      expect(found!.configSnapshot).toEqual({ temperature: 0.7 });
      expect(found!.toolPolicySnapshot).toEqual({ allowList: ["Bash", "Read"] });
    });
  });

  describe("updateRun", () => {
    it("updates run fields", async () => {
      createRun(db, { id: "r1" });

      const result = await runsRepo.updateRun("r1", {
        title: "Updated",
        status: "running",
        model: "claude-3",
        sessionId: "session-123",
      });

      expect(result!.title).toBe("Updated");
      expect(result!.status).toBe("running");
      expect(result!.model).toBe("claude-3");
      expect(result!.sessionId).toBe("session-123");
    });

    it("updates error and stop reason", async () => {
      createRun(db, { id: "r1" });

      const result = await runsRepo.updateRun("r1", {
        status: "failed",
        lastError: "Connection timeout",
        stopReason: "error",
      });

      expect(result!.lastError).toBe("Connection timeout");
      expect(result!.stopReason).toBe("error");
    });
  });

  describe("deleteRun", () => {
    it("deletes run", async () => {
      createRun(db, { id: "r1" });
      await runsRepo.deleteRun("r1");
      const result = await runsRepo.findRunById("r1");
      expect(result).toBeNull();
    });
  });

  describe("deleteRunsByWorkspaceId", () => {
    it("deletes all runs for workspace", async () => {
      const ws = createWorkspace(db, { id: "ws1" });
      createRun(db, { id: "r1", workspaceId: ws.id });
      createRun(db, { id: "r2", workspaceId: ws.id });
      createRun(db, { id: "r3" });

      await runsRepo.deleteRunsByWorkspaceId("ws1");
      const all = await runsRepo.findAllRuns();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe("r3");
    });
  });

  describe("archiveRun", () => {
    it("archives a run", async () => {
      createRun(db, { id: "r1" });

      const result = await runsRepo.archiveRun("r1");
      expect(result!.isArchived).toBe(true);
    });
  });

  describe("unarchiveRun", () => {
    it("restores an archived run", async () => {
      createRun(db, { id: "r1", isArchived: true });

      const result = await runsRepo.unarchiveRun("r1");

      expect(result!.isArchived).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Run Context Operations
  // ─────────────────────────────────────────────────────────────
  describe("findContextByRun", () => {
    it("returns empty when no context", async () => {
      const result = await runsRepo.findContextByRun("r1");
      expect(result).toEqual([]);
    });

    it("returns context items for run", async () => {
      const run = createRun(db, { id: "r1" });
      await runsRepo.insertContext({
        runId: run.id,
        kind: "file",
        ref: "src/index.ts",
        content: "file content",
      });
      await runsRepo.insertContext({
        runId: run.id,
        kind: "diff",
        content: "diff content",
      });

      const result = await runsRepo.findContextByRun("r1");
      expect(result).toHaveLength(2);
      expect(result[0].kind).toBe("file");
    });
  });

  describe("insertContext", () => {
    it("returns autoincrement id", async () => {
      const run = createRun(db, { id: "r1" });
      const id = await runsRepo.insertContext({
        runId: run.id,
        kind: "terminal",
        content: "$ npm test",
      });
      expect(id).toBeGreaterThan(0);
    });

    it("stores metadata as JSON", async () => {
      const run = createRun(db, { id: "r1" });
      await runsRepo.insertContext({
        runId: run.id,
        kind: "file",
        metadata: { language: "typescript" },
      });

      const items = await runsRepo.findContextByRun("r1");
      expect(items[0].metadata).toEqual({ language: "typescript" });
    });
  });

  describe("deleteContext", () => {
    it("deletes context item", async () => {
      const run = createRun(db, { id: "r1" });
      const id = await runsRepo.insertContext({
        runId: run.id,
        kind: "file",
      });
      await runsRepo.deleteContext(id);
      const result = await runsRepo.findContextByRun("r1");
      expect(result).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Run Artifact Operations
  // ─────────────────────────────────────────────────────────────
  describe("findArtifactsByRun", () => {
    it("returns empty when no artifacts", async () => {
      const result = await runsRepo.findArtifactsByRun("r1");
      expect(result).toEqual([]);
    });

    it("returns artifacts for run", async () => {
      const run = createRun(db, { id: "r1" });
      await runsRepo.insertArtifact({
        runId: run.id,
        kind: "file",
        path: "src/index.ts",
        content: "export default {}",
      });

      const result = await runsRepo.findArtifactsByRun("r1");
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe("src/index.ts");
    });
  });

  describe("insertArtifact", () => {
    it("returns autoincrement id", async () => {
      const run = createRun(db, { id: "r1" });
      const id = await runsRepo.insertArtifact({
        runId: run.id,
        kind: "patch",
        content: "patch content",
      });
      expect(id).toBeGreaterThan(0);
    });

    it("stores metadata as JSON", async () => {
      const run = createRun(db, { id: "r1" });
      await runsRepo.insertArtifact({
        runId: run.id,
        kind: "log",
        metadata: { lines: 42 },
      });

      const items = await runsRepo.findArtifactsByRun("r1");
      expect(items[0].metadata).toEqual({ lines: 42 });
    });
  });

  describe("deleteArtifact", () => {
    it("deletes artifact", async () => {
      const run = createRun(db, { id: "r1" });
      const id = await runsRepo.insertArtifact({
        runId: run.id,
        kind: "file",
      });
      await runsRepo.deleteArtifact(id);
      const result = await runsRepo.findArtifactsByRun("r1");
      expect(result).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Tool Call Operations
  // ─────────────────────────────────────────────────────────────
  describe("findToolCallsByRun", () => {
    it("returns empty when no tool calls", async () => {
      const result = await runsRepo.findToolCallsByRun("r1");
      expect(result).toEqual([]);
    });

    it("returns tool calls for run", async () => {
      const run = createRun(db, { id: "r1" });
      createToolCall(db, { runId: run.id, toolName: "Bash" });
      createToolCall(db, { runId: run.id, toolName: "Read" });

      const result = await runsRepo.findToolCallsByRun("r1");
      expect(result).toHaveLength(2);
    });
  });

  describe("insertToolCall", () => {
    it("creates a tool call and returns id", async () => {
      const run = createRun(db, { id: "r1" });
      const id = await runsRepo.insertToolCall({
        accountId: "default",
        runId: run.id,
        toolName: "Bash",
        input: { command: "ls -la" },
      });

      expect(id).toBeGreaterThan(0);
    });
  });

  describe("updateToolCall", () => {
    it("updates tool call fields", async () => {
      const run = createRun(db, { id: "r1" });
      const tc = createToolCall(db, { runId: run.id, toolName: "Bash" });

      await runsRepo.updateToolCall(tc.id, {
        status: "done",
        output: { result: "success" },
        latencyMs: 150,
      });

      const calls = await runsRepo.findToolCallsByRun("r1");
      const updated = calls.find((c) => c.id === tc.id);
      expect(updated!.status).toBe("done");
      expect(updated!.output).toEqual({ result: "success" });
      expect(updated!.latencyMs).toBe(150);
    });

    it("merges tool metadata so a plan decision survives provider completion", async () => {
      const run = createRun(db, { id: "r1" });
      const tc = createToolCall(db, { runId: run.id, toolName: "ExitPlanMode" });

      await runsRepo.updateToolCall(tc.id, {
        metadata: { planStatus: "applied" },
      });
      await runsRepo.updateToolCall(tc.id, {
        metadata: { phase: "complete", toolCallId: "tool-plan" },
      });

      const calls = await runsRepo.findToolCallsByRun("r1");
      const updated = calls.find((c) => c.id === tc.id);
      expect(updated!.metadata).toEqual({
        planStatus: "applied",
        phase: "complete",
        toolCallId: "tool-plan",
      });
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Run Turn Operations
  // ─────────────────────────────────────────────────────────────
  describe("findTurnsByRun", () => {
    it("returns empty when no turns", async () => {
      const result = await runsRepo.findTurnsByRun("r1");
      expect(result).toEqual([]);
    });

    it("returns turns ordered by turnIndex", async () => {
      const run = createRun(db, { id: "r1" });
      createRunTurn(db, { runId: run.id, turnIndex: 1 });
      createRunTurn(db, { runId: run.id, turnIndex: 0 });

      const result = await runsRepo.findTurnsByRun("r1");
      expect(result).toHaveLength(2);
      expect(result[0].turnIndex).toBe(0);
      expect(result[1].turnIndex).toBe(1);
    });
  });

  describe("findActiveTurnByRun", () => {
    it("returns null when no active turns", async () => {
      const result = await runsRepo.findActiveTurnByRun("r1");
      expect(result).toBeNull();
    });

    it("returns active turn", async () => {
      const run = createRun(db, { id: "r1" });
      createRunTurn(db, { runId: run.id, turnIndex: 0, status: "completed" });
      createRunTurn(db, { runId: run.id, turnIndex: 1, status: "active" });

      const result = await runsRepo.findActiveTurnByRun("r1");
      expect(result).not.toBeNull();
      expect(result!.turnIndex).toBe(1);
    });
  });

  describe("insertTurn", () => {
    it("creates a turn and returns id", async () => {
      const run = createRun(db, { id: "r1" });
      const id = await runsRepo.insertTurn({
        runId: run.id,
        turnIndex: 0,
        promptContent: "Fix this bug",
      });

      expect(id).toBeGreaterThan(0);

      const turns = await runsRepo.findTurnsByRun("r1");
      expect(turns[0].promptContent).toBe("Fix this bug");
      expect(turns[0].status).toBe("active");
    });
  });

  describe("updateTurn", () => {
    it("updates turn fields", async () => {
      const run = createRun(db, { id: "r1" });
      const turnId = await runsRepo.insertTurn({
        runId: run.id,
        turnIndex: 0,
      });

      await runsRepo.updateTurn(turnId, {
        status: "completed",
        responseContent: "Done!",
        inputTokens: 100,
        outputTokens: 50,
        costMicros: 1500,
        model: "claude-3-opus",
      });

      const turns = await runsRepo.findTurnsByRun("r1");
      const updated = turns[0];
      expect(updated.status).toBe("completed");
      expect(updated.responseContent).toBe("Done!");
      expect(updated.inputTokens).toBe(100);
      expect(updated.outputTokens).toBe(50);
      expect(updated.costMicros).toBe(1500);
      expect(updated.model).toBe("claude-3-opus");
    });

    it("stores model usage as JSON", async () => {
      const run = createRun(db, { id: "r1" });
      const turnId = await runsRepo.insertTurn({
        runId: run.id,
        turnIndex: 0,
      });

      await runsRepo.updateTurn(turnId, {
        modelUsage: {
          "claude-3-opus": {
            costUSD: 0.5,
            inputTokens: 1000,
            outputTokens: 500,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
          },
        },
      });

      const turns = await runsRepo.findTurnsByRun("r1");
      expect(turns[0].modelUsage).toEqual({
        "claude-3-opus": {
          costUSD: 0.5,
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      });
    });
  });

  describe("appendResponseContent", () => {
    it("appends to existing content", async () => {
      const run = createRun(db, { id: "r1" });
      const turnId = await runsRepo.insertTurn({
        runId: run.id,
        turnIndex: 0,
      });

      await runsRepo.updateTurn(turnId, { responseContent: "Hello " });
      await runsRepo.appendResponseContent(turnId, "World");

      const turns = await runsRepo.findTurnsByRun("r1");
      expect(turns[0].responseContent).toBe("Hello World");
    });

    it("handles null initial content", async () => {
      const run = createRun(db, { id: "r1" });
      const turnId = await runsRepo.insertTurn({
        runId: run.id,
        turnIndex: 0,
      });

      await runsRepo.appendResponseContent(turnId, "First chunk");

      const turns = await runsRepo.findTurnsByRun("r1");
      expect(turns[0].responseContent).toBe("First chunk");
    });
  });

  describe("deleteTurnsByRun", () => {
    it("deletes all turns for run", async () => {
      const run = createRun(db, { id: "r1" });
      createRunTurn(db, { runId: run.id, turnIndex: 0 });
      createRunTurn(db, { runId: run.id, turnIndex: 1 });

      await runsRepo.deleteTurnsByRun("r1");
      const result = await runsRepo.findTurnsByRun("r1");
      expect(result).toEqual([]);
    });
  });
});
