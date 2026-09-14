import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────

vi.mock("../../modules/providers", () => ({
  providersService: {
    getById: vi.fn(),
  },
}));

vi.mock("../../modules/workspace", () => ({
  workspaceService: {
    get: vi.fn(),
  },
}));

vi.mock("../../modules/runs", () => ({
  runsService: {
    createRun: vi.fn().mockResolvedValue({ success: true }),
    updateRun: vi.fn().mockResolvedValue({ success: true }),
    addContext: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock("../../modules/providers/adapters", () => ({
  createWorkAdapter: vi.fn(),
  isSupportedWorkProvider: vi.fn(),
}));

vi.mock("../writeback/runWriteback", () => ({
  createRunWriteback: vi.fn().mockReturnValue({
    handleEvent: vi.fn().mockResolvedValue(undefined),
    getPendingToolCallCount: vi.fn().mockReturnValue(0),
  }),
}));

import { dispatchRun, dispatchRunAsync } from "./runDispatcher";
import { providersService } from "../../modules/providers";
import { workspaceService } from "../../modules/workspace";
import { runsService } from "../../modules/runs";
import { createWorkAdapter, isSupportedWorkProvider } from "../../modules/providers/adapters";
import { createRunWriteback } from "../writeback/runWriteback";

// ── Helpers ──────────────────────────────────────────────────

const VALID_PROVIDER = {
  id: "copilot_cli",
  displayName: "Copilot CLI",
  isEnabled: true,
  kind: "agent_runtime",
};

const VALID_WORKSPACE = {
  id: "ws-1",
  rootPath: "/tmp/ws",
};

const BASE_REQUEST = {
  accountId: "acc-1",
  workspaceId: "ws-1",
  providerId: "copilot_cli",
  goal: "fix bugs",
};

function setupHappyPath(resultOverride?: Partial<{ status: string; summary: string }>) {
  vi.mocked(providersService.getById).mockResolvedValue(VALID_PROVIDER as never);
  vi.mocked(workspaceService.get).mockResolvedValue(VALID_WORKSPACE as never);
  vi.mocked(isSupportedWorkProvider).mockReturnValue(true);

  const mockStartRun = vi.fn().mockImplementation(async (_req, onEvent) => {
    await onEvent({ type: "log", message: "hello" });
    return { status: "succeeded", summary: "done", ...resultOverride };
  });

  vi.mocked(createWorkAdapter).mockReturnValue({ startRun: mockStartRun } as never);

  return mockStartRun;
}

// ─────────────────────────────────────────────────────────────

describe("runDispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────
  // Provider validation
  // ─────────────────────────────────────────────────────────
  describe("provider validation", () => {
    it("throws when provider not found", async () => {
      vi.mocked(providersService.getById).mockResolvedValue(null);

      await expect(dispatchRun(BASE_REQUEST)).rejects.toThrow(
        'Provider "copilot_cli" not found',
      );
    });

    it("throws when provider is disabled", async () => {
      vi.mocked(providersService.getById).mockResolvedValue({
        ...VALID_PROVIDER,
        isEnabled: false,
      } as never);

      await expect(dispatchRun(BASE_REQUEST)).rejects.toThrow("is not enabled");
    });

    it("throws when provider kind is not agent_runtime", async () => {
      vi.mocked(providersService.getById).mockResolvedValue({
        ...VALID_PROVIDER,
        kind: "llm",
      } as never);

      await expect(dispatchRun(BASE_REQUEST)).rejects.toThrow("is not an agent runtime");
    });

    it("throws when provider is not a supported work provider", async () => {
      vi.mocked(providersService.getById).mockResolvedValue(VALID_PROVIDER as never);
      vi.mocked(isSupportedWorkProvider).mockReturnValue(false);

      await expect(dispatchRun(BASE_REQUEST)).rejects.toThrow("is not a supported work provider");
    });
  });

  // ─────────────────────────────────────────────────────────
  // Workspace validation
  // ─────────────────────────────────────────────────────────
  describe("workspace validation", () => {
    it("throws when workspace not found", async () => {
      vi.mocked(providersService.getById).mockResolvedValue(VALID_PROVIDER as never);
      vi.mocked(isSupportedWorkProvider).mockReturnValue(true);
      vi.mocked(workspaceService.get).mockResolvedValue(null);

      await expect(dispatchRun(BASE_REQUEST)).rejects.toThrow('Workspace "ws-1" not found');
    });
  });

  // ─────────────────────────────────────────────────────────
  // Run creation failure
  // ─────────────────────────────────────────────────────────
  describe("run creation", () => {
    it("throws when createRun fails", async () => {
      vi.mocked(providersService.getById).mockResolvedValue(VALID_PROVIDER as never);
      vi.mocked(isSupportedWorkProvider).mockReturnValue(true);
      vi.mocked(workspaceService.get).mockResolvedValue(VALID_WORKSPACE as never);
      vi.mocked(runsService.createRun).mockRejectedValueOnce(
        new Error("db error"),
      );

      await expect(dispatchRun(BASE_REQUEST)).rejects.toThrow("db error");
    });
  });

  // ─────────────────────────────────────────────────────────
  // Happy path
  // ─────────────────────────────────────────────────────────
  describe("happy path", () => {
    it("completes successfully with succeeded status", async () => {
      setupHappyPath();

      const res = await dispatchRun(BASE_REQUEST);

      expect(res.runId).toEqual(expect.any(String));
      expect(res.result.status).toBe("succeeded");

      // Verify run was created
      expect(runsService.createRun).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "ws-1",
          providerId: "copilot_cli",
          goal: "fix bugs",
          status: "running",
        }),
      );

      // Verify startedAt was set
      expect(runsService.updateRun).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ startedAt: expect.any(Date) }),
      );

      // Verify final status update
      expect(runsService.updateRun).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: "succeeded", endedAt: expect.any(Date) }),
      );
    });

    it("sets failed status on failed result", async () => {
      setupHappyPath({ status: "failed", summary: "something broke" });

      const res = await dispatchRun(BASE_REQUEST);
      expect(res.result.status).toBe("failed");

      expect(runsService.updateRun).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          status: "failed",
          lastError: "something broke",
        }),
      );
    });

    it("sets canceled status on canceled result", async () => {
      setupHappyPath({ status: "canceled" });

      const res = await dispatchRun(BASE_REQUEST);
      expect(res.result.status).toBe("canceled");

      expect(runsService.updateRun).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: "canceled" }),
      );
    });

    it("streams events through writeback", async () => {
      setupHappyPath();

      await dispatchRun(BASE_REQUEST);

      const wb = vi.mocked(createRunWriteback).mock.results[0]!.value;
      expect(wb.handleEvent).toHaveBeenCalledWith({ type: "log", message: "hello" });
    });

    it("passes model and systemPrompt to adapter", async () => {
      setupHappyPath();

      await dispatchRun({
        ...BASE_REQUEST,
        model: "claude-opus-4-6",
        systemPrompt: "Be helpful",
      });

      expect(vi.mocked(createWorkAdapter).mock.results[0]!.value.startRun).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "claude-opus-4-6",
          systemPrompt: "Be helpful",
        }),
        expect.any(Function),
      );
    });
  });

  // ─────────────────────────────────────────────────────────
  // Context persistence
  // ─────────────────────────────────────────────────────────
  describe("context persistence", () => {
    it("persists initial context items", async () => {
      setupHappyPath();

      await dispatchRun({
        ...BASE_REQUEST,
        initialContext: [
          { kind: "file", ref: "/src/main.ts", content: "code" },
          { kind: "note", content: "important note" },
        ],
      });

      expect(runsService.addContext).toHaveBeenCalledTimes(2);
      expect(runsService.addContext).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "file",
          ref: "/src/main.ts",
          content: "code",
        }),
      );
    });

    it("skips context persistence when no initialContext", async () => {
      setupHappyPath();

      await dispatchRun(BASE_REQUEST);

      expect(runsService.addContext).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────
  // Adapter error handling
  // ─────────────────────────────────────────────────────────
  describe("adapter error handling", () => {
    it("catches adapter errors and marks run as failed", async () => {
      vi.mocked(providersService.getById).mockResolvedValue(VALID_PROVIDER as never);
      vi.mocked(workspaceService.get).mockResolvedValue(VALID_WORKSPACE as never);
      vi.mocked(isSupportedWorkProvider).mockReturnValue(true);

      vi.mocked(createWorkAdapter).mockReturnValue({
        startRun: vi.fn().mockRejectedValue(new Error("adapter crashed")),
      } as never);

      const res = await dispatchRun(BASE_REQUEST);

      expect(res.result.status).toBe("failed");
      expect(res.result.summary).toBe("adapter crashed");

      expect(runsService.updateRun).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          status: "failed",
          lastError: "adapter crashed",
        }),
      );
    });

    it("handles non-Error throws", async () => {
      vi.mocked(providersService.getById).mockResolvedValue(VALID_PROVIDER as never);
      vi.mocked(workspaceService.get).mockResolvedValue(VALID_WORKSPACE as never);
      vi.mocked(isSupportedWorkProvider).mockReturnValue(true);

      vi.mocked(createWorkAdapter).mockReturnValue({
        startRun: vi.fn().mockRejectedValue("string error"),
      } as never);

      const res = await dispatchRun(BASE_REQUEST);

      expect(res.result.status).toBe("failed");
      expect(res.result.summary).toBe("string error");
    });
  });

  // ─────────────────────────────────────────────────────────
  // dispatchRunAsync
  // ─────────────────────────────────────────────────────────
  describe("dispatchRunAsync", () => {
    it("returns runId immediately", () => {
      // Mock enough to not throw synchronously
      vi.mocked(providersService.getById).mockResolvedValue(VALID_PROVIDER as never);
      vi.mocked(workspaceService.get).mockResolvedValue(VALID_WORKSPACE as never);
      vi.mocked(isSupportedWorkProvider).mockReturnValue(true);
      vi.mocked(createWorkAdapter).mockReturnValue({
        startRun: vi.fn().mockResolvedValue({ status: "succeeded" }),
      } as never);

      const runId = dispatchRunAsync(BASE_REQUEST);

      expect(runId).toEqual(expect.any(String));
      expect(runId).toMatch(/^[0-9a-f-]{36}$/);
    });
  });
});
