import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import {
  createAccount,
  createProvider,
  createWorkspace,
  createRun,
  createRunTurn,
} from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";
import type Database from "better-sqlite3";

// Initial-turn insertion + sleep-blocker + baseRef capture are fire-and-forget
// in the session constructor. Tests await this flush before asserting initial
// state or projecting events that depend on it.
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
}));

vi.mock("../providers/adapters", () => ({
  createWorkAdapter: vi.fn(),
  couldModifyFiles: vi.fn().mockReturnValue(false),
}));

// gitService is throw-style: getHeadSha resolves a plain sha / rejects, and
// captureDiffSnapshot resolves a DiffSnapshot / rejects (all-or-throw). The
// snapshot internals are covered by the git module's own real-repo tests.
vi.mock("../git/git.service", () => ({
  gitService: {
    getHeadSha: vi.fn(),
    captureDiffSnapshot: vi.fn(),
  },
}));

vi.mock("../workspace", () => ({
  workspaceService: {
    getDiffByRun: vi.fn().mockResolvedValue(null),
  },
  recordWorkspaceDiff: vi.fn().mockResolvedValue(undefined),
  clearWorkspaceDiff: vi.fn().mockResolvedValue(false),
  logWorkspaceActivity: vi.fn(),
}));

import { createRunSession } from "./run-session";
import { runSessionRegistry } from "./run-session-registry";
import { runsRepo } from "./runs.repo";
import { createWorkAdapter, couldModifyFiles } from "../providers/adapters";
import { gitService } from "../git/git.service";
import { logWorkspaceActivity } from "../workspace";

describe("RunSession", () => {
  beforeEach(() => {
    const setup = createTestDb();
    db = setup.db;
    _sqlite = setup.sqlite;
    cleanup = setup.cleanup;

    createAccount(db, { id: "default" });
    createProvider(db, { id: "copilot_cli" });
    createWorkspace(db, { id: "w1", rootPath: "/tmp/w1" });
    createRun(db, {
      id: "r1",
      accountId: "default",
      providerId: "copilot_cli",
      workspaceId: "w1",
      status: "running",
    });

    // Default: not a git repo — captureBaseRef leaves baseRef null
    vi.mocked(gitService.getHeadSha).mockRejectedValue(
      new Error("not a git repo"),
    );
    vi.mocked(createWorkAdapter).mockReset();
    vi.mocked(couldModifyFiles).mockReturnValue(false);
  });

  afterEach(() => {
    // Drain any sessions left in the registry (idempotent finalize won't be
    // called from the test, so unregister directly).
    for (const session of [...runSessionRegistry.active()]) {
      runSessionRegistry.unregister(session.runId);
    }
    cleanup?.();
    vi.clearAllMocks();
  });

  function makeSession(
    overrides: Partial<Parameters<typeof createRunSession>[0]> = {},
  ) {
    return createRunSession({
      runId: "r1",
      accountId: "default",
      providerId: "copilot_cli",
      execution: { workspaceId: "w1", cwd: "/tmp/w1" },
      initialPromptContent: "do the thing",
      ...overrides,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Construction
  // ─────────────────────────────────────────────────────────────
  describe("construction", () => {
    it("registers itself in the registry", () => {
      const session = makeSession();
      expect(runSessionRegistry.get("r1")).toBe(session);
    });

    it("creates an initial turn at index 0 for fresh runs", async () => {
      makeSession();
      await flushBackground();
      const turns = await runsRepo.findTurnsByRun("r1");
      expect(turns).toHaveLength(1);
      expect(turns[0].turnIndex).toBe(0);
    });

    it("skips every Workspace/git side effect without a Workspace", async () => {
      const session = makeSession({
        execution: { workspaceId: null, cwd: "/tmp/work-run" },
      });
      await flushBackground();
      await session.finalize({ status: "succeeded" });

      expect(gitService.getHeadSha).not.toHaveBeenCalled();
      expect(gitService.captureDiffSnapshot).not.toHaveBeenCalled();
      expect(logWorkspaceActivity).not.toHaveBeenCalled();
    });

    it("creates a turn at seedTurnIndex + 1 for continued runs", async () => {
      createRunTurn(db, { runId: "r1", turnIndex: 0 });
      createRunTurn(db, { runId: "r1", turnIndex: 1 });
      createRunTurn(db, { runId: "r1", turnIndex: 2 });

      makeSession({ seedTurnIndex: 2, initialPromptContent: "continued message" });
      await flushBackground();

      const turns = await runsRepo.findTurnsByRun("r1");
      const indexes = turns.map((t) => t.turnIndex).sort();
      expect(indexes).toEqual([0, 1, 2, 3]);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // project — log events
  // ─────────────────────────────────────────────────────────────
  describe("project — log events", () => {
    it("inserts a log artifact", async () => {
      const session = makeSession();
      await flushBackground();

      await session.project({
        type: "log",
        message: "Starting work...",
        level: "info",
        ts: Date.now(),
      } as any);

      const artifacts = await runsRepo.findArtifactsByRun("r1");
      const log = artifacts.find((a) => a.kind === "log");
      expect(log).toBeTruthy();
      expect(log!.content).toBe("Starting work...");
    });

    it("keeps the driver's metadata so the renderer can identify the log", async () => {
      // Without this the renderer can only tell one log from another by matching
      // its wording — the shape heuristic that hid every bracketed warning.
      const session = makeSession();
      await flushBackground();

      await session.project({
        type: "log",
        message: "[api] authentication failed — sign in again",
        level: "error",
        ts: 7,
        metadata: { source: "assistant_error", error: "authentication_failed" },
      } as any);

      const artifacts = await runsRepo.findArtifactsByRun("r1");
      const log = artifacts.find((a) => a.kind === "log");
      expect(log!.metadata).toEqual({
        source: "assistant_error",
        error: "authentication_failed",
        level: "error",
        ts: 7,
      });
    });

    it("does not let driver metadata shadow level or ts", async () => {
      const session = makeSession();
      await flushBackground();

      await session.project({
        type: "log",
        message: "spoof attempt",
        level: "warn",
        ts: 7,
        metadata: { level: "info", ts: 1 },
      } as any);

      const artifacts = await runsRepo.findArtifactsByRun("r1");
      const log = artifacts.find((a) => a.kind === "log");
      expect(log!.metadata).toMatchObject({ level: "warn", ts: 7 });
    });

    it("updates run title when threadTitle is in metadata", async () => {
      const session = makeSession();
      await flushBackground();

      await session.project({
        type: "log",
        message: "thread name update",
        level: "info",
        ts: Date.now(),
        metadata: { threadTitle: "My Codex Thread" },
      } as any);

      const run = await runsRepo.findRunById("r1");
      expect(run!.title).toBe("My Codex Thread");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // project — tool_call events
  // ─────────────────────────────────────────────────────────────
  describe("project — tool_call events", () => {
    it("inserts a running tool_call on start", async () => {
      const session = makeSession();
      await flushBackground();

      await session.project({
        type: "tool_call",
        toolName: "Bash",
        input: { command: "ls" },
        metadata: { phase: "start", toolCallId: "tc-1" },
      } as any);

      const calls = await runsRepo.findToolCallsByRun("r1");
      expect(calls).toHaveLength(1);
      expect(calls[0].toolName).toBe("Bash");
      expect(calls[0].status).toBe("running");
    });

    it("updates tool_call to done on end after start", async () => {
      const session = makeSession();
      await flushBackground();

      await session.project({
        type: "tool_call",
        toolName: "Bash",
        input: { command: "ls" },
        metadata: { phase: "start", toolCallId: "tc-1" },
      } as any);

      await session.project({
        type: "tool_call",
        toolName: "Bash",
        output: { stdout: "file.ts" },
        metadata: { phase: "end", toolCallId: "tc-1" },
        startedAt: 1000,
        endedAt: 2500,
      } as any);

      const calls = await runsRepo.findToolCallsByRun("r1");
      expect(calls).toHaveLength(1);
      expect(calls[0].status).toBe("done");
      expect(calls[0].latencyMs).toBe(1500);
    });

    it("updates tool_call to error when end carries an error", async () => {
      const session = makeSession();
      await flushBackground();

      await session.project({
        type: "tool_call",
        toolName: "Read",
        metadata: { phase: "start", toolCallId: "tc-2" },
      } as any);

      await session.project({
        type: "tool_call",
        toolName: "Read",
        error: "file not found",
        metadata: { phase: "end", toolCallId: "tc-2" },
      } as any);

      const calls = await runsRepo.findToolCallsByRun("r1");
      expect(calls[0].status).toBe("error");
    });

    it("treats complete phase the same as end", async () => {
      const session = makeSession();
      await flushBackground();

      await session.project({
        type: "tool_call",
        toolName: "Edit",
        metadata: { phase: "start", toolCallId: "tc-3" },
      } as any);

      await session.project({
        type: "tool_call",
        toolName: "Edit",
        output: { ok: true },
        metadata: { phase: "complete", toolCallId: "tc-3" },
      } as any);

      const calls = await runsRepo.findToolCallsByRun("r1");
      expect(calls[0].status).toBe("done");
    });

    it("persists an explicitly canceled tool completion as canceled", async () => {
      const session = makeSession();
      await flushBackground();

      await session.project({
        type: "tool_call",
        toolName: "spawnAgent",
        metadata: { phase: "start", toolCallId: "tc-interrupted" },
      } as any);
      await session.project({
        type: "tool_call",
        toolName: "spawnAgent",
        terminalStatus: "canceled",
        metadata: { phase: "complete", toolCallId: "tc-interrupted" },
      } as any);

      const calls = await runsRepo.findToolCallsByRun("r1");
      expect(calls[0].status).toBe("canceled");
    });

    it("silently drops tool_call/end with no matching start", async () => {
      const session = makeSession();
      await flushBackground();

      await session.project({
        type: "tool_call",
        toolName: "Bash",
        metadata: { phase: "end", toolCallId: "unknown" },
      } as any);

      const calls = await runsRepo.findToolCallsByRun("r1");
      expect(calls).toHaveLength(0);
    });

    it("matches end to start by toolName fallback when toolCallId is missing", async () => {
      const session = makeSession();
      await flushBackground();

      await session.project({
        type: "tool_call",
        toolName: "Grep",
        metadata: { phase: "start" },
        startedAt: 1000,
      } as any);

      await session.project({
        type: "tool_call",
        toolName: "Grep",
        output: { lines: ["match"] },
        metadata: { phase: "end" },
        startedAt: 1000,
        endedAt: 1500,
      } as any);

      const calls = await runsRepo.findToolCallsByRun("r1");
      expect(calls).toHaveLength(1);
      expect(calls[0].status).toBe("done");
    });

    it("closes the right call by exact id when same-named tools run in parallel", async () => {
      const session = makeSession();
      await flushBackground();

      // Two Reads in flight at once (e.g. a subagent reading two files).
      await session.project({
        type: "tool_call",
        toolName: "Read",
        metadata: { phase: "start", toolCallId: "tc-a" },
      } as any);
      await session.project({
        type: "tool_call",
        toolName: "Read",
        metadata: { phase: "start", toolCallId: "tc-b" },
      } as any);

      // Complete only the second one.
      await session.project({
        type: "tool_call",
        toolName: "Read",
        metadata: { phase: "complete", toolCallId: "tc-b" },
      } as any);

      // Ordered by insertion: [0] = tc-a (still running), [1] = tc-b (done).
      const calls = await runsRepo.findToolCallsByRun("r1");
      expect(calls).toHaveLength(2);
      expect(calls[0].status).toBe("running");
      expect(calls[1].status).toBe("done");
    });

    it("ignores a duplicate completion for a resolved id (no sibling close)", async () => {
      // A subagent tool can be completed twice — once via the PostToolUse hook,
      // once via the tool_result content block. The duplicate must be a no-op,
      // never fall back to name matching and wrongly close a parallel sibling.
      const session = makeSession();
      await flushBackground();

      await session.project({
        type: "tool_call",
        toolName: "Read",
        metadata: { phase: "start", toolCallId: "tc-a" },
      } as any);
      await session.project({
        type: "tool_call",
        toolName: "Read",
        metadata: { phase: "start", toolCallId: "tc-b" },
      } as any);

      // Resolve tc-a, then a duplicate completion for tc-a.
      await session.project({
        type: "tool_call",
        toolName: "Read",
        metadata: { phase: "complete", toolCallId: "tc-a" },
      } as any);
      await session.project({
        type: "tool_call",
        toolName: "Read",
        metadata: { phase: "complete", toolCallId: "tc-a" },
      } as any);

      // tc-b must remain running — the duplicate must not have closed it.
      const calls = await runsRepo.findToolCallsByRun("r1");
      expect(calls).toHaveLength(2);
      expect(calls[0].status).toBe("done"); // tc-a
      expect(calls[1].status).toBe("running"); // tc-b untouched
    });

    it("schedules a live diff when end is for a file-modifying tool", async () => {
      vi.mocked(couldModifyFiles).mockReturnValue(true);
      vi.mocked(gitService.getHeadSha).mockResolvedValue("sha1");
      vi.mocked(gitService.captureDiffSnapshot).mockResolvedValue({
        baseRef: "sha1",
        diffText: "",
        files: [],
        untrackedFiles: [],
        shortstat: "",
      });

      const session = makeSession();
      await flushBackground();
      vi.mocked(gitService.captureDiffSnapshot).mockClear();

      await session.project({
        type: "tool_call",
        toolName: "Edit",
        metadata: { phase: "start", toolCallId: "tc-mod" },
      } as any);

      await session.project({
        type: "tool_call",
        toolName: "Edit",
        metadata: { phase: "end", toolCallId: "tc-mod" },
      } as any);

      // Live diff is debounced (300ms). Wait past the debounce.
      await new Promise((r) => setTimeout(r, 400));

      expect(vi.mocked(gitService.captureDiffSnapshot)).toHaveBeenCalled();
    });

    it("does not schedule a live diff when end has an error", async () => {
      vi.mocked(couldModifyFiles).mockReturnValue(true);
      vi.mocked(gitService.getHeadSha).mockResolvedValue("sha1");

      const session = makeSession();
      await flushBackground();
      vi.mocked(gitService.captureDiffSnapshot).mockClear();

      await session.project({
        type: "tool_call",
        toolName: "Edit",
        metadata: { phase: "start", toolCallId: "tc-err" },
      } as any);

      await session.project({
        type: "tool_call",
        toolName: "Edit",
        error: "broke",
        metadata: { phase: "end", toolCallId: "tc-err" },
      } as any);

      await new Promise((r) => setTimeout(r, 400));
      expect(vi.mocked(gitService.captureDiffSnapshot)).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // project — artifact events
  // ─────────────────────────────────────────────────────────────
  // The subagent panel's whole data model hangs on these two columns
  // round-tripping: the spawning call's provider id and the child's link to
  // it. Projected through the real repo into the real (in-memory) DB.
  describe("project — subagent parent linkage", () => {
    it("persists provider call ids and parent linkage end-to-end", async () => {
      const session = makeSession();
      await flushBackground();

      await session.project({
        type: "tool_call",
        toolName: "Agent",
        metadata: { phase: "start", toolCallId: "toolu_parent" },
      } as any);
      await session.project({
        type: "tool_call",
        toolName: "Read",
        metadata: {
          phase: "start",
          toolCallId: "toolu_child",
          parentToolUseId: "toolu_parent",
          isFromSubagent: true,
        },
      } as any);

      const calls = await runsRepo.findToolCallsByRun("r1");
      const parent = calls.find((c) => c.toolId === "toolu_parent");
      const child = calls.find((c) => c.toolId === "toolu_child");
      expect(parent).toBeDefined();
      expect(parent?.parentToolCallId).toBeNull();
      expect(child?.parentToolCallId).toBe("toolu_parent");
    });
  });

  describe("project — artifact events", () => {
    it("inserts an artifact for non-ephemeral events", async () => {
      const session = makeSession();
      await flushBackground();

      await session.project({
        type: "artifact",
        kind: "file",
        path: "/src/index.ts",
        content: "export {}",
        metadata: {},
      } as any);

      const artifacts = await runsRepo.findArtifactsByRun("r1");
      const file = artifacts.find((a) => a.kind === "file");
      expect(file).toBeTruthy();
      expect(file!.path).toBe("/src/index.ts");
    });

    it("does not insert an artifact for ephemeral events", async () => {
      const session = makeSession();
      await flushBackground();

      await session.project({
        type: "artifact",
        kind: "file",
        path: "/stream",
        content: "chunk",
        ephemeral: true,
        metadata: {},
      } as any);

      const artifacts = await runsRepo.findArtifactsByRun("r1");
      expect(artifacts.filter((a) => a.kind === "file")).toHaveLength(0);
    });

    it("starts a new turn on user-prompt artifact", async () => {
      const session = makeSession();
      await flushBackground();

      await session.project({
        type: "artifact",
        kind: "result",
        content: "follow-up question",
        metadata: { kind: "user-prompt" },
      } as any);

      const turns = await runsRepo.findTurnsByRun("r1");
      const indexes = turns.map((t) => t.turnIndex).sort();
      expect(indexes).toEqual([0, 1]);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // project — other events
  // ─────────────────────────────────────────────────────────────
  describe("project — other events", () => {
    it("inserts a prompt_suggestion artifact", async () => {
      const session = makeSession();
      await flushBackground();

      await session.project({
        type: "prompt_suggestion",
        suggestion: "Try asking about X",
        ts: Date.now(),
      } as any);

      const artifacts = await runsRepo.findArtifactsByRun("r1");
      const ps = artifacts.find((a) => a.kind === "prompt_suggestion");
      expect(ps).toBeTruthy();
      expect(ps!.content).toBe("Try asking about X");
    });

    it("persists the latest structured plan on the active turn without replacing metadata", async () => {
      const session = makeSession();
      await flushBackground();
      const [activeTurn] = await runsRepo.findTurnsByRun("r1");
      await runsRepo.updateTurn(activeTurn.id, {
        metadata: { existing: "keep" },
      });

      await session.project({
        type: "plan_update",
        providerTurnId: "turn-provider-1",
        explanation: "Implementing",
        steps: [
          { step: "Inspect", status: "completed" },
          { step: "Implement", status: "in_progress" },
        ],
        ts: 123,
      });

      const [persistedTurn] =
        await runsRepo.findTurnsByRun("r1");
      expect(persistedTurn.metadata).toEqual({
        existing: "keep",
        codexPlan: {
          providerTurnId: "turn-provider-1",
          explanation: "Implementing",
          steps: [
            { step: "Inspect", status: "completed" },
            { step: "Implement", status: "in_progress" },
          ],
          updatedAt: 123,
        },
      });
    });

    it("waits for initial turn creation when a plan update arrives immediately", async () => {
      const session = makeSession();

      await session.project({
        type: "plan_update",
        providerTurnId: "turn-provider-early",
        steps: [{ step: "Start", status: "in_progress" }],
        ts: 456,
      });

      const [persistedTurn] =
        await runsRepo.findTurnsByRun("r1");
      expect(persistedTurn.metadata?.codexPlan).toEqual({
        providerTurnId: "turn-provider-early",
        steps: [{ step: "Start", status: "in_progress" }],
        updatedAt: 456,
      });
    });

    // Subagent and background-task detail attaches to the tool call that
    // spawned it, rather than creating a second row for the same work.
    it("attaches subagent detail to the spawning tool call's metadata", async () => {
      const session = makeSession();
      await flushBackground();

      await session.project({
        type: "tool_call",
        toolName: "Agent",
        input: { subagent_type: "general-purpose" },
        metadata: { phase: "start", toolCallId: "toolu_agent" },
      } as any);

      await session.project({
        type: "subagent",
        phase: "completed",
        agentType: "general-purpose",
        agentId: "a26e6cd0",
        parentToolUseId: "toolu_agent",
        result: "Counted 42 files",
        ts: 999,
      } as any);

      const [call] = await runsRepo.findToolCallsByRun("r1");
      expect(call.metadata?.subagent).toEqual({
        phase: "completed",
        agentType: "general-purpose",
        agentId: "a26e6cd0",
        result: "Counted 42 files",
        updatedAt: 999,
      });
    });

    // The regression that motivated resolvedToolCalls: a backgrounded command
    // reports its real outcome only after the foreground call already returned
    // "running in background", so the anchor must outlive tool call completion.
    it("attaches task detail after the spawning tool call already completed", async () => {
      const session = makeSession();
      await flushBackground();

      await session.project({
        type: "tool_call",
        toolName: "Bash",
        input: { command: "sleep 45 && echo finished-ok" },
        metadata: { phase: "start", toolCallId: "toolu_bash" },
      } as any);
      await session.project({
        type: "tool_call",
        toolName: "Bash",
        output: "Command running in background with ID: bflwfagyw",
        metadata: { phase: "complete", toolCallId: "toolu_bash" },
      } as any);

      await session.project({
        type: "task",
        phase: "completed",
        taskId: "bflwfagyw",
        toolCallId: "toolu_bash",
        status: "completed",
        summary: "sleep 45 && echo finished-ok",
        outputFile: "/tmp/claude-task-bflwfagyw.log",
        ts: 1234,
      } as any);

      const [call] = await runsRepo.findToolCallsByRun("r1");
      expect(call.status).toBe("done");
      expect(call.metadata?.task).toMatchObject({
        phase: "completed",
        taskId: "bflwfagyw",
        status: "completed",
        outputFile: "/tmp/claude-task-bflwfagyw.log",
      });
    });

    it("merges successive task phases instead of overwriting", async () => {
      const session = makeSession();
      await flushBackground();

      await session.project({
        type: "tool_call",
        toolName: "Agent",
        metadata: { phase: "start", toolCallId: "toolu_agent" },
      } as any);

      await session.project({
        type: "task",
        phase: "started",
        taskId: "t1",
        toolCallId: "toolu_agent",
        status: "running",
        taskType: "local_agent",
        ts: 1,
      } as any);
      await session.project({
        type: "task",
        phase: "progress",
        taskId: "t1",
        toolCallId: "toolu_agent",
        status: "running",
        lastToolName: "Bash",
        ts: 2,
      } as any);

      const [call] = await runsRepo.findToolCallsByRun("r1");
      // taskType came from the earlier phase and must survive the later patch.
      expect(call.metadata?.task).toMatchObject({
        phase: "progress",
        taskType: "local_agent",
        lastToolName: "Bash",
        updatedAt: 2,
      });
    });

    it("ignores task events whose tool call was never projected", async () => {
      const session = makeSession();
      await flushBackground();

      await session.project({
        type: "task",
        phase: "completed",
        taskId: "orphan",
        toolCallId: "toolu_unknown",
        status: "completed",
      } as any);

      expect(await runsRepo.findToolCallsByRun("r1")).toHaveLength(0);
    });

    it("treats status event as a no-op (no DB write)", async () => {
      const session = makeSession();
      await flushBackground();
      const before = await runsRepo.findArtifactsByRun("r1");

      await session.project({
        type: "status",
        status: "running",
      } as any);

      const after = await runsRepo.findArtifactsByRun("r1");
      expect(after).toHaveLength(before.length);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // project — after finalize
  // ─────────────────────────────────────────────────────────────
  describe("project — after finalize", () => {
    it("silently drops events after finalize", async () => {
      const session = makeSession();
      await flushBackground();

      await session.finalize({ status: "succeeded" });

      await session.project({
        type: "log",
        message: "late event",
        level: "info",
        ts: Date.now(),
      } as any);

      const artifacts = await runsRepo.findArtifactsByRun("r1");
      expect(artifacts.find((a) => a.content === "late event")).toBeFalsy();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // finalize
  // ─────────────────────────────────────────────────────────────
  describe("finalize", () => {
    it("updates run status to the result status", async () => {
      const session = makeSession();
      await flushBackground();

      await session.finalize({ status: "succeeded" });

      const run = await runsRepo.findRunById("r1");
      expect(run!.status).toBe("succeeded");
      expect(run!.endedAt).toBeTruthy();
    });

    it("writes lastError on failed finalize", async () => {
      const session = makeSession();
      await flushBackground();

      await session.finalize({ status: "failed", summary: "kaboom" });

      const run = await runsRepo.findRunById("r1");
      expect(run!.status).toBe("failed");
      expect(run!.lastError).toBe("kaboom");
    });

    it("is idempotent — second call is a no-op", async () => {
      const session = makeSession();
      await flushBackground();

      await session.finalize({ status: "succeeded" });
      await session.finalize({ status: "failed", summary: "second call should not win" });

      const run = await runsRepo.findRunById("r1");
      expect(run!.status).toBe("succeeded");
    });

    it("unregisters from the registry", async () => {
      const session = makeSession();
      expect(runSessionRegistry.get("r1")).toBe(session);
      await flushBackground();

      await session.finalize({ status: "succeeded" });
      expect(runSessionRegistry.get("r1")).toBeUndefined();
    });

    it("closes orphaned tool calls as done on succeeded finalize", async () => {
      const session = makeSession();
      await flushBackground();

      await session.project({
        type: "tool_call",
        toolName: "Bash",
        metadata: { phase: "start", toolCallId: "tc-orphan" },
      } as any);
      // Never sent end event

      await session.finalize({ status: "succeeded" });

      const calls = await runsRepo.findToolCallsByRun("r1");
      expect(calls).toHaveLength(1);
      expect(calls[0].status).toBe("done");
    });

    it("closes orphaned tool calls as error on failed finalize", async () => {
      const session = makeSession();
      await flushBackground();

      await session.project({
        type: "tool_call",
        toolName: "Bash",
        metadata: { phase: "start", toolCallId: "tc-orphan" },
      } as any);

      await session.finalize({ status: "failed", summary: "boom" });

      const calls = await runsRepo.findToolCallsByRun("r1");
      expect(calls[0].status).toBe("error");
    });

    // A spawn-style call (Codex) is "done" the moment the agent starts, so an
    // aborted run would otherwise leave its subagent metadata at "invoked" —
    // showing a running agent forever in the session panel.
    it.each([
      ["succeeded", "completed"],
      ["canceled", "stopped"],
      ["failed", "stopped"],
    ] as const)(
      "settles unfinished subagents on %s finalize as %s",
      async (runStatus, expectedPhase) => {
        const session = makeSession();
        await flushBackground();

        await session.project({
          type: "tool_call",
          toolName: "spawnAgent",
          metadata: { phase: "start", toolCallId: "spawn-1" },
        } as any);
        await session.project({
          type: "tool_call",
          toolName: "spawnAgent",
          output: {},
          metadata: { phase: "complete", toolCallId: "spawn-1" },
        } as any);
        await session.project({
          type: "subagent",
          phase: "invoked",
          agentType: "security_review",
          parentToolUseId: "spawn-1",
        } as any);

        await session.finalize(
          runStatus === "failed"
            ? { status: runStatus, summary: "boom" }
            : { status: runStatus },
        );

        const calls = await runsRepo.findToolCallsByRun("r1");
        const subagent = (calls[0].metadata as Record<string, any>)?.subagent;
        expect(subagent?.phase).toBe(expectedPhase);
      },
    );

    // The resumed-agent case: after a continue, an agent's live state lives on
    // its SendMessage continuation row, which carries `metadata.task` and no
    // `metadata.subagent` at all. Settling only the latter left those rows
    // reading "running" forever — and the panel folds a continuation's state
    // onto the agent it continues, so the whole agent looked alive after the
    // run that resumed it was stopped.
    it.each([
      ["succeeded", "completed"],
      ["canceled", "stopped"],
    ] as const)(
      "settles an unfinished task lifecycle on %s finalize as %s",
      async (runStatus, expectedStatus) => {
        const session = makeSession();
        await flushBackground();

        await session.project({
          type: "tool_call",
          toolName: "SendMessage",
          input: { to: "agent-1", message: "Resume, finish the review" },
          metadata: { phase: "start", toolCallId: "send-1" },
        } as any);
        await session.project({
          type: "task",
          phase: "started",
          toolCallId: "send-1",
          taskId: "task-1",
          status: "running",
          taskType: "local_agent",
          subagentType: "security_review",
        } as any);

        await session.finalize({ status: runStatus });

        const calls = await runsRepo.findToolCallsByRun("r1");
        const task = (calls[0].metadata as Record<string, any>)?.task;
        expect(task?.status).toBe(expectedStatus);
        // The sweep patches, never replaces — identity fields survive.
        expect(task?.subagentType).toBe("security_review");
      },
    );

    it("re-arms an existing Codex spawn row from a continued session", async () => {
      const initial = makeSession();
      await flushBackground();

      await initial.project({
        type: "tool_call",
        toolName: "spawnAgent",
        metadata: { phase: "start", toolCallId: "spawn-1" },
      } as any);
      await initial.project({
        type: "tool_call",
        toolName: "spawnAgent",
        output: {},
        metadata: { phase: "complete", toolCallId: "spawn-1" },
      } as any);
      await initial.project({
        type: "subagent",
        phase: "invoked",
        agentType: "scout",
        agentId: "thread-child",
        parentToolUseId: "spawn-1",
      } as any);
      await initial.finalize({ status: "canceled" });

      const continued = makeSession();
      await flushBackground();
      await continued.project({
        type: "subagent",
        phase: "running",
        agentType: "scout",
        agentId: "thread-child",
        parentToolUseId: "spawn-1",
      } as any);

      let calls = await runsRepo.findToolCallsByRun("r1");
      expect((calls[0].metadata as Record<string, any>)?.subagent?.phase).toBe(
        "running",
      );

      await continued.project({
        type: "subagent",
        phase: "completed",
        agentType: "scout",
        agentId: "thread-child",
        parentToolUseId: "spawn-1",
        result: "Continued child result",
      } as any);
      calls = await runsRepo.findToolCallsByRun("r1");
      expect((calls[0].metadata as Record<string, any>)?.subagent).toMatchObject({
        phase: "completed",
        result: "Continued child result",
      });
    });

    it.each(["completed", "failed", "killed", "stopped"] as const)(
      "leaves a task the provider already resolved as %s alone",
      async (status) => {
        const session = makeSession();
        await flushBackground();

        await session.project({
          type: "tool_call",
          toolName: "Bash",
          metadata: { phase: "start", toolCallId: "bash-1" },
        } as any);
        await session.project({
          type: "task",
          phase: "completed",
          toolCallId: "bash-1",
          taskId: "task-1",
          status,
        } as any);

        await session.finalize({ status: "canceled" });

        const calls = await runsRepo.findToolCallsByRun("r1");
        expect((calls[0].metadata as Record<string, any>)?.task?.status).toBe(status);
      },
    );

    it("leaves a failed task's own error intact on finalize", async () => {
      const session = makeSession();
      await flushBackground();

      await session.project({
        type: "tool_call",
        toolName: "Agent",
        metadata: { phase: "start", toolCallId: "agent-1" },
      } as any);
      await session.project({
        type: "task",
        phase: "progress",
        toolCallId: "agent-1",
        taskId: "task-1",
        error: "agent exploded",
      } as any);

      await session.finalize({ status: "canceled" });

      const calls = await runsRepo.findToolCallsByRun("r1");
      const task = (calls[0].metadata as Record<string, any>)?.task;
      expect(task?.error).toBe("agent exploded");
      expect(task?.status).toBeUndefined();
    });

    it("leaves already-settled subagents alone on finalize", async () => {
      const session = makeSession();
      await flushBackground();

      await session.project({
        type: "tool_call",
        toolName: "spawnAgent",
        metadata: { phase: "start", toolCallId: "spawn-1" },
      } as any);
      await session.project({
        type: "subagent",
        phase: "failed",
        agentType: "security_review",
        parentToolUseId: "spawn-1",
        error: "agent exploded",
      } as any);

      await session.finalize({ status: "succeeded" });

      const calls = await runsRepo.findToolCallsByRun("r1");
      const subagent = (calls[0].metadata as Record<string, any>)?.subagent;
      expect(subagent?.phase).toBe("failed");
      expect(subagent?.error).toBe("agent exploded");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // abort
  // ─────────────────────────────────────────────────────────────
  describe("abort", () => {
    it("calls adapter.abortRun", async () => {
      const abortRun = vi.fn().mockResolvedValue(undefined);
      vi.mocked(createWorkAdapter).mockReturnValue({ abortRun } as any);

      const session = makeSession();
      await flushBackground();

      await session.abort();

      expect(abortRun).toHaveBeenCalledWith("r1");
    });

    it("is idempotent — second call does not re-signal the adapter", async () => {
      const abortRun = vi.fn().mockResolvedValue(undefined);
      vi.mocked(createWorkAdapter).mockReturnValue({ abortRun } as any);

      const session = makeSession();
      await flushBackground();

      await session.abort();
      await session.abort();

      expect(abortRun).toHaveBeenCalledTimes(1);
    });

    it("does not throw when adapter.abortRun rejects", async () => {
      const abortRun = vi.fn().mockRejectedValue(new Error("adapter explosion"));
      vi.mocked(createWorkAdapter).mockReturnValue({ abortRun } as any);

      const session = makeSession();
      await flushBackground();

      await expect(session.abort()).resolves.not.toThrow();
    });

    it("does not signal after finalize", async () => {
      const abortRun = vi.fn().mockResolvedValue(undefined);
      vi.mocked(createWorkAdapter).mockReturnValue({ abortRun } as any);

      const session = makeSession();
      await flushBackground();

      await session.finalize({ status: "succeeded" });
      await session.abort();

      expect(abortRun).not.toHaveBeenCalled();
    });

    it("succeeds when adapter has no abortRun method", async () => {
      vi.mocked(createWorkAdapter).mockReturnValue({} as any);

      const session = makeSession();
      await flushBackground();

      await expect(session.abort()).resolves.not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // updateBaseRef
  // ─────────────────────────────────────────────────────────────
  describe("updateBaseRef", () => {
    const trackingSnapshot = () => {
      vi.mocked(gitService.captureDiffSnapshot).mockImplementation(
        async (_rootPath, baseRef) => ({
          baseRef,
          diffText: "diff",
          files: ["file.ts"],
          untrackedFiles: [],
          shortstat: "1 file changed",
        }),
      );
    };
    const lastSnapshotRef = () => {
      const calls = vi.mocked(gitService.captureDiffSnapshot).mock.calls;
      return calls[calls.length - 1][1];
    };

    it("anchors snapshots to HEAD, not the run-start sha", async () => {
      // The stored diff means "not committed yet". A commit mid-run therefore
      // has to leave it — whether it came from the commit tool, a Bash
      // `git commit`, or a terminal outside the app. Only the first would call
      // updateBaseRef; all three move HEAD, so HEAD is what we follow.
      vi.mocked(gitService.getHeadSha).mockResolvedValue("original-sha");
      trackingSnapshot();

      const session = makeSession();
      await flushBackground(); // initial baseRef captured

      vi.mocked(gitService.getHeadSha).mockResolvedValue("post-commit-sha");

      await session.finalize({ status: "succeeded" });

      expect(lastSnapshotRef()).toBe("post-commit-sha");
    });

    it("falls back to the session baseRef when HEAD is unreadable", async () => {
      // A git hiccup degrades to the old behaviour instead of dropping the diff.
      vi.mocked(gitService.getHeadSha).mockResolvedValue("original-sha");
      trackingSnapshot();

      const session = makeSession();
      await flushBackground();

      session.updateBaseRef("new-sha");
      vi.mocked(gitService.getHeadSha).mockRejectedValue(new Error("git gone"));

      await session.finalize({ status: "succeeded" });

      expect(lastSnapshotRef()).toBe("new-sha");
    });

    it("is a no-op after finalize", async () => {
      const session = makeSession();
      await flushBackground();

      await session.finalize({ status: "succeeded" });

      expect(() => session.updateBaseRef("new-sha")).not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // persistFinalDiff — incremental "files changed" activity
  // ─────────────────────────────────────────────────────────────
  describe("persistFinalDiff — incremental activity", () => {
    // Synthetic per-file diff chunk, terminated with a newline like real git
    // output so its hash is stable regardless of whether other files follow.
    const fileDiff = (name: string, body: string) =>
      `diff --git a/${name} b/${name}\nindex 000..111 100644\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n${body}\n`;

    const diffActivities = () =>
      vi
        .mocked(logWorkspaceActivity)
        .mock.calls.filter(([p]) => p.type === "diff")
        .map(([p]) => p);

    const snap = (diffText: string, files: string[]) => ({
      baseRef: "sha1",
      diffText,
      files,
      untrackedFiles: [] as string[],
      shortstat: `${files.length} file${files.length === 1 ? "" : "s"} changed`,
    });

    it("does not re-log pre-existing changes when the run touches nothing", async () => {
      // a.ts is already dirty at run start; the run changes nothing.
      vi.mocked(gitService.getHeadSha).mockResolvedValue("sha1");
      vi.mocked(gitService.captureDiffSnapshot).mockResolvedValue(
        snap(fileDiff("a.ts", "+x"), ["a.ts"]),
      );

      const session = makeSession();
      await flushBackground(); // captureBaseRef snapshots the pre-existing diff

      await session.finalize({ status: "succeeded" });

      expect(diffActivities()).toHaveLength(0);
    });

    it("logs only the files changed since run start", async () => {
      // Run start: a.ts dirty. Run end: a.ts unchanged, b.ts newly changed.
      vi.mocked(gitService.getHeadSha).mockResolvedValue("sha1");
      vi.mocked(gitService.captureDiffSnapshot)
        .mockResolvedValueOnce(snap(fileDiff("a.ts", "+x"), ["a.ts"]))
        .mockResolvedValue(
          snap(`${fileDiff("a.ts", "+x")}${fileDiff("b.ts", "+y")}`, [
            "a.ts",
            "b.ts",
          ]),
        );

      const session = makeSession();
      await flushBackground();

      await session.finalize({ status: "succeeded" });

      const activities = diffActivities();
      expect(activities).toHaveLength(1);
      expect(activities[0].title).toBe("1 file changed");
      expect((activities[0].metadata as any).fileNames).toEqual(["b.ts"]);
    });

    it("skips the activity log when the run-start baseline could not be captured", async () => {
      // getHeadSha succeeds (baseRef is set) but the run-start snapshot fails
      // (all-or-throw), so initialDiffHashes stays null — "baseline unknown",
      // not "clean tree". We must NOT attribute the now-dirty a.ts to this run;
      // an empty-Map fallback would have logged it as a spurious "1 file
      // changed".
      vi.mocked(gitService.getHeadSha).mockResolvedValue("sha1");
      vi.mocked(gitService.captureDiffSnapshot)
        .mockRejectedValueOnce(new Error("git boom")) // run-start snapshot fails → null baseline
        .mockResolvedValue(snap(fileDiff("a.ts", "+x"), ["a.ts"])); // finalize snapshot

      const session = makeSession();
      await flushBackground();

      await session.finalize({ status: "succeeded" });

      expect(diffActivities()).toHaveLength(0);
    });
  });
});
