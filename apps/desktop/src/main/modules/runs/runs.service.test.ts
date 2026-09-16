import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { createTestDb } from "../../../test/setup-db";
import {
  createAccount,
  createCollection,
  createProvider,
  createProject,
  createWorkspace,
  createSpace,
  createRun,
  createRunContext,
  createRunArtifact,
  createToolCall,
  createRunTurn,
} from "../../../test/factories";
import { eq } from "drizzle-orm";
import { collections } from "../../db/schema";
import type { DatabaseInstance } from "../../db/types";
import type Database from "better-sqlite3";

const flushBackground = () => new Promise((r) => setTimeout(r, 50));

let db: DatabaseInstance;
let _sqlite: Database.Database;
let cleanup: () => void;

vi.mock("../../db/client", () => ({
  getDb: () => db,
}));

vi.mock("electron", () => ({
  powerSaveBlocker: {
    start: vi.fn(() => 1),
    stop: vi.fn(),
    isStarted: vi.fn(() => true),
  },
  Notification: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    show: vi.fn(),
  })),
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  app: {
    isReady: () => true,
    whenReady: () => Promise.resolve(),
    getPath: (name: string) => `/tmp/mains-test/${name}`,
    isPackaged: false,
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, "utf-8"),
    decryptString: (b: Buffer) => b.toString("utf-8"),
  },
}));

vi.mock("../providers/adapters", () => ({
  createWorkAdapter: vi.fn(),
  couldModifyFiles: vi.fn().mockReturnValue(false),
}));

// gitService is throw-style: plain resolved values, rejects on failure.
vi.mock("../git/git.service", () => ({
  gitService: {
    getHeadSha: vi.fn(),
    captureDiffSnapshot: vi.fn(),
  },
}));

// Workspace fixtures use synthetic /tmp/ws/<uuid> paths that were never created
// on disk, so the real filesystem would report every one of them missing and the
// run-start guard would reject them. Default to "present" and let the guard's own
// tests flip this.
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, existsSync: vi.fn(() => true) };
});

// Mock only the fire-and-forget side of the workspace aggregate.
// workspaceRepo runs against the real test DB so runs.service can find/update
// workspaces created via createWorkspace(...). createDiff and logWorkspaceActivity
// are stubbed so the diff/activity side effects don't try to do real work.
vi.mock("../workspace", async () => {
  const actual = await vi.importActual<typeof import("../workspace")>(
    "../workspace",
  );
  return {
    ...actual,
    workspaceService: {
      ...actual.workspaceService,
      createDiff: vi
        .fn()
        .mockResolvedValue({ success: true, data: "diff-id" }),
    },
    logWorkspaceActivity: vi.fn(),
  };
});

import { runsService } from "./runs.service";
import { runsRepo } from "./runs.repo";
import { managedRunDir } from "./run-execution";
import { runSessionRegistry } from "./run-session-registry";
import { createWorkAdapter } from "../providers/adapters";
import { workspaceService } from "../workspace";
import { gitService } from "../git/git.service";

describe("runsService", () => {
  beforeEach(() => {
    ({ db, sqlite: _sqlite, cleanup } = createTestDb());
    // Workspace folders exist unless a test says otherwise (see the fs mock).
    vi.mocked(existsSync).mockReturnValue(true);
    // Defaults for the throw-style git mock: no repo unless a test overrides,
    // and an empty snapshot so sessions that DO get a baseRef can finalize.
    vi.mocked(gitService.getHeadSha).mockRejectedValue(
      new Error("not a git repo"),
    );
    vi.mocked(gitService.captureDiffSnapshot).mockResolvedValue({
      baseRef: "",
      diffText: "",
      files: [],
      untrackedFiles: [],
      shortstat: "",
    });
    createAccount(db, { id: "default" });
    createProvider(db, { id: "copilot_cli" });
    // Work and Chat runs need a provider that drives those modes (see
    // shared/modes.ts `PROVIDER_MODES`).
    createProvider(db, { id: "claude_code" });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────
  // Run Operations
  // ─────────────────────────────────────────────────────────────
  describe("getAllRuns", () => {
    it("returns empty array when no runs", async () => {
      const result = await runsService.getAllRuns();
      expect(result).toEqual([]);
    });

    it("returns all runs", async () => {
      createRun(db, { id: "r1" });
      createRun(db, { id: "r2" });

      const result = await runsService.getAllRuns();
      expect(result).toHaveLength(2);
    });

    it("respects limit parameter", async () => {
      createRun(db, { id: "r1" });
      createRun(db, { id: "r2" });
      createRun(db, { id: "r3" });

      const result = await runsService.getAllRuns(2);
      expect(result).toHaveLength(2);
    });

    it("returns error when repo throws", async () => {
      vi.spyOn(runsRepo, "findAllRuns").mockRejectedValueOnce(new Error("db error"));
      await expect(runsService.getAllRuns()).rejects.toThrow("db error");
    });
  });

  describe("listArchivedRuns", () => {
    it("returns archived runs enriched with their workspace", async () => {
      createWorkspace(db, { id: "ws1", name: "Website" });
      createRun(db, {
        id: "r1",
        workspaceId: "ws1",
        isArchived: true,
      });
      createRun(db, { id: "r2" });

      const result = await runsService.listArchivedRuns();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "r1",
        workspace: { id: "ws1", name: "Website", isArchived: false },
      });
    });

    it("keeps archived runs whose workspace is no longer attached", async () => {
      createRun(db, { id: "r1", isArchived: true });

      const [result] = await runsService.listArchivedRuns();

      expect(result.workspace).toBeNull();
      expect(result.collection).toBeNull();
    });

    it("labels a workspace with its project's icon", async () => {
      createProject(db, { id: "p1", name: "Mains", icon: "icon:rocket" });
      createWorkspace(db, { id: "ws1", name: "Website", projectId: "p1" });
      createRun(db, { id: "r1", workspaceId: "ws1", isArchived: true });

      const [result] = await runsService.listArchivedRuns();

      expect(result.workspace).toMatchObject({ id: "ws1", icon: "icon:rocket" });
    });

    it("labels a chat with the Collection it is filed under", async () => {
      createCollection(db, { id: "c1", name: "Life", icon: "emoji:❤️" });
      createRun(db, {
        id: "r1",
        providerId: "claude_code",
        mode: "chat",
        collectionId: "c1",
        isArchived: true,
      });

      const [result] = await runsService.listArchivedRuns();

      expect(result.workspace).toBeNull();
      expect(result.collection).toEqual({
        id: "c1",
        name: "Life",
        icon: "emoji:❤️",
      });
    });

    it("unfiles a chat when its Collection is deleted", async () => {
      createCollection(db, { id: "c1", name: "Life" });
      createRun(db, {
        id: "r1",
        providerId: "claude_code",
        mode: "chat",
        collectionId: "c1",
        isArchived: true,
      });
      // Deleting a Collection detaches its runs (FK ON DELETE SET NULL) — the
      // archived chat outlives the project and falls back to "No project".
      db.delete(collections).where(eq(collections.id, "c1")).run();

      const [result] = await runsService.listArchivedRuns();

      expect(result.collectionId).toBeNull();
      expect(result.collection).toBeNull();
    });
  });

  describe("listActiveRuns", () => {
    const registerSession = (runId: string) => {
      runSessionRegistry.register(runId, {
        runId,
        project: vi.fn(),
        abort: vi.fn(),
        finalize: vi.fn(),
        updateBaseRef: vi.fn(),
      });
      return () => runSessionRegistry.unregister(runId);
    };

    it("returns running runs with a live session, labelled with their workspace", async () => {
      createWorkspace(db, { id: "ws1", name: "Website" });
      createRun(db, { id: "r1", workspaceId: "ws1", status: "running" });
      createRun(db, { id: "r2", status: "succeeded" });
      const unregister = registerSession("r1");

      const result = await runsService.listActiveRuns();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "r1",
        workspace: { id: "ws1", name: "Website" },
      });
      unregister();
    });

    it("drops running rows left behind by a crash", async () => {
      createRun(db, { id: "r1", status: "running" });
      // No session registered — the DB says running, the process disagrees.

      expect(await runsService.listActiveRuns()).toEqual([]);
    });

    it("keeps queued runs, which have no session yet", async () => {
      createRun(db, { id: "r1", status: "queued" });

      const result = await runsService.listActiveRuns();

      expect(result.map((run) => run.id)).toEqual(["r1"]);
    });

    it("skips archived runs", async () => {
      createRun(db, { id: "r1", status: "running", isArchived: true });
      const unregister = registerSession("r1");

      expect(await runsService.listActiveRuns()).toEqual([]);
      unregister();
    });

    it("reports a detached run with a null workspace rather than dropping it", async () => {
      createRun(db, { id: "r1", status: "queued" });

      const [result] = await runsService.listActiveRuns();

      expect(result.workspace).toBeNull();
    });
  });

  describe("getRunById", () => {
    it("returns run when found", async () => {
      createRun(db, { id: "r1" });

      const result = (await runsService.getRunById("r1"))!;
      expect(result.id).toBe("r1");
    });

    it("returns error when not found", async () => {
      expect(await runsService.getRunById("nonexistent")).toBeNull();
    });

    it("returns error when repo throws", async () => {
      vi.spyOn(runsRepo, "findRunById").mockRejectedValueOnce(new Error("db error"));
      await expect(runsService.getRunById("r1")).rejects.toThrow("db error");
    });
  });

  describe("getRunsByAccount", () => {
    it("returns runs for account", async () => {
      createRun(db, { id: "r1", accountId: "default" });

      const result = await runsService.getRunsByAccount("default");
      expect(result).toHaveLength(1);
    });

    it("returns empty for unknown account", async () => {
      const result = await runsService.getRunsByAccount("unknown");
      expect(result).toEqual([]);
    });

    it("respects limit parameter", async () => {
      createRun(db, { id: "r1", accountId: "default" });
      createRun(db, { id: "r2", accountId: "default" });
      createRun(db, { id: "r3", accountId: "default" });

      const result = await runsService.getRunsByAccount("default", 2);
      expect(result).toHaveLength(2);
    });

    it("returns error when repo throws", async () => {
      vi.spyOn(runsRepo, "findRunsByAccount").mockRejectedValueOnce(new Error("db error"));
      await expect(runsService.getRunsByAccount("default")).rejects.toThrow("db error");
    });
  });

  describe("getRunsByWorkspace", () => {
    it("returns runs for workspace", async () => {
      const ws = createWorkspace(db, { id: "ws1" });
      createRun(db, { id: "r1", workspaceId: ws.id });

      const result = await runsService.getRunsByWorkspace("ws1");
      expect(result).toHaveLength(1);
    });

    it("returns empty for unknown workspace", async () => {
      const result = await runsService.getRunsByWorkspace("unknown-ws");
      expect(result).toEqual([]);
    });

    it("returns error when repo throws", async () => {
      vi.spyOn(runsRepo, "findRunsByWorkspace").mockRejectedValueOnce(new Error("db error"));
      await expect(runsService.getRunsByWorkspace("ws1")).rejects.toThrow("db error");
    });
  });

  describe("getRunsByStatus", () => {
    it("returns runs filtered by status", async () => {
      createRun(db, { id: "r1", status: "running" });
      createRun(db, { id: "r2", status: "succeeded" });

      const result = await runsService.getRunsByStatus("default", "running");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("r1");
    });

    it("returns empty when no runs match status", async () => {
      createRun(db, { id: "r1", status: "running" });

      const result = await runsService.getRunsByStatus("default", "failed");
      expect(result).toEqual([]);
    });

    it("returns error when repo throws", async () => {
      vi.spyOn(runsRepo, "findRunsByStatus").mockRejectedValueOnce(new Error("db error"));
      await expect(runsService.getRunsByStatus("default", "running")).rejects.toThrow("db error");
    });
  });

  describe("createRun", () => {
    it("creates a run and returns id", async () => {
      const result = await runsService.createRun({
        id: "new-run-1",
        accountId: "default",
        providerId: "copilot_cli",
      });
      expect(result).toBe("new-run-1");
    });

    it("creates a run with all optional fields", async () => {
      const ws = createWorkspace(db, { id: "ws1" });
      const result = await runsService.createRun({
        id: "new-run-2",
        accountId: "default",
        providerId: "copilot_cli",
        workspaceId: ws.id,
        model: "gpt-4",
        title: "Test run",
        goal: "Do something",
        status: "running",
        systemPrompt: "You are helpful",
      });
      expect(result).toBe("new-run-2");
    });

    it("returns error when repo throws", async () => {
      vi.spyOn(runsRepo, "insertRun").mockRejectedValueOnce(new Error("db error"));
      await expect(runsService.createRun({ id: "fail-run", accountId: "default", providerId: "copilot_cli", })).rejects.toThrow("db error");
    });
  });

  describe("updateRun", () => {
    it("updates an existing run", async () => {
      createRun(db, { id: "r1", status: "queued" });

      const result = await runsService.updateRun("r1", { status: "running" });
      expect(result.status).toBe("running");
    });

    it("returns error for nonexistent run", async () => {
      await expect(runsService.updateRun("nonexistent", { status: "running" })).rejects.toThrow("Run not found");
    });

    it("updates multiple fields", async () => {
      createRun(db, { id: "r1", status: "queued" });

      const result = await runsService.updateRun("r1", {
        status: "running",
        title: "Updated title",
        model: "claude-3",
      });
      expect(result.status).toBe("running");
      expect(result.title).toBe("Updated title");
      expect(result.model).toBe("claude-3");
    });

    it("returns error when repo throws", async () => {
      vi.spyOn(runsRepo, "updateRun").mockRejectedValueOnce(new Error("db error"));
      await expect(runsService.updateRun("r1", { status: "running" })).rejects.toThrow("db error");
    });
  });

  describe("startRun", () => {
    it("sets status to running", async () => {
      createRun(db, { id: "r1", status: "queued" });

      const result = await runsService.startRun("r1");
      expect(result.status).toBe("running");
    });

    it("sets startedAt timestamp", async () => {
      createRun(db, { id: "r1", status: "queued" });

      const result = await runsService.startRun("r1");
      expect(result.startedAt).toBeTruthy();
    });

    it("returns error for nonexistent run", async () => {
      await expect(runsService.startRun("nonexistent")).rejects.toThrow("Run not found");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Mode snapshot (work mode) — executeRun resolves the space's mode,
  // stamps it on the run row, and hands the resolved instruction delta
  // to the adapter; continueRun re-applies the stored snapshot.
  // ─────────────────────────────────────────────────────────────
  describe("executeRun mode snapshot", () => {
    function mockStartAdapter() {
      const startRun = vi.fn().mockResolvedValue({ status: "succeeded" });
      vi.mocked(createWorkAdapter).mockReturnValue({ startRun } as any);
      return startRun;
    }

    it("snapshots work mode from the space and passes the delta to the adapter", async () => {
      createSpace(db, {
        id: "sp-work",
        accountId: "default",
        providerId: "claude_code",
        mode: "work",
      });
      const startRun = mockStartAdapter();

      const { runId } = await runsService.executeRun({
        accountId: "default",
        spaceId: "sp-work",
        providerId: "claude_code",
        goal: "write a report",
      });
      await flushBackground();

      const run = await runsService.getRunById(runId);
      expect(run?.mode).toBe("work");
      expect(run?.workspaceId).toBeNull();
      const request = startRun.mock.calls[0][0];
      expect(request.mode).toBe("work");
      expect(request.execution.workspaceId).toBeNull();
      expect(request.execution.cwd).toContain(`/runs/${runId}/work`);
      expect(request.extraInstructions).toContain("non-technical");
      expect(gitService.getHeadSha).not.toHaveBeenCalled();
    });

    it("rejects a Workspace on a new Work run", async () => {
      createWorkspace(db, { id: "ws-work" });
      createSpace(db, {
        id: "sp-work-with-workspace",
        accountId: "default",
        providerId: "claude_code",
        mode: "work",
      });
      mockStartAdapter();

      await expect(
        runsService.executeRun({
          accountId: "default",
          workspaceId: "ws-work",
          spaceId: "sp-work-with-workspace",
          providerId: "claude_code",
          goal: "write a report",
        }),
      ).rejects.toThrow("do not use a workspace");
    });

    it("stores optional Collection membership for a Work run", async () => {
      createSpace(db, {
        id: "sp-collected-work",
        accountId: "default",
        providerId: "claude_code",
        mode: "work",
      });
      createCollection(db, { id: "collection-work" });
      mockStartAdapter();

      const { runId } = await runsService.executeRun({
        accountId: "default",
        collectionId: "collection-work",
        spaceId: "sp-collected-work",
        providerId: "claude_code",
        goal: "write a report",
      });

      expect((await runsService.getRunById(runId))?.collectionId).toBe(
        "collection-work",
      );
      await flushBackground();
    });

    it("runs Developer mode with no delta from a valid Developer space", async () => {
      createWorkspace(db, { id: "ws-dev", accountId: "default" });
      createSpace(db, {
        id: "sp-dev",
        accountId: "default",
        providerId: "claude_code",
        mode: "developer",
      });
      const startRun = mockStartAdapter();

      const { runId } = await runsService.executeRun({
        accountId: "default",
        workspaceId: "ws-dev",
        spaceId: "sp-dev",
        providerId: "claude_code",
        goal: "fix the bug",
      });
      await flushBackground();

      const run = await runsService.getRunById(runId);
      expect(run?.mode).toBe("developer");
      const request = startRun.mock.calls[0][0];
      expect(request.mode).toBe("developer");
      expect(request.extraInstructions).toBeNull();
    });

    it("hands work mode's tool policy to the adapter and persists it on the row", async () => {
      createSpace(db, {
        id: "sp-pol",
        accountId: "default",
        providerId: "claude_code",
        mode: "work",
      });
      const startRun = mockStartAdapter();

      const { runId } = await runsService.executeRun({
        accountId: "default",
        spaceId: "sp-pol",
        providerId: "claude_code",
        goal: "summarize the docs",
      });
      await flushBackground();

      const request = startRun.mock.calls[0][0];
      expect(request.toolPolicy?.disallowedTools).toContain("Bash");
      expect(request.toolPolicy?.allowedTools).toBeNull();
      const run = await runsService.getRunById(runId);
      expect(run?.toolPolicySnapshot).toEqual(request.toolPolicy);
    });

    it("chat's overrides beat the caller's snapshot — codex stays read-only", async () => {
      createProvider(db, { id: "codex", displayName: "Codex" });
      createSpace(db, {
        id: "sp-chat",
        accountId: "default",
        providerId: "codex",
        mode: "chat",
      });
      const startRun = mockStartAdapter();

      const { runId } = await runsService.executeRun({
        accountId: "default",
        spaceId: "sp-chat",
        providerId: "codex",
        goal: "explain this repo",
        configSnapshot: { sandboxMode: "danger-full-access" },
      });
      await flushBackground();

      const request = startRun.mock.calls[0][0];
      expect(request.configSnapshot).toEqual({
        sandboxMode: "read-only",
        personality: "friendly",
        planMode: false,
        goalMode: false,
      });
      const run = await runsService.getRunById(runId);
      expect(run?.configSnapshot).toEqual({
        sandboxMode: "read-only",
        personality: "friendly",
        planMode: false,
        goalMode: false,
      });
    });

    it("chat's tool policy beats a caller snapshot that restores write access", async () => {
      createSpace(db, {
        id: "sp-chat-policy",
        accountId: "default",
        providerId: "claude_code",
        mode: "chat",
      });
      const startRun = mockStartAdapter();

      const { runId } = await runsService.executeRun({
        accountId: "default",
        spaceId: "sp-chat-policy",
        providerId: "claude_code",
        goal: "explain this repo",
        toolPolicySnapshot: { allowedTools: null, disallowedTools: [] },
      });
      await flushBackground();

      const request = startRun.mock.calls[0][0];
      expect(request.toolPolicy.allowedTools).not.toContain("Bash");
      expect(request.toolPolicy.disallowedTools).toContain("Bash");
      expect((await runsService.getRunById(runId))?.toolPolicySnapshot).toEqual(
        request.toolPolicy,
      );
    });

    it("layers the space's custom system prompt after the mode delta", async () => {
      createSpace(db, {
        id: "sp-sys",
        accountId: "default",
        providerId: "claude_code",
        mode: "work",
        systemPrompt: "Always answer in Turkish.",
      });
      const startRun = mockStartAdapter();

      await runsService.executeRun({
        accountId: "default",
        spaceId: "sp-sys",
        providerId: "claude_code",
        goal: "draft the weekly update",
      });
      await flushBackground();

      const request = startRun.mock.calls[0][0];
      expect(request.extraInstructions).toContain("non-technical");
      expect(request.extraInstructions.endsWith("Always answer in Turkish.")).toBe(true);
    });
  });

  describe("executeReview guards", () => {
    it("refuses a review from a non-Developer space, before touching the workspace", async () => {
      createWorkspace(db, { id: "ws-chat-review", accountId: "default" });
      createSpace(db, {
        id: "sp-chat-review",
        accountId: "default",
        providerId: "claude_code",
        mode: "chat",
      });
      // The adapter mock is module-level: earlier tests leave calls on it.
      vi.mocked(createWorkAdapter).mockClear();

      await expect(
        runsService.executeReview({
          accountId: "default",
          workspaceId: "ws-chat-review",
          spaceId: "sp-chat-review",
          providerId: "claude_code",
          target: { type: "uncommittedChanges" },
          toolPolicySnapshot: { allowedTools: null, disallowedTools: [] },
        }),
      ).rejects.toThrow("only available in Developer spaces");

      // No adapter, no run row, and the workspace never flipped to in_review.
      expect(createWorkAdapter).not.toHaveBeenCalled();
      expect(await runsService.getRunsByWorkspace("ws-chat-review")).toEqual([]);
      expect((await workspaceService.get("ws-chat-review"))?.status).not.toBe(
        "in_review",
      );
    });

    it("still runs a review from a Developer space", async () => {
      createWorkspace(db, { id: "ws-dev-review", accountId: "default" });
      createSpace(db, {
        id: "sp-dev-review",
        accountId: "default",
        providerId: "claude_code",
        mode: "developer",
      });
      const reviewRun = vi.fn().mockResolvedValue({ status: "succeeded" });
      vi.mocked(createWorkAdapter).mockReturnValue({ reviewRun } as any);

      const { runId } = await runsService.executeReview({
        accountId: "default",
        workspaceId: "ws-dev-review",
        spaceId: "sp-dev-review",
        providerId: "claude_code",
        target: { type: "uncommittedChanges" },
        toolPolicySnapshot: { allowedTools: ["Read", "Read"], disallowedTools: [] },
      });
      await flushBackground();

      expect(reviewRun).toHaveBeenCalled();
      const run = await runsService.getRunById(runId);
      expect(run?.mode).toBe("developer");
      // Composed on the way in, so the row carries a normalized policy.
      expect(run?.toolPolicySnapshot).toEqual({
        allowedTools: ["Read"],
        disallowedTools: [],
      });
    });

    it("rejects a malformed tool policy snapshot at review start", async () => {
      createWorkspace(db, { id: "ws-bad-review", accountId: "default" });
      createSpace(db, {
        id: "sp-bad-review",
        accountId: "default",
        providerId: "claude_code",
        mode: "developer",
      });

      await expect(
        runsService.executeReview({
          accountId: "default",
          workspaceId: "ws-bad-review",
          spaceId: "sp-bad-review",
          providerId: "claude_code",
          target: { type: "uncommittedChanges" },
          toolPolicySnapshot: { allowedTools: "everything" } as any,
        }),
      ).rejects.toThrow("Invalid tool policy allowedTools");

      expect(await runsService.getRunsByWorkspace("ws-bad-review")).toEqual([]);
    });
  });

  describe("continueRun mode propagation", () => {
    it("re-applies the run's stored mode and delta on resume", async () => {
      createWorkspace(db, { id: "ws-cont", accountId: "default" });
      createRun(db, {
        id: "run-work",
        accountId: "default",
        workspaceId: "ws-cont",
        providerId: "claude_code",
        mode: "work",
        status: "succeeded",
        sessionId: "sess-1",
      });
      const continueRun = vi.fn().mockResolvedValue({ status: "succeeded" });
      vi.mocked(createWorkAdapter).mockReturnValue({
        continueRun,
        canResumeSession: vi.fn().mockResolvedValue(true),
      } as any);

      await runsService.continueRun({
        runId: "run-work",
        accountId: "default",
        message: "add a summary section",
      });
      await flushBackground();

      const request = continueRun.mock.calls[0][0];
      expect(request.mode).toBe("work");
      expect(request.extraInstructions).toContain("non-technical");
    });

    it("re-derives tool policy and config snapshot from the run row's mode", async () => {
      createProvider(db, { id: "codex", displayName: "Codex" });
      createWorkspace(db, { id: "ws-cont2", accountId: "default" });
      createRun(db, {
        id: "run-chat",
        accountId: "default",
        workspaceId: "ws-cont2",
        providerId: "codex",
        mode: "chat",
        status: "succeeded",
        sessionId: "sess-2",
      });
      const continueRun = vi.fn().mockResolvedValue({ status: "succeeded" });
      vi.mocked(createWorkAdapter).mockReturnValue({
        continueRun,
        canResumeSession: vi.fn().mockResolvedValue(true),
      } as any);

      await runsService.continueRun({
        runId: "run-chat",
        accountId: "default",
        message: "and what about the tests?",
      });
      await flushBackground();

      const request = continueRun.mock.calls[0][0];
      expect(request.configSnapshot).toEqual({
        sandboxMode: "read-only",
        personality: "friendly",
        planMode: false,
        goalMode: false,
      });
      expect(request.toolPolicy?.allowedTools).not.toBeNull();
      expect(request.toolPolicy?.disallowedTools).toContain("Bash");
    });

    it("clamps and repairs an elevated chat policy snapshot on resume", async () => {
      createRun(db, {
        id: "run-chat-elevated",
        accountId: "default",
        providerId: "claude_code",
        mode: "chat",
        status: "succeeded",
        sessionId: "sess-elevated",
        toolPolicySnapshot: JSON.stringify({
          allowedTools: null,
          disallowedTools: [],
        }),
      });
      const continueRun = vi.fn().mockResolvedValue({ status: "succeeded" });
      vi.mocked(createWorkAdapter).mockReturnValue({
        continueRun,
        canResumeSession: vi.fn().mockResolvedValue(true),
      } as any);

      await runsService.continueRun({
        runId: "run-chat-elevated",
        accountId: "default",
        message: "continue",
      });
      await flushBackground();

      const policy = continueRun.mock.calls[0][0].toolPolicy;
      expect(policy.allowedTools).not.toContain("Bash");
      expect(policy.disallowedTools).toContain("Bash");
      expect(
        (await runsService.getRunById("run-chat-elevated"))
          ?.toolPolicySnapshot,
      ).toEqual(policy);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Attachments arrive from WebSocket clients and paired phones too: a name
  // reaches the adapter as a filename only, and an off-limits sourcePath is
  // refused before anything runs — an existing run is left as it was.
  // ─────────────────────────────────────────────────────────────
  describe("run attachments", () => {
    it("hands the adapter filenames, not paths", async () => {
      createSpace(db, {
        id: "sp-attach",
        accountId: "default",
        providerId: "claude_code",
        mode: "work",
      });
      const startRun = vi.fn().mockResolvedValue({ status: "succeeded" });
      vi.mocked(createWorkAdapter).mockReturnValue({ startRun } as any);

      await runsService.executeRun({
        accountId: "default",
        spaceId: "sp-attach",
        providerId: "claude_code",
        goal: "read this",
        attachments: [
          {
            name: "../../../../Users/me/.zshrc",
            type: "document",
            mimeType: "text/plain",
            data: "eA==",
          },
        ],
      });
      await flushBackground();

      expect(startRun.mock.calls[0][0].attachments).toEqual([
        { name: ".zshrc", type: "document", mimeType: "text/plain", data: "eA==" },
      ]);
    });

    it("refuses a sourcePath outside browser captures before the adapter runs", async () => {
      createSpace(db, {
        id: "sp-attach-src",
        accountId: "default",
        providerId: "claude_code",
        mode: "work",
      });
      const startRun = vi.fn().mockResolvedValue({ status: "succeeded" });
      vi.mocked(createWorkAdapter).mockReturnValue({ startRun } as any);

      await expect(
        runsService.executeRun({
          accountId: "default",
          spaceId: "sp-attach-src",
          providerId: "claude_code",
          goal: "read this",
          attachments: [
            { name: "shot.png", type: "image", mimeType: "image/png", sourcePath: "/etc/passwd" },
          ],
        }),
      ).rejects.toThrow("browser capture");
      expect(startRun).not.toHaveBeenCalled();
    });

    it("refuses a bad attachment on continue without failing the existing run", async () => {
      createWorkspace(db, { id: "ws-attach", accountId: "default" });
      createRun(db, {
        id: "run-attach",
        accountId: "default",
        workspaceId: "ws-attach",
        providerId: "claude_code",
        mode: "work",
        status: "succeeded",
        sessionId: "sess-attach",
      });
      const continueRun = vi.fn().mockResolvedValue({ status: "succeeded" });
      vi.mocked(createWorkAdapter).mockReturnValue({
        continueRun,
        canResumeSession: vi.fn().mockResolvedValue(true),
      } as any);

      await expect(
        runsService.continueRun({
          runId: "run-attach",
          accountId: "default",
          message: "read this",
          attachments: [
            { name: "key.png", type: "image", mimeType: "image/png", sourcePath: "/Users/me/.ssh/id_ed25519" },
          ],
        }),
      ).rejects.toThrow("browser capture");
      expect(continueRun).not.toHaveBeenCalled();
      expect((await runsService.getRunById("run-attach"))?.status).toBe("succeeded");
    });
  });

  describe("listRecentRuns", () => {
    it("filters by account/provider/mode and skips archived runs", async () => {
      createProject(db, { id: "proj-1", accountId: "default", name: "Life" });
      createWorkspace(db, {
        id: "ws-rec",
        accountId: "default",
        projectId: "proj-1",
        name: "life-notes",
      });
      createRun(db, {
        id: "run-chat-1",
        accountId: "default",
        workspaceId: "ws-rec",
        providerId: "claude_code",
        mode: "chat",
        status: "succeeded",
      });
      createRun(db, {
        id: "run-dev-1",
        accountId: "default",
        workspaceId: "ws-rec",
        providerId: "claude_code",
        mode: "developer",
        status: "succeeded",
      });
      createRun(db, {
        id: "run-chat-archived",
        accountId: "default",
        workspaceId: "ws-rec",
        providerId: "claude_code",
        mode: "chat",
        status: "succeeded",
        isArchived: true,
      });
      createRun(db, {
        id: "run-chat-other-provider",
        accountId: "default",
        workspaceId: "ws-rec",
        providerId: "cursor",
        mode: "chat",
        status: "succeeded",
      });

      const result = await runsService.listRecentRuns({
        accountId: "default",
        providerId: "claude_code",
        mode: "chat",
      });

      expect(result.map((r) => r.id)).toEqual(["run-chat-1"]);
      expect(result[0].workspaceId).toBe("ws-rec");
    });

    it("orders by updatedAt desc, honors the limit, tolerates a lost workspace", async () => {
      createWorkspace(db, { id: "ws-rec2", accountId: "default" });
      createRun(db, {
        id: "run-old",
        accountId: "default",
        workspaceId: "ws-rec2",
        mode: "work",
        status: "succeeded",
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      });
      createRun(db, {
        id: "run-new",
        accountId: "default",
        workspaceId: null,
        mode: "work",
        status: "succeeded",
        updatedAt: new Date("2026-02-01T00:00:00Z"),
      });

      const all = await runsService.listRecentRuns({
        accountId: "default",
        providerId: "copilot_cli",
        mode: "work",
      });
      expect(all.map((r) => r.id)).toEqual(["run-new", "run-old"]);
      expect(all[0].workspaceId).toBeNull();

      const limited = await runsService.listRecentRuns({
        accountId: "default",
        providerId: "copilot_cli",
        mode: "work",
        limit: 1,
      });
      expect(limited.map((r) => r.id)).toEqual(["run-new"]);
    });
  });

  describe("moveRunToCollection", () => {
    it("moves a Work run to a same-account Collection", async () => {
      createCollection(db, { id: "shared-project" });
      createRun(db, { id: "work-run", mode: "work" });

      const result = await runsService.moveRunToCollection({
        runId: "work-run",
        accountId: "default",
        collectionId: "shared-project",
      });

      expect(result.collectionId).toBe("shared-project");
    });

    it("lets Work and Chat runs share one Collection", async () => {
      createCollection(db, { id: "shared-project" });
      createRun(db, { id: "work-run", mode: "work" });
      createRun(db, { id: "chat-run", mode: "chat" });

      const work = await runsService.moveRunToCollection({
        runId: "work-run",
        accountId: "default",
        collectionId: "shared-project",
      });
      const chat = await runsService.moveRunToCollection({
        runId: "chat-run",
        accountId: "default",
        collectionId: "shared-project",
      });

      expect(work.collectionId).toBe("shared-project");
      expect(chat.collectionId).toBe("shared-project");
    });

    it("rejects Developer runs", async () => {
      createRun(db, { id: "dev-run", mode: "developer" });

      await expect(
        runsService.moveRunToCollection({
          runId: "dev-run",
          accountId: "default",
          collectionId: null,
        }),
      ).rejects.toThrow("Developer runs");
    });
  });

  describe("completeRun", () => {
    it("sets status to succeeded", async () => {
      createRun(db, { id: "r1", status: "running" });

      const result = await runsService.completeRun("r1");
      expect(result.status).toBe("succeeded");
    });

    it("sets endedAt timestamp", async () => {
      createRun(db, { id: "r1", status: "running" });

      const result = await runsService.completeRun("r1");
      expect(result.endedAt).toBeTruthy();
    });

    it("returns error for nonexistent run", async () => {
      await expect(runsService.completeRun("nonexistent")).rejects.toThrow();
    });
  });

  describe("failRun", () => {
    it("sets status to failed with error", async () => {
      createRun(db, { id: "r1", status: "running" });

      const result = await runsService.failRun("r1", "something broke");
      expect(result.status).toBe("failed");
      expect(result.lastError).toBe("something broke");
    });

    it("sets endedAt timestamp", async () => {
      createRun(db, { id: "r1", status: "running" });

      const result = await runsService.failRun("r1", "err");
      expect(result.endedAt).toBeTruthy();
    });

    it("returns error for nonexistent run", async () => {
      await expect(runsService.failRun("nonexistent", "err")).rejects.toThrow();
    });
  });

  describe("cancelRun", () => {
    it("sets status to canceled", async () => {
      createRun(db, { id: "r1", status: "running" });

      const result = await runsService.cancelRun("r1");
      expect(result.status).toBe("canceled");
    });

    it("sets endedAt timestamp", async () => {
      createRun(db, { id: "r1", status: "running" });

      const result = await runsService.cancelRun("r1");
      expect(result.endedAt).toBeTruthy();
    });

    it("returns error for nonexistent run", async () => {
      await expect(runsService.cancelRun("nonexistent")).rejects.toThrow();
    });
  });

  describe("deleteRun", () => {
    it("deletes an existing run", async () => {
      createRun(db, { id: "r1" });

      await runsService.deleteRun("r1");

      expect(await runsService.getRunById("r1")).toBeNull();
    });

    it("removes a workspace-less run's managed execution tree", async () => {
      createRun(db, {
        id: "chat-delete",
        providerId: "claude_code",
        mode: "chat",
      });
      const runDir = managedRunDir("chat-delete", "chat");
      mkdirSync(runDir, { recursive: true });
      writeFileSync(`${runDir}/source.txt`, "private context");

      await runsService.deleteRun("chat-delete");

      expect(() => statSync(runDir)).toThrow();
    });

    it("returns error when run does not exist", async () => {
      await expect(runsService.deleteRun("nonexistent")).rejects.toThrow(
        "Run not found",
      );
    });

    it("deletes the Codex thread before deleting the run", async () => {
      createRun(db, {
        id: "r1",
        providerId: "codex",
        sessionId: "thread-1",
      });
      const deleteSession = vi.fn();
      vi.mocked(createWorkAdapter).mockReturnValue({ deleteSession } as any);

      await runsService.deleteRun("r1");

      expect(deleteSession).toHaveBeenCalledWith("r1");
      expect(await runsService.getRunById("r1")).toBeNull();
    });

    it("still deletes locally when the Codex thread is already gone", async () => {
      createRun(db, { id: "r1", providerId: "codex", sessionId: "thread-1" });
      vi.mocked(createWorkAdapter).mockReturnValue({
        deleteSession: vi
          .fn()
          .mockRejectedValue(new Error("no rollout found for thread id thread-1")),
      } as any);

      await runsService.deleteRun("r1");

      expect(await runsService.getRunById("r1")).toBeNull();
    });

    it("returns error when repo throws", async () => {
      createRun(db, { id: "r1" });
      vi.spyOn(runsRepo, "deleteRun").mockRejectedValueOnce(new Error("db error"));
      await expect(runsService.deleteRun("r1")).rejects.toThrow("db error");
    });
  });

  describe("archiveRun", () => {
    it("archives an existing run", async () => {
      createRun(db, { id: "r1" });

      const result = await runsService.archiveRun("r1");
      expect(result.isArchived).toBe(true);
    });

    it("archives the Codex thread before archiving the run", async () => {
      createRun(db, {
        id: "r1",
        providerId: "codex",
        sessionId: "thread-1",
      });
      const archiveSession = vi.fn();
      vi.mocked(createWorkAdapter).mockReturnValue({ archiveSession } as any);

      const result = await runsService.archiveRun("r1");

      expect(archiveSession).toHaveBeenCalledWith("r1");
      expect(result.isArchived).toBe(true);
    });

    it("still archives locally when the Codex thread is already gone", async () => {
      // The Codex thread store is a second copy the user can mutate on their
      // own; archiving there first makes the app server answer "no rollout
      // found for thread id …". Mains' own archive must not depend on it.
      createRun(db, {
        id: "r1",
        providerId: "codex",
        sessionId: "thread-1",
      });
      vi.mocked(createWorkAdapter).mockReturnValue({
        archiveSession: vi
          .fn()
          .mockRejectedValue(new Error("no rollout found for thread id thread-1")),
      } as any);

      const result = await runsService.archiveRun("r1");

      expect(result.isArchived).toBe(true);
      expect((await runsService.getRunById("r1"))!.isArchived).toBe(true);
    });

    it("still archives locally when the adapter exposes no archiveSession", async () => {
      createRun(db, { id: "r1", providerId: "codex", sessionId: "thread-1" });
      vi.mocked(createWorkAdapter).mockReturnValue({} as any);

      expect((await runsService.archiveRun("r1")).isArchived).toBe(true);
    });

    it("returns error for nonexistent run", async () => {
      await expect(runsService.archiveRun("nonexistent")).rejects.toThrow("Run not found");
    });

    it("returns error when repo throws", async () => {
      createRun(db, { id: "r1" });
      vi.spyOn(runsRepo, "archiveRun").mockRejectedValueOnce(new Error("db error"));
      await expect(runsService.archiveRun("r1")).rejects.toThrow("db error");
    });
  });

  describe("unarchiveRun", () => {
    it("restores the Codex thread and run", async () => {
      createWorkspace(db, { id: "w1" });
      createRun(db, {
        id: "r1",
        workspaceId: "w1",
        providerId: "codex",
        sessionId: "thread-1",
        isArchived: true,
      });
      const unarchiveSession = vi.fn();
      vi.mocked(createWorkAdapter).mockReturnValue({ unarchiveSession } as any);

      const result = await runsService.unarchiveRun("r1");

      expect(unarchiveSession).toHaveBeenCalledWith("r1");
      expect(result.isArchived).toBe(false);
    });

    it("returns error for a missing run", async () => {
      await expect(runsService.unarchiveRun("missing")).rejects.toThrow(
        "Run not found",
      );
    });

    it("refuses to restore a run while its workspace is archived", async () => {
      createWorkspace(db, { id: "w1", isArchived: true });
      createRun(db, {
        id: "r1",
        workspaceId: "w1",
        providerId: "codex",
        sessionId: "thread-1",
        isArchived: true,
      });
      const unarchiveSession = vi.fn();
      vi.mocked(createWorkAdapter).mockReturnValue({ unarchiveSession } as any);

      await expect(runsService.unarchiveRun("r1")).rejects.toThrow(
        "Unarchive the workspace before restoring this run",
      );
      expect(unarchiveSession).not.toHaveBeenCalled();
      expect((await runsService.getRunById("r1"))!.isArchived).toBe(true);
    });

    it("refuses to restore a run without a workspace", async () => {
      createRun(db, {
        id: "r1",
        providerId: "codex",
        sessionId: "thread-1",
        isArchived: true,
      });
      const unarchiveSession = vi.fn();
      vi.mocked(createWorkAdapter).mockReturnValue({ unarchiveSession } as any);

      await expect(runsService.unarchiveRun("r1")).rejects.toThrow(
        "Cannot restore a developer run without a workspace",
      );
      expect(unarchiveSession).not.toHaveBeenCalled();
      expect((await runsService.getRunById("r1"))!.isArchived).toBe(true);
    });

    it("still restores locally when the Codex thread is already gone", async () => {
      createWorkspace(db, { id: "w1" });
      createRun(db, {
        id: "r1",
        workspaceId: "w1",
        providerId: "codex",
        sessionId: "thread-1",
        isArchived: true,
      });
      vi.mocked(createWorkAdapter).mockReturnValue({
        unarchiveSession: vi
          .fn()
          .mockRejectedValue(new Error("no rollout found for thread id thread-1")),
      } as any);

      expect((await runsService.unarchiveRun("r1")).isArchived).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Run Context Operations
  // ─────────────────────────────────────────────────────────────
  describe("getContextByRun", () => {
    it("returns empty array when no context", async () => {
      createRun(db, { id: "r1" });

      const result = await runsService.getContextByRun("r1");
      expect(result).toEqual([]);
    });

    it("returns context items", async () => {
      createRun(db, { id: "r1" });
      createRunContext(db, { runId: "r1", kind: "file", content: "test.ts" });

      const result = await runsService.getContextByRun("r1");
      expect(result).toHaveLength(1);
    });

    it("returns multiple context items", async () => {
      createRun(db, { id: "r1" });
      createRunContext(db, { runId: "r1", kind: "file", content: "a.ts" });
      createRunContext(db, { runId: "r1", kind: "note", content: "some note" });

      const result = await runsService.getContextByRun("r1");
      expect(result).toHaveLength(2);
    });

    it("returns error when repo throws", async () => {
      vi.spyOn(runsRepo, "findContextByRun").mockRejectedValueOnce(new Error("db error"));
      await expect(runsService.getContextByRun("r1")).rejects.toThrow("db error");
    });
  });

  describe("addContext", () => {
    it("adds context and returns id", async () => {
      createRun(db, { id: "r1" });

      const result = await runsService.addContext({
        runId: "r1",
        kind: "file",
        content: "src/test.ts",
      });
      expect(typeof result).toBe("number");
    });

    it("adds context with metadata", async () => {
      createRun(db, { id: "r1" });

      const result = await runsService.addContext({
        runId: "r1",
        kind: "note",
        content: "a note",
        metadata: { source: "manual" },
      });
      expect(typeof result).toBe("number");
    });

    it("returns error when repo throws", async () => {
      vi.spyOn(runsRepo, "insertContext").mockRejectedValueOnce(new Error("db error"));
      await expect(runsService.addContext({ runId: "r1", kind: "file", content: "test.ts", })).rejects.toThrow("db error");
    });
  });

  describe("removeContext", () => {
    it("removes context", async () => {
      createRun(db, { id: "r1" });
      const ctx = createRunContext(db, { runId: "r1", kind: "file", content: "test.ts" });

      await runsService.removeContext(ctx.id);

      const check = await runsService.getContextByRun("r1");
      expect(check).toEqual([]);
    });

    it("succeeds when context does not exist", async () => {
      await runsService.removeContext(99999);
    });

    it("returns error when repo throws", async () => {
      vi.spyOn(runsRepo, "deleteContext").mockRejectedValueOnce(new Error("db error"));
      await expect(runsService.removeContext(1)).rejects.toThrow("db error");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Run Artifact Operations
  // ─────────────────────────────────────────────────────────────
  describe("getArtifactsByRun", () => {
    it("returns empty array when no artifacts", async () => {
      createRun(db, { id: "r1" });

      const result = await runsService.getArtifactsByRun("r1");
      expect(result).toEqual([]);
    });

    it("returns artifacts", async () => {
      createRun(db, { id: "r1" });
      createRunArtifact(db, { runId: "r1", kind: "file", content: "hello" });

      const result = await runsService.getArtifactsByRun("r1");
      expect(result).toHaveLength(1);
    });

    it("returns multiple artifacts", async () => {
      createRun(db, { id: "r1" });
      createRunArtifact(db, { runId: "r1", kind: "file", content: "a" });
      createRunArtifact(db, { runId: "r1", kind: "log", content: "b" });

      const result = await runsService.getArtifactsByRun("r1");
      expect(result).toHaveLength(2);
    });

    it("returns error when repo throws", async () => {
      vi.spyOn(runsRepo, "findArtifactsByRun").mockRejectedValueOnce(new Error("db error"));
      await expect(runsService.getArtifactsByRun("r1")).rejects.toThrow("db error");
    });
  });

  describe("readTextFile", () => {
    it("finds a Markdown file by basename inside its Work run", async () => {
      createRun(db, {
        id: "run-markdown",
        providerId: "claude_code",
        mode: "work",
      });
      const root = managedRunDir("run-markdown", "work");
      const outputs = `${root}/outputs`;
      mkdirSync(outputs, { recursive: true });
      writeFileSync(`${outputs}/report.md`, "# Report\n\nReady.");

      try {
        await expect(
          runsService.readTextFile({ runId: "run-markdown", filePath: "report.md:2" }),
        ).resolves.toEqual({
          fileName: "report.md",
          relativePath: "outputs/report.md",
          content: "# Report\n\nReady.",
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("does not follow a run-local symlink outside the run", async () => {
      createRun(db, {
        id: "run-markdown-link",
        providerId: "claude_code",
        mode: "work",
      });
      const root = managedRunDir("run-markdown-link", "work");
      const outside = "/tmp/mains-markdown-outside.md";
      mkdirSync(root, { recursive: true });
      writeFileSync(outside, "secret");
      symlinkSync(outside, `${root}/linked.md`);

      try {
        await expect(
          runsService.readTextFile({ runId: "run-markdown-link", filePath: "linked.md" }),
        ).rejects.toThrow("File not found: linked.md");
      } finally {
        rmSync(root, { recursive: true, force: true });
        rmSync(outside, { force: true });
      }
    });

    it("rejects non-Markdown paths and Developer runs", async () => {
      createRun(db, {
        id: "run-text",
        providerId: "claude_code",
        mode: "work",
      });
      createWorkspace(db, { id: "ws-markdown" });
      createRun(db, {
        id: "run-developer-markdown",
        providerId: "claude_code",
        mode: "developer",
        workspaceId: "ws-markdown",
      });

      await expect(
        runsService.readTextFile({ runId: "run-text", filePath: "notes.txt" }),
      ).rejects.toThrow("Only Markdown files");
      await expect(
        runsService.readTextFile({
          runId: "run-developer-markdown",
          filePath: "README.md",
        }),
      ).rejects.toThrow("only available for Work and Chat");
    });
  });

  describe("addArtifact", () => {
    it("adds artifact and returns id", async () => {
      createRun(db, { id: "r1" });

      const result = await runsService.addArtifact({
        runId: "r1",
        kind: "file",
        content: "console.log('hi')",
      });
      expect(typeof result).toBe("number");
    });

    it("adds artifact with path", async () => {
      createRun(db, { id: "r1" });

      const result = await runsService.addArtifact({
        runId: "r1",
        kind: "file",
        path: "/src/index.ts",
        content: "export {}",
      });
      expect(typeof result).toBe("number");
    });

    it("returns error when repo throws", async () => {
      vi.spyOn(runsRepo, "insertArtifact").mockRejectedValueOnce(new Error("db error"));
      await expect(runsService.addArtifact({ runId: "r1", kind: "file", content: "test", })).rejects.toThrow("db error");
    });
  });

  describe("removeArtifact", () => {
    it("removes artifact", async () => {
      createRun(db, { id: "r1" });
      const art = createRunArtifact(db, { runId: "r1", kind: "file", content: "hello" });

      await runsService.removeArtifact(art.id);

      const check = await runsService.getArtifactsByRun("r1");
      expect(check).toEqual([]);
    });

    it("succeeds when artifact does not exist", async () => {
      await runsService.removeArtifact(99999);
    });

    it("returns error when repo throws", async () => {
      vi.spyOn(runsRepo, "deleteArtifact").mockRejectedValueOnce(new Error("db error"));
      await expect(runsService.removeArtifact(1)).rejects.toThrow("db error");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Tool Call Operations
  // ─────────────────────────────────────────────────────────────
  describe("getToolCallsByRun", () => {
    it("returns empty array when no tool calls", async () => {
      createRun(db, { id: "r1" });

      const result = await runsService.getToolCallsByRun("r1");
      expect(result).toEqual([]);
    });

    it("returns tool calls", async () => {
      createRun(db, { id: "r1" });
      createToolCall(db, { runId: "r1", toolName: "read_file" });

      const result = await runsService.getToolCallsByRun("r1");
      expect(result).toHaveLength(1);
    });

    it("returns multiple tool calls", async () => {
      createRun(db, { id: "r1" });
      createToolCall(db, { runId: "r1", toolName: "read_file" });
      createToolCall(db, { runId: "r1", toolName: "write_file" });

      const result = await runsService.getToolCallsByRun("r1");
      expect(result).toHaveLength(2);
    });

    it("returns error when repo throws", async () => {
      vi.spyOn(runsRepo, "findToolCallsByRun").mockRejectedValueOnce(new Error("db error"));
      await expect(runsService.getToolCallsByRun("r1")).rejects.toThrow("db error");
    });
  });

  describe("addToolCall", () => {
    it("adds tool call and returns id", async () => {
      createRun(db, { id: "r1" });

      const result = await runsService.addToolCall({
        accountId: "default",
        runId: "r1",
        toolName: "write_file",
      });
      expect(typeof result).toBe("number");
    });

    it("adds tool call with input", async () => {
      createRun(db, { id: "r1" });

      const result = await runsService.addToolCall({
        accountId: "default",
        runId: "r1",
        toolName: "Bash",
        input: { command: "ls" },
      });
      expect(typeof result).toBe("number");
    });

    it("returns error when repo throws", async () => {
      vi.spyOn(runsRepo, "insertToolCall").mockRejectedValueOnce(new Error("db error"));
      await expect(runsService.addToolCall({ accountId: "default", runId: "r1", toolName: "write_file", })).rejects.toThrow("db error");
    });
  });

  describe("updateToolCall", () => {
    it("updates a tool call", async () => {
      createRun(db, { id: "r1" });
      const tc = createToolCall(db, { runId: "r1", toolName: "read_file" });

      await runsService.updateToolCall(tc.id, { status: "done" });
    });

    it("updates tool call with output and error", async () => {
      createRun(db, { id: "r1" });
      const tc = createToolCall(db, { runId: "r1", toolName: "read_file" });

      await runsService.updateToolCall(tc.id, {
        status: "error",
        error: "file not found",
        output: { stderr: "No such file" },
      });
    });

    it("returns error when repo throws", async () => {
      vi.spyOn(runsRepo, "updateToolCall").mockRejectedValueOnce(new Error("db error"));
      await expect(runsService.updateToolCall(1, { status: "done" })).rejects.toThrow("db error");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Run Details
  // ─────────────────────────────────────────────────────────────
  describe("getRunDetails", () => {
    it("returns error for nonexistent run", async () => {
      expect(await runsService.getRunDetails("nonexistent")).toBeNull();
    });

    it("returns run with all related data", async () => {
      createRun(db, { id: "r1" });
      createRunContext(db, { runId: "r1", kind: "file", content: "test.ts" });
      createRunArtifact(db, { runId: "r1", kind: "file", content: "output" });
      createToolCall(db, { runId: "r1", toolName: "read" });
      createRunTurn(db, { runId: "r1", turnIndex: 0 });

      const result = (await runsService.getRunDetails("r1"))!;
      expect(result.run.id).toBe("r1");
      expect(result.context).toHaveLength(1);
      expect(result.artifacts).toHaveLength(1);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.turns).toHaveLength(1);
    });

    it("returns run with empty related data", async () => {
      createRun(db, { id: "r1" });

      const result = (await runsService.getRunDetails("r1"))!;
      expect(result.run.id).toBe("r1");
      expect(result.context).toEqual([]);
      expect(result.artifacts).toEqual([]);
      expect(result.toolCalls).toEqual([]);
      expect(result.turns).toEqual([]);
    });

    it("returns error when repo throws", async () => {
      vi.spyOn(runsRepo, "findRunById").mockRejectedValueOnce(new Error("db error"));
      await expect(runsService.getRunDetails("r1")).rejects.toThrow("db error");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Run Turns
  // ─────────────────────────────────────────────────────────────
  describe("getTurnsByRun", () => {
    it("returns empty array when no turns", async () => {
      createRun(db, { id: "r1" });

      const result = await runsService.getTurnsByRun("r1");
      expect(result).toEqual([]);
    });

    it("returns turns for a run", async () => {
      createRun(db, { id: "r1" });
      createRunTurn(db, { runId: "r1", turnIndex: 0 });
      createRunTurn(db, { runId: "r1", turnIndex: 1 });

      const result = await runsService.getTurnsByRun("r1");
      expect(result).toHaveLength(2);
    });

    it("returns turns ordered by turnIndex", async () => {
      createRun(db, { id: "r1" });
      createRunTurn(db, { runId: "r1", turnIndex: 2 });
      createRunTurn(db, { runId: "r1", turnIndex: 0 });
      createRunTurn(db, { runId: "r1", turnIndex: 1 });

      const result = await runsService.getTurnsByRun("r1");
      expect(result[0].turnIndex).toBe(0);
      expect(result[1].turnIndex).toBe(1);
      expect(result[2].turnIndex).toBe(2);
    });

    it("returns error when repo throws", async () => {
      vi.spyOn(runsRepo, "findTurnsByRun").mockRejectedValueOnce(new Error("db error"));
      await expect(runsService.getTurnsByRun("r1")).rejects.toThrow("db error");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // executeRun
  // ─────────────────────────────────────────────────────────────
  describe("executeRun", () => {
    const basePayload = () => ({
      accountId: "default",
      workspaceId: "ws1",
      spaceId: "sp-execute-dev",
      providerId: "copilot_cli",
      goal: "Fix the bug",
    });

    beforeEach(() => {
      createSpace(db, {
        id: "sp-execute-dev",
        accountId: "default",
        providerId: "copilot_cli",
        mode: "developer",
      });
    });

    function setupMockAdapter(overrides: Record<string, unknown> = {}) {
      const mockAdapter = {
        startRun: vi.fn().mockResolvedValue({
          status: "succeeded",
          summary: "Done",
          stopReason: "end_turn",
        }),
        generateTitle: vi.fn().mockResolvedValue("Generated Title"),
        abortRun: vi.fn(),
        canResumeSession: vi.fn().mockResolvedValue(true),
        continueRun: vi.fn(),
        forkRun: vi.fn(),
        deleteSession: vi.fn(),
        ...overrides,
      };
      vi.mocked(createWorkAdapter).mockReturnValue(mockAdapter as any);
      return mockAdapter;
    }

    it("returns error when provider not found", async () => {
      await expect(runsService.executeRun({ ...basePayload(), providerId: "nonexistent", })).rejects.toThrow("not found");
    });

    it("returns error when provider is disabled", async () => {
      createProvider(db, { id: "disabled_provider", isEnabled: false, displayName: "Disabled" });

      await expect(runsService.executeRun({ ...basePayload(), providerId: "disabled_provider", })).rejects.toThrow("not enabled");
    });

    it("returns error when provider is not agent_runtime", async () => {
      createProvider(db, { id: "non_runtime", kind: "tool" as any, displayName: "Tool Provider" });

      await expect(runsService.executeRun({ ...basePayload(), providerId: "non_runtime", })).rejects.toThrow("not an agent runtime");
    });

    it("returns error when workspace not found", async () => {
      setupMockAdapter();

      await expect(runsService.executeRun({ ...basePayload(), workspaceId: "nonexistent-ws", })).rejects.toThrow("not found");
    });

    it("returns runId on happy path", async () => {
      createWorkspace(db, { id: "ws1" });
      setupMockAdapter();

      const result = await runsService.executeRun(basePayload());
      expect(result.runId).toBeTruthy();
      await flushBackground();
    });

    // Handing a deleted directory to an adapter starts a run that can only fail,
    // and fails obscurely — the error surfaces from inside the provider instead
    // of naming the folder. Refuse up front, before any row is written.
    describe("workspace folder deleted", () => {
      it("refuses to start and names the folder", async () => {
        createWorkspace(db, { id: "ws-gone", name: "Ghost", rootPath: "/repos/gone" });
        const adapter = setupMockAdapter();
        vi.mocked(existsSync).mockReturnValue(false);

        await expect(
          runsService.executeRun({ ...basePayload(), workspaceId: "ws-gone" }),
        ).rejects.toThrow(/"Ghost".*\/repos\/gone/s);
        expect(adapter.startRun).not.toHaveBeenCalled();
      });

      it("writes no run row when it refuses", async () => {
        createWorkspace(db, { id: "ws-gone2", rootPath: "/repos/gone2" });
        setupMockAdapter();
        vi.mocked(existsSync).mockReturnValue(false);

        await expect(
          runsService.executeRun({ ...basePayload(), workspaceId: "ws-gone2" }),
        ).rejects.toThrow(/no longer exists/);
        await expect(runsRepo.findRunsByWorkspace("ws-gone2")).resolves.toEqual([]);
      });
    });

    it("calls adapter.startRun with correct params", async () => {
      createWorkspace(db, { id: "ws1", rootPath: "/tmp/ws/test" });
      const mockAdapter = setupMockAdapter();

      await runsService.executeRun(basePayload());
      expect(mockAdapter.startRun).toHaveBeenCalled();
      const callArgs = mockAdapter.startRun.mock.calls[0][0];
      expect(callArgs.goal).toBe("Fix the bug");
      expect(callArgs.execution.workspaceId).toBe("ws1");
      expect(callArgs.execution.cwd).toBe("/tmp/ws/test");
      await flushBackground();
    });

    it("persists initial context when provided", async () => {
      createWorkspace(db, { id: "ws1" });
      setupMockAdapter();

      const result = await runsService.executeRun({
        ...basePayload(),
        initialContext: [
          { kind: "file", ref: "src/index.ts", content: "export {}" },
          { kind: "note", content: "Focus on perf" },
        ],
      });

      await flushBackground();
      const ctx = await runsRepo.findContextByRun(result.runId);
      expect(ctx).toHaveLength(2);
    });

    it("creates run record in the database", async () => {
      createWorkspace(db, { id: "ws1" });
      // Use a never-resolving promise so the run stays in running state
      let resolveRun!: (v: any) => void;
      setupMockAdapter({
        startRun: vi.fn().mockReturnValue(new Promise((r) => { resolveRun = r; })),
      });

      const result = await runsService.executeRun(basePayload());

      const run = await runsRepo.findRunById(result.runId);
      expect(run).toBeTruthy();
      expect(run!.status).toBe("running");

      // Resolve so test cleanup doesn't hang
      resolveRun({ status: "succeeded", summary: "Done" });
      await flushBackground();
    });

    it("background .then() updates status to succeeded", async () => {
      createWorkspace(db, { id: "ws1" });
      setupMockAdapter();

      const result = await runsService.executeRun(basePayload());
      await flushBackground();

      const run = await runsRepo.findRunById(result.runId);
      expect(run!.status).toBe("succeeded");
    });

    it("background .then() updates status to canceled when adapter returns canceled", async () => {
      createWorkspace(db, { id: "ws1" });
      setupMockAdapter({
        startRun: vi.fn().mockResolvedValue({
          status: "canceled",
          summary: "Canceled by user",
        }),
      });

      const result = await runsService.executeRun(basePayload());
      await flushBackground();

      const run = await runsRepo.findRunById(result.runId);
      expect(run!.status).toBe("canceled");
    });

    it("background .then() updates status to failed when adapter returns failed", async () => {
      createWorkspace(db, { id: "ws1" });
      setupMockAdapter({
        startRun: vi.fn().mockResolvedValue({
          status: "failed",
          summary: "Something went wrong",
        }),
      });

      const result = await runsService.executeRun(basePayload());
      await flushBackground();

      const run = await runsRepo.findRunById(result.runId);
      expect(run!.status).toBe("failed");
      expect(run!.lastError).toBe("Something went wrong");
    });

    it("background .catch() marks run as failed", async () => {
      createWorkspace(db, { id: "ws1" });
      setupMockAdapter({
        startRun: vi.fn().mockRejectedValue(new Error("adapter crashed")),
      });

      const result = await runsService.executeRun(basePayload());
      await flushBackground();

      const run = await runsRepo.findRunById(result.runId);
      expect(run!.status).toBe("failed");
      expect(run!.lastError).toBe("adapter crashed");
    });

    it("fires title generation in background", async () => {
      createWorkspace(db, { id: "ws1" });
      const mockAdapter = setupMockAdapter();

      await runsService.executeRun(basePayload());
      await flushBackground();

      expect(mockAdapter.generateTitle).toHaveBeenCalledWith("Fix the bug", undefined);
    });

    it("uses fallback title when generateTitle is not present", async () => {
      createWorkspace(db, { id: "ws1" });
      setupMockAdapter({ generateTitle: undefined });

      const result = await runsService.executeRun(basePayload());
      await flushBackground();

      const run = await runsRepo.findRunById(result.runId);
      expect(run!.title).toBe("Fix the bug");
    });

    it("captures git base ref at run start", async () => {
      createWorkspace(db, { id: "ws1", rootPath: "/tmp/test-repo" });
      setupMockAdapter();
      vi.mocked(gitService.getHeadSha).mockResolvedValue("abc123");

      await runsService.executeRun(basePayload());
      expect(gitService.getHeadSha).toHaveBeenCalledWith("/tmp/test-repo");
      await flushBackground();
    });

    it("handles outer try-catch when insertRun throws", async () => {
      createWorkspace(db, { id: "ws1" });
      setupMockAdapter();
      vi.spyOn(runsRepo, "insertRun").mockRejectedValueOnce(new Error("insert failed"));

      await expect(runsService.executeRun(basePayload())).rejects.toThrow("insert failed");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Adapter-event projection (was handleRunEvent on the service)
  //
  // Tests for projection logic moved to run-session.test.ts when the
  // logic moved from runsService.handleRunEvent into RunSession.project.
  // See follow-up task. Smoke tests cover regressions in the meantime.
  // ─────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────
  // abortRun
  // ─────────────────────────────────────────────────────────────
  describe("abortRun", () => {
    it("returns error when run not found", async () => {
      await expect(runsService.abortRun("nonexistent")).rejects.toThrow("Run not found");
    });

    it("returns error when run is not running", async () => {
      createRun(db, { id: "r1", status: "succeeded" });

      await expect(runsService.abortRun("r1")).rejects.toThrow("not running");
    });

    it("cancels a queued run, which has no session to interrupt", async () => {
      createRun(db, { id: "r1", status: "queued" });

      await runsService.abortRun("r1");

      const run = await runsRepo.findRunById("r1");
      expect(run!.status).toBe("canceled");
      expect(run!.lastError).toContain("before it started");
    });

    it("returns error when run is failed", async () => {
      createRun(db, { id: "r1", status: "failed" });

      await expect(runsService.abortRun("r1")).rejects.toThrow("not running");
    });

    it("delegates to session.abort when a live session is registered", async () => {
      createRun(db, { id: "r1", status: "running" });
      const sessionAbort = vi.fn().mockResolvedValue(undefined);
      runSessionRegistry.register("r1", {
        runId: "r1",
        project: vi.fn(),
        abort: sessionAbort,
        finalize: vi.fn(),
        updateBaseRef: vi.fn(),
      });

      await runsService.abortRun("r1");
      expect(sessionAbort).toHaveBeenCalledOnce();
      runSessionRegistry.unregister("r1");
    });

    it("marks status canceled directly when no live session (process-restart edge case)", async () => {
      createRun(db, { id: "r1", status: "running" });
      // No session registered — DB says running but in-memory state is gone.

      await runsService.abortRun("r1");

      const run = await runsRepo.findRunById("r1");
      expect(run!.status).toBe("canceled");
      expect(run!.lastError).toContain("no live session");
    });

    it("returns error on outer catch", async () => {
      vi.spyOn(runsRepo, "findRunById").mockRejectedValueOnce(new Error("db error"));
      await expect(runsService.abortRun("r1")).rejects.toThrow("db error");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // canResumeRun
  // ─────────────────────────────────────────────────────────────
  describe("canResumeRun", () => {
    it("returns false when run not found", async () => {
      expect(await runsService.canResumeRun("nonexistent")).toBe(false);
    });

    it("returns false for running status", async () => {
      createRun(db, { id: "r1", status: "running" });

      const result = await runsService.canResumeRun("r1");
      expect(result).toBe(false);
    });

    it("returns false for queued status", async () => {
      createRun(db, { id: "r1", status: "queued" });

      const result = await runsService.canResumeRun("r1");
      expect(result).toBe(false);
    });

    it("returns false when provider not found", async () => {
      createProvider(db, { id: "temp_prov" });
      createRun(db, { id: "r1", status: "succeeded", providerId: "temp_prov" });
      vi.spyOn(
        await import("../providers/providers.repo").then(m => m.providersRepo),
        "findById"
      ).mockResolvedValueOnce(null);

      const result = await runsService.canResumeRun("r1");
      expect(result).toBe(false);
    });

    it("returns false when adapter has no canResumeSession", async () => {
      createRun(db, { id: "r1", status: "succeeded" });
      vi.mocked(createWorkAdapter).mockReturnValue({} as any);

      const result = await runsService.canResumeRun("r1");
      expect(result).toBe(false);
    });

    it("returns true when adapter says session is resumable", async () => {
      createRun(db, { id: "r1", status: "succeeded" });
      vi.mocked(createWorkAdapter).mockReturnValue({
        canResumeSession: vi.fn().mockResolvedValue(true),
      } as any);

      const result = await runsService.canResumeRun("r1");
      expect(result).toBe(true);
    });

    it("returns false when adapter says session is not resumable", async () => {
      createRun(db, { id: "r1", status: "failed" });
      vi.mocked(createWorkAdapter).mockReturnValue({
        canResumeSession: vi.fn().mockResolvedValue(false),
      } as any);

      const result = await runsService.canResumeRun("r1");
      expect(result).toBe(false);
    });

    it("returns error on outer catch", async () => {
      vi.spyOn(runsRepo, "findRunById").mockRejectedValueOnce(new Error("db error"));
      await expect(runsService.canResumeRun("r1")).rejects.toThrow("db error");
    });

    it("works for canceled run", async () => {
      createRun(db, { id: "r1", status: "canceled" });
      vi.mocked(createWorkAdapter).mockReturnValue({
        canResumeSession: vi.fn().mockResolvedValue(true),
      } as any);

      const result = await runsService.canResumeRun("r1");
      expect(result).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // continueRun
  // ─────────────────────────────────────────────────────────────
  describe("continueRun", () => {
    function setupContinueAdapter(overrides: Record<string, unknown> = {}) {
      const mockAdapter = {
        continueRun: vi.fn().mockResolvedValue({
          status: "succeeded",
          summary: "Continued",
          stopReason: "end_turn",
        }),
        canResumeSession: vi.fn().mockResolvedValue(true),
        generateTitle: vi.fn().mockResolvedValue("Title"),
        abortRun: vi.fn(),
        deleteSession: vi.fn(),
        ...overrides,
      };
      vi.mocked(createWorkAdapter).mockReturnValue(mockAdapter as any);
      return mockAdapter;
    }

    it("returns error when run not found", async () => {
      await expect(runsService.continueRun({ runId: "nonexistent", accountId: "default", message: "keep going", })).rejects.toThrow("Run not found");
    });

    it("returns error when run does not belong to account", async () => {
      createAccount(db, { id: "other" });
      createRun(db, { id: "r1", accountId: "other" });

      await expect(runsService.continueRun({ runId: "r1", accountId: "default", message: "continue", })).rejects.toThrow("Run does not belong to this account");
    });

    it("returns error when provider not found", async () => {
      createRun(db, { id: "r1", accountId: "default" });
      vi.spyOn(
        await import("../providers/providers.repo").then(m => m.providersRepo),
        "findById"
      ).mockResolvedValueOnce(null);

      await expect(runsService.continueRun({ runId: "r1", accountId: "default", message: "continue", })).rejects.toThrow("not found");
    });

    it("returns error when provider is disabled", async () => {
      createProvider(db, { id: "disabled_p", isEnabled: false, displayName: "Disabled" });
      createRun(db, { id: "r1", accountId: "default", providerId: "disabled_p" });

      await expect(runsService.continueRun({ runId: "r1", accountId: "default", message: "continue", })).rejects.toThrow("not enabled");
    });

    it("returns error when adapter has no continueRun", async () => {
      createWorkspace(db, { id: "ws1" });
      createRun(db, { id: "r1", accountId: "default", workspaceId: "ws1" });
      vi.mocked(createWorkAdapter).mockReturnValue({} as any);

      await expect(runsService.continueRun({ runId: "r1", accountId: "default", message: "continue", })).rejects.toThrow("Provider does not support session resumption");
    });

    it("returns error when canResumeSession returns false", async () => {
      createWorkspace(db, { id: "ws1" });
      createRun(db, { id: "r1", accountId: "default", workspaceId: "ws1" });
      setupContinueAdapter({
        canResumeSession: vi.fn().mockResolvedValue(false),
      });

      await expect(runsService.continueRun({ runId: "r1", accountId: "default", message: "continue", })).rejects.toThrow("cannot be resumed");
    });

    it("succeeds on happy path", async () => {
      createWorkspace(db, { id: "ws1" });
      createRun(db, { id: "r1", accountId: "default", workspaceId: "ws1" });
      setupContinueAdapter();

      const result = await runsService.continueRun({
        runId: "r1",
        accountId: "default",
        message: "do more",
      });
      expect(result.runId).toBe("r1");
      expect(result.resumed).toBe(true);
      await flushBackground();
    });

    it("calls adapter.continueRun with correct args", async () => {
      createWorkspace(db, { id: "ws1" });
      createRun(db, { id: "r1", accountId: "default", workspaceId: "ws1" });
      const mockAdapter = setupContinueAdapter();

      await runsService.continueRun({
        runId: "r1",
        accountId: "default",
        message: "extend work",
      });
      expect(mockAdapter.continueRun).toHaveBeenCalled();
      const callArgs = mockAdapter.continueRun.mock.calls[0][0];
      expect(callArgs.message).toBe("extend work");
      expect(callArgs.runId).toBe("r1");
      await flushBackground();
    });

    it("continues with the latest turn model when the caller omits one", async () => {
      createWorkspace(db, { id: "ws-model" });
      createRun(db, {
        id: "run-model",
        accountId: "default",
        workspaceId: "ws-model",
        model: "gpt-5.6-sol",
      });
      createRunTurn(db, {
        runId: "run-model",
        turnIndex: 0,
        status: "completed",
        model: "gpt-5.6-sol",
      });
      createRunTurn(db, {
        runId: "run-model",
        turnIndex: 1,
        status: "completed",
        model: "gpt-5.6-terra",
      });
      const mockAdapter = setupContinueAdapter();

      await runsService.continueRun({
        runId: "run-model",
        accountId: "default",
        message: "keep going",
      });

      expect(mockAdapter.continueRun.mock.calls[0][0].model).toBe(
        "gpt-5.6-terra",
      );
      await flushBackground();
    });

    it("lets an explicit continue model override the latest turn model", async () => {
      createRun(db, {
        id: "run-explicit-model",
        accountId: "default",
        mode: "work",
        model: "gpt-5.6-sol",
      });
      createRunTurn(db, {
        runId: "run-explicit-model",
        turnIndex: 0,
        status: "completed",
        model: "gpt-5.6-terra",
      });
      const mockAdapter = setupContinueAdapter();

      await runsService.continueRun({
        runId: "run-explicit-model",
        accountId: "default",
        message: "switch again",
        model: "gpt-5.6-luna",
      });

      expect(mockAdapter.continueRun.mock.calls[0][0].model).toBe(
        "gpt-5.6-luna",
      );
      await flushBackground();
    });

    it("updates run status to running", async () => {
      createWorkspace(db, { id: "ws1" });
      createRun(db, { id: "r1", accountId: "default", workspaceId: "ws1", status: "succeeded" });
      setupContinueAdapter();

      await runsService.continueRun({
        runId: "r1",
        accountId: "default",
        message: "continue",
      });

      // The run should be running now (before background promise resolves)
      // but after background it'll be succeeded again
      await flushBackground();
    });

    it("background .then() updates to succeeded", async () => {
      createWorkspace(db, { id: "ws1" });
      createRun(db, { id: "r1", accountId: "default", workspaceId: "ws1" });
      setupContinueAdapter();

      await runsService.continueRun({
        runId: "r1",
        accountId: "default",
        message: "continue",
      });
      await flushBackground();

      const run = await runsRepo.findRunById("r1");
      expect(run!.status).toBe("succeeded");
    });

    it("background .catch() marks run as failed", async () => {
      createWorkspace(db, { id: "ws1" });
      createRun(db, { id: "r1", accountId: "default", workspaceId: "ws1" });
      setupContinueAdapter({
        continueRun: vi.fn().mockRejectedValue(new Error("continue crashed")),
      });

      await runsService.continueRun({
        runId: "r1",
        accountId: "default",
        message: "continue",
      });
      await flushBackground();

      const run = await runsRepo.findRunById("r1");
      expect(run!.status).toBe("failed");
      expect(run!.lastError).toBe("continue crashed");
    });

    it("persists additional context when provided", async () => {
      createWorkspace(db, { id: "ws1" });
      createRun(db, { id: "r1", accountId: "default", workspaceId: "ws1" });
      setupContinueAdapter();

      await runsService.continueRun({
        runId: "r1",
        accountId: "default",
        message: "continue",
        additionalContext: [
          { kind: "file", ref: "extra.ts", content: "extra content" },
        ],
      });

      const ctx = await runsRepo.findContextByRun("r1");
      expect(ctx.length).toBeGreaterThanOrEqual(1);
      await flushBackground();
    });

    it("works when no workspace attached to run", async () => {
      createRun(db, { id: "r1", accountId: "default", mode: "work" });
      setupContinueAdapter();

      await runsService.continueRun({
        runId: "r1",
        accountId: "default",
        message: "continue",
      });
      await flushBackground();
    });

    it("skips canResumeSession check when adapter lacks it", async () => {
      createWorkspace(db, { id: "ws1" });
      createRun(db, { id: "r1", accountId: "default", workspaceId: "ws1" });
      setupContinueAdapter({ canResumeSession: undefined });

      await runsService.continueRun({
        runId: "r1",
        accountId: "default",
        message: "continue",
      });
      await flushBackground();
    });

    it("returns error on outer catch", async () => {
      createRun(db, { id: "r1", accountId: "default", mode: "work" });
      setupContinueAdapter();
      // Make updateRun throw during the "set running" step
      const originalUpdateRun = runsRepo.updateRun.bind(runsRepo);
      let callCount = 0;
      vi.spyOn(runsRepo, "updateRun").mockImplementation(async (...args) => {
        callCount++;
        if (callCount === 1) {
          throw new Error("update failed");
        }
        return originalUpdateRun(...args);
      });

      await expect(runsService.continueRun({ runId: "r1", accountId: "default", message: "continue", })).rejects.toThrow("update failed");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // forkRun
  // ─────────────────────────────────────────────────────────────
  describe("forkRun", () => {
    function setupForkAdapter(overrides: Record<string, unknown> = {}) {
      const mockAdapter = {
        forkRun: vi.fn().mockResolvedValue({
          status: "succeeded",
          summary: "Forked",
          stopReason: "end_turn",
        }),
        canResumeSession: vi.fn().mockResolvedValue(true),
        generateTitle: vi.fn().mockResolvedValue("Forked Title"),
        abortRun: vi.fn(),
        deleteSession: vi.fn(),
        ...overrides,
      };
      vi.mocked(createWorkAdapter).mockReturnValue(mockAdapter as any);
      return mockAdapter;
    }

    it("returns error when source run not found", async () => {
      await expect(runsService.forkRun({ sourceRunId: "nonexistent", accountId: "default", message: "fork this", })).rejects.toThrow("Source run not found");
    });

    it("returns error when source run does not belong to account", async () => {
      createAccount(db, { id: "other" });
      createRun(db, { id: "r1", accountId: "other" });

      await expect(runsService.forkRun({ sourceRunId: "r1", accountId: "default", message: "fork", })).rejects.toThrow("Source run does not belong to this account");
    });

    it("returns error when provider not found", async () => {
      createRun(db, { id: "r1", accountId: "default" });
      vi.spyOn(
        await import("../providers/providers.repo").then(m => m.providersRepo),
        "findById"
      ).mockResolvedValueOnce(null);

      await expect(runsService.forkRun({ sourceRunId: "r1", accountId: "default", message: "fork", })).rejects.toThrow("not found");
    });

    it("returns error when provider is disabled", async () => {
      createProvider(db, { id: "disabled_p2", isEnabled: false, displayName: "Disabled" });
      createRun(db, { id: "r1", accountId: "default", providerId: "disabled_p2" });

      await expect(runsService.forkRun({ sourceRunId: "r1", accountId: "default", message: "fork", })).rejects.toThrow("not enabled");
    });

    it("returns error when adapter has no forkRun", async () => {
      createRun(db, { id: "r1", accountId: "default" });
      vi.mocked(createWorkAdapter).mockReturnValue({ canResumeSession: vi.fn() } as any);

      await expect(runsService.forkRun({ sourceRunId: "r1", accountId: "default", message: "fork", })).rejects.toThrow("Provider does not support session forking");
    });

    it("returns error when canResumeSession returns false", async () => {
      createRun(db, { id: "r1", accountId: "default" });
      setupForkAdapter({
        canResumeSession: vi.fn().mockResolvedValue(false),
      });

      await expect(runsService.forkRun({ sourceRunId: "r1", accountId: "default", message: "fork", })).rejects.toThrow("cannot be forked");
    });

    it("succeeds on happy path", async () => {
      createWorkspace(db, { id: "ws1" });
      createRun(db, { id: "r1", accountId: "default", workspaceId: "ws1" });
      setupForkAdapter();

      const result = await runsService.forkRun({
        sourceRunId: "r1",
        accountId: "default",
        message: "fork and continue",
      });
      expect(result.runId).toBeTruthy();
      expect(result.sourceRunId).toBe("r1");
      await flushBackground();
    });

    it("creates new run record", async () => {
      createWorkspace(db, { id: "ws1" });
      createRun(db, { id: "r1", accountId: "default", workspaceId: "ws1" });
      setupForkAdapter();

      const result = await runsService.forkRun({
        sourceRunId: "r1",
        accountId: "default",
        message: "fork it",
      });

      const newRun = await runsRepo.findRunById(result.runId);
      expect(newRun).toBeTruthy();
      expect(newRun!.goal).toBe("fork it");
      await flushBackground();
    });

    it("clamps an elevated chat policy before persisting and starting a fork", async () => {
      createRun(db, {
        id: "chat-source",
        accountId: "default",
        providerId: "claude_code",
        mode: "chat",
        status: "succeeded",
        toolPolicySnapshot: JSON.stringify({
          allowedTools: null,
          disallowedTools: [],
        }),
      });
      const adapter = setupForkAdapter();

      const result = await runsService.forkRun({
        sourceRunId: "chat-source",
        accountId: "default",
        message: "fork safely",
      });
      await flushBackground();

      const policy = adapter.forkRun.mock.calls[0][0].toolPolicy;
      expect(policy.allowedTools).not.toContain("Bash");
      expect(policy.disallowedTools).toContain("Bash");
      expect((await runsService.getRunById(result.runId))?.toolPolicySnapshot).toEqual(
        policy,
      );
    });

    it("calls adapter.forkRun", async () => {
      createWorkspace(db, { id: "ws1" });
      createRun(db, { id: "r1", accountId: "default", workspaceId: "ws1" });
      const mockAdapter = setupForkAdapter();

      await runsService.forkRun({
        sourceRunId: "r1",
        accountId: "default",
        message: "fork",
      });
      expect(mockAdapter.forkRun).toHaveBeenCalled();
      const callArgs = mockAdapter.forkRun.mock.calls[0][0];
      expect(callArgs.sourceRunId).toBe("r1");
      expect(callArgs.message).toBe("fork");
      await flushBackground();
    });

    it("forks from the source's latest turn model", async () => {
      createRun(db, {
        id: "source-model",
        accountId: "default",
        mode: "work",
        model: "gpt-5.6-sol",
      });
      createRunTurn(db, {
        runId: "source-model",
        turnIndex: 0,
        status: "completed",
        model: "gpt-5.6-sol",
      });
      createRunTurn(db, {
        runId: "source-model",
        turnIndex: 1,
        status: "completed",
        model: "gpt-5.6-terra",
      });
      const mockAdapter = setupForkAdapter();

      const result = await runsService.forkRun({
        sourceRunId: "source-model",
        accountId: "default",
        message: "branch here",
      });

      expect(mockAdapter.forkRun.mock.calls[0][0].model).toBe(
        "gpt-5.6-terra",
      );
      expect((await runsRepo.findRunById(result.runId))?.model).toBe(
        "gpt-5.6-terra",
      );
      await flushBackground();
    });

    it("background .then() updates forked run to succeeded", async () => {
      createWorkspace(db, { id: "ws1" });
      createRun(db, { id: "r1", accountId: "default", workspaceId: "ws1" });
      setupForkAdapter();

      const result = await runsService.forkRun({
        sourceRunId: "r1",
        accountId: "default",
        message: "fork",
      });
      await flushBackground();
      const run = await runsRepo.findRunById(result.runId);
      expect(run!.status).toBe("succeeded");
    });

    it("background .catch() marks forked run as failed", async () => {
      createWorkspace(db, { id: "ws1" });
      createRun(db, { id: "r1", accountId: "default", workspaceId: "ws1" });
      setupForkAdapter({
        forkRun: vi.fn().mockRejectedValue(new Error("fork crashed")),
      });

      const result = await runsService.forkRun({
        sourceRunId: "r1",
        accountId: "default",
        message: "fork",
      });
      await flushBackground();
      const run = await runsRepo.findRunById(result.runId);
      expect(run!.status).toBe("failed");
      expect(run!.lastError).toBe("fork crashed");
    });

    it("skips canResumeSession check when adapter lacks it", async () => {
      createWorkspace(db, { id: "ws1" });
      createRun(db, { id: "r1", accountId: "default", workspaceId: "ws1" });
      setupForkAdapter({ canResumeSession: undefined });

      await runsService.forkRun({
        sourceRunId: "r1",
        accountId: "default",
        message: "fork",
      });
      await flushBackground();
    });

    it("works when no workspace attached to source run", async () => {
      createRun(db, { id: "r1", accountId: "default", mode: "work" });
      setupForkAdapter();

      await runsService.forkRun({
        sourceRunId: "r1",
        accountId: "default",
        message: "fork",
      });
      await flushBackground();
    });

    it("returns error on outer catch", async () => {
      createRun(db, { id: "r1", accountId: "default", mode: "work" });
      setupForkAdapter();
      vi.spyOn(runsRepo, "insertRun").mockRejectedValueOnce(new Error("insert failed"));

      await expect(runsService.forkRun({ sourceRunId: "r1", accountId: "default", message: "fork", })).rejects.toThrow("insert failed");
    });

    it("fires title generation in background for forked run", async () => {
      createWorkspace(db, { id: "ws1" });
      createRun(db, { id: "r1", accountId: "default", workspaceId: "ws1" });
      const mockAdapter = setupForkAdapter();

      await runsService.forkRun({
        sourceRunId: "r1",
        accountId: "default",
        message: "forked goal",
      });
      await flushBackground();

      expect(mockAdapter.generateTitle).toHaveBeenCalledWith("forked goal", undefined);
    });

    it("background .then() sets canceled status when adapter returns canceled", async () => {
      createWorkspace(db, { id: "ws1" });
      createRun(db, { id: "r1", accountId: "default", workspaceId: "ws1" });
      setupForkAdapter({
        forkRun: vi.fn().mockResolvedValue({
          status: "canceled",
          summary: "Canceled",
        }),
      });

      const result = await runsService.forkRun({
        sourceRunId: "r1",
        accountId: "default",
        message: "fork",
      });
      await flushBackground();
      const run = await runsRepo.findRunById(result.runId);
      expect(run!.status).toBe("canceled");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // deleteRunSession
  // ─────────────────────────────────────────────────────────────
  describe("deleteRunSession", () => {
    it("returns error when run not found", async () => {
      await expect(runsService.deleteRunSession("nonexistent")).rejects.toThrow("Run not found");
    });

    it("returns success when provider not found", async () => {
      createRun(db, { id: "r1" });
      vi.spyOn(
        await import("../providers/providers.repo").then(m => m.providersRepo),
        "findById"
      ).mockResolvedValueOnce(null);

      await runsService.deleteRunSession("r1");
    });

    it("calls adapter.deleteSession when available", async () => {
      createRun(db, { id: "r1" });
      const mockAdapter = {
        deleteSession: vi.fn(),
      };
      vi.mocked(createWorkAdapter).mockReturnValue(mockAdapter as any);

      await runsService.deleteRunSession("r1");
      expect(mockAdapter.deleteSession).toHaveBeenCalledWith("r1");
    });

    it("succeeds when adapter has no deleteSession", async () => {
      createRun(db, { id: "r1" });
      vi.mocked(createWorkAdapter).mockReturnValue({} as any);

      await runsService.deleteRunSession("r1");
    });

    it("returns error on outer catch", async () => {
      vi.spyOn(runsRepo, "findRunById").mockRejectedValueOnce(new Error("db error"));
      await expect(runsService.deleteRunSession("r1")).rejects.toThrow("db error");
    });

    it("returns error when adapter.deleteSession throws", async () => {
      createRun(db, { id: "r1" });
      vi.mocked(createWorkAdapter).mockReturnValue({
        deleteSession: vi.fn().mockRejectedValue(new Error("delete failed")),
      } as any);

      await expect(runsService.deleteRunSession("r1")).rejects.toThrow("delete failed");
    });
  });
});
