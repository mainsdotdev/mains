import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../modules/runs", () => ({
  RunArtifactKind: {},
  runsService: {
    addArtifact: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock("../../modules/tools", () => ({
  toolsService: {
    createToolCall: vi.fn().mockResolvedValue(1),
    updateToolCall: vi.fn().mockResolvedValue(undefined),
    findToolCallRowId: vi.fn().mockResolvedValue(null),
    findOpenToolCallRowId: vi.fn().mockResolvedValue(null),
  },
}));

import { createRunWriteback } from "./runWriteback";
import { runsService } from "../../modules/runs";
import { toolsService } from "../../modules/tools";

const CONFIG = {
  accountId: "acc-1",
  providerId: "copilot_cli",
  runId: "run-1",
};

describe("runWriteback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates writeback with zero pending tool calls", () => {
    const wb = createRunWriteback(CONFIG);
    expect(wb.getPendingToolCallCount()).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // Log events
  // ─────────────────────────────────────────────────────────────
  describe("log events", () => {
    it("persists log event as artifact", async () => {
      const wb = createRunWriteback(CONFIG);

      await wb.handleEvent({
        type: "log",
        message: "Hello world",
      });

      expect(runsService.addArtifact).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "run-1",
          kind: "log",
          content: "Hello world",
        }),
      );
    });

    it("includes level and timestamp in metadata", async () => {
      const wb = createRunWriteback(CONFIG);

      await wb.handleEvent({
        type: "log",
        message: "Warning",
        level: "warn",
        ts: 1234567890,
      });

      expect(runsService.addArtifact).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            level: "warn",
            ts: 1234567890,
          }),
        }),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Artifact events
  // ─────────────────────────────────────────────────────────────
  describe("artifact events", () => {
    it("persists artifact with content hash", async () => {
      const wb = createRunWriteback(CONFIG);

      await wb.handleEvent({
        type: "artifact",
        kind: "file",
        path: "/src/main.ts",
        content: "const x = 1;",
      });

      expect(runsService.addArtifact).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "run-1",
          kind: "file",
          path: "/src/main.ts",
          content: "const x = 1;",
          contentHash: expect.any(String),
        }),
      );
    });

    it("persists artifact without content (no hash)", async () => {
      const wb = createRunWriteback(CONFIG);

      await wb.handleEvent({
        type: "artifact",
        kind: "report",
        metadata: { key: "val" },
      });

      expect(runsService.addArtifact).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "report",
          contentHash: undefined,
        }),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Tool call events - start phase
  // ─────────────────────────────────────────────────────────────
  describe("tool_call start", () => {
    it("creates tool call and adds to pending map", async () => {
      const wb = createRunWriteback(CONFIG);

      await wb.handleEvent({
        type: "tool_call",
        toolName: "Bash",
        metadata: { phase: "start", toolCallId: "tc-1" },
      });

      expect(toolsService.createToolCall).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "acc-1",
          runId: "run-1",
          toolName: "Bash",
          status: "running",
          toolCallId: "tc-1",
        }),
      );
      expect(wb.getPendingToolCallCount()).toBe(1);
    });

    it("uses fallback key when no toolCallId", async () => {
      const wb = createRunWriteback(CONFIG);

      await wb.handleEvent({
        type: "tool_call",
        toolName: "Read",
        metadata: { phase: "start" },
      });

      expect(toolsService.createToolCall).toHaveBeenCalled();
      expect(wb.getPendingToolCallCount()).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Tool call events - end phase
  // ─────────────────────────────────────────────────────────────
  describe("tool_call end", () => {
    it("correlates by toolCallId via DB lookup", async () => {
      vi.mocked(toolsService.findToolCallRowId).mockResolvedValueOnce(42);

      const wb = createRunWriteback(CONFIG);

      await wb.handleEvent({
        type: "tool_call",
        toolName: "Bash",
        output: { stdout: "ok" },
        metadata: { phase: "end", toolCallId: "tc-1" },
        startedAt: 1000,
        endedAt: 2000,
      });

      expect(toolsService.findToolCallRowId).toHaveBeenCalledWith("run-1", "tc-1");
      expect(toolsService.updateToolCall).toHaveBeenCalledWith(
        42,
        expect.objectContaining({
          status: "done",
          latencyMs: 1000,
        }),
      );
    });

    it("correlates by pending map when DB lookup fails", async () => {
      vi.mocked(toolsService.findToolCallRowId).mockResolvedValue(null);
      vi.mocked(toolsService.createToolCall).mockResolvedValueOnce(99);

      const wb = createRunWriteback(CONFIG);

      // Start phase
      await wb.handleEvent({
        type: "tool_call",
        toolName: "Bash",
        metadata: { phase: "start", toolCallId: "tc-2" },
      });
      expect(wb.getPendingToolCallCount()).toBe(1);

      // End phase
      await wb.handleEvent({
        type: "tool_call",
        toolName: "Bash",
        metadata: { phase: "end", toolCallId: "tc-2" },
      });

      expect(toolsService.updateToolCall).toHaveBeenCalledWith(
        99,
        expect.objectContaining({ status: "done" }),
      );
      expect(wb.getPendingToolCallCount()).toBe(0);
    });

    it("correlates by toolName fallback when key not in pending map", async () => {
      vi.mocked(toolsService.findToolCallRowId).mockResolvedValue(null);
      vi.mocked(toolsService.createToolCall).mockResolvedValueOnce(77);

      const wb = createRunWriteback(CONFIG);

      // Start with a composite key (no toolCallId)
      await wb.handleEvent({
        type: "tool_call",
        toolName: "Grep",
        metadata: { phase: "start" },
        startedAt: 5000,
      });
      expect(wb.getPendingToolCallCount()).toBe(1);

      // End with a different composite key but same toolName
      await wb.handleEvent({
        type: "tool_call",
        toolName: "Grep",
        metadata: { phase: "end" },
        startedAt: 6000,
        endedAt: 7000,
      });

      // Should find via findPendingToolCallByName fallback
      expect(toolsService.updateToolCall).toHaveBeenCalledWith(
        77,
        expect.objectContaining({ status: "done" }),
      );
      expect(wb.getPendingToolCallCount()).toBe(0);
    });

    it("falls back to DB open tool call lookup when not in pending map", async () => {
      vi.mocked(toolsService.findToolCallRowId).mockResolvedValue(null);
      vi.mocked(toolsService.findOpenToolCallRowId).mockResolvedValueOnce(55);

      const wb = createRunWriteback(CONFIG);

      await wb.handleEvent({
        type: "tool_call",
        toolName: "Write",
        metadata: { phase: "end", toolCallId: "unknown-tc" },
      });

      expect(toolsService.findOpenToolCallRowId).toHaveBeenCalledWith("run-1", "Write");
      expect(toolsService.updateToolCall).toHaveBeenCalledWith(
        55,
        expect.objectContaining({ status: "done" }),
      );
    });

    it("creates new record when no correlation found", async () => {
      vi.mocked(toolsService.findToolCallRowId).mockResolvedValue(null);
      vi.mocked(toolsService.findOpenToolCallRowId).mockResolvedValue(null);
      vi.mocked(toolsService.createToolCall).mockResolvedValueOnce(88);

      const wb = createRunWriteback(CONFIG);

      await wb.handleEvent({
        type: "tool_call",
        toolName: "Edit",
        output: { result: "ok" },
        metadata: { phase: "end", toolCallId: "orphan-tc" },
      });

      // Should create a new record since no correlation found
      expect(toolsService.createToolCall).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: "Edit",
          status: "done",
        }),
      );
    });

    it("sets error status when event has error", async () => {
      vi.mocked(toolsService.findToolCallRowId).mockResolvedValueOnce(10);

      const wb = createRunWriteback(CONFIG);

      await wb.handleEvent({
        type: "tool_call",
        toolName: "Bash",
        error: "command failed",
        metadata: { phase: "end", toolCallId: "tc-err" },
      });

      expect(toolsService.updateToolCall).toHaveBeenCalledWith(
        10,
        expect.objectContaining({
          status: "error",
          error: "command failed",
        }),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Tool call events - no phase (complete record)
  // ─────────────────────────────────────────────────────────────
  describe("tool_call no phase", () => {
    it("creates a complete tool call record", async () => {
      vi.mocked(toolsService.createToolCall).mockResolvedValueOnce(33);

      const wb = createRunWriteback(CONFIG);

      await wb.handleEvent({
        type: "tool_call",
        toolName: "Read",
        input: { path: "/file.ts" },
        output: { content: "code" },
        startedAt: 1000,
        endedAt: 1500,
      });

      expect(toolsService.createToolCall).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: "Read",
          status: "done",
        }),
      );
      expect(toolsService.updateToolCall).toHaveBeenCalledWith(
        33,
        expect.objectContaining({
          startedAt: expect.any(Date),
          endedAt: expect.any(Date),
        }),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Status events
  // ─────────────────────────────────────────────────────────────
  describe("status events", () => {
    it("handles status event without error (noop)", async () => {
      const wb = createRunWriteback(CONFIG);

      await wb.handleEvent({
        type: "status",
        status: "running",
      });

      // Status events are just logged, no DB writes
      expect(runsService.addArtifact).not.toHaveBeenCalled();
      expect(toolsService.createToolCall).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Error handling
  // ─────────────────────────────────────────────────────────────
  describe("error handling", () => {
    it("catches and logs errors in event handler", async () => {
      vi.mocked(runsService.addArtifact).mockRejectedValueOnce(new Error("db down"));

      const wb = createRunWriteback(CONFIG);

      // Should not throw
      await wb.handleEvent({
        type: "log",
        message: "will fail",
      });
    });
  });

  // ─────────────────────────────────────────────────────────────
  // extractToolCallIds
  // ─────────────────────────────────────────────────────────────
  describe("toolCallId extraction", () => {
    it("extracts tool_call_id from snake_case metadata", async () => {
      vi.mocked(toolsService.createToolCall).mockResolvedValueOnce(11);

      const wb = createRunWriteback(CONFIG);

      await wb.handleEvent({
        type: "tool_call",
        toolName: "Bash",
        metadata: { phase: "start", tool_call_id: "snake-id" },
      });

      expect(toolsService.createToolCall).toHaveBeenCalledWith(
        expect.objectContaining({
          toolCallId: "snake-id",
        }),
      );
    });

    it("extracts parentToolCallId from metadata", async () => {
      vi.mocked(toolsService.createToolCall).mockResolvedValueOnce(12);

      const wb = createRunWriteback(CONFIG);

      await wb.handleEvent({
        type: "tool_call",
        toolName: "Bash",
        metadata: { phase: "start", toolCallId: "child", parentToolCallId: "parent" },
      });

      expect(toolsService.createToolCall).toHaveBeenCalledWith(
        expect.objectContaining({
          toolCallId: "child",
          parentToolCallId: "parent",
        }),
      );
    });

    it("extracts id field as toolCallId fallback", async () => {
      vi.mocked(toolsService.createToolCall).mockResolvedValueOnce(13);

      const wb = createRunWriteback(CONFIG);

      await wb.handleEvent({
        type: "tool_call",
        toolName: "Bash",
        metadata: { phase: "start", id: "id-fallback" },
      });

      expect(toolsService.createToolCall).toHaveBeenCalledWith(
        expect.objectContaining({
          toolCallId: "id-fallback",
        }),
      );
    });
  });
});
