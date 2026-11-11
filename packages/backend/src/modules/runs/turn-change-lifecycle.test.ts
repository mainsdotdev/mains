import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createTestDb } from "../../../test/setup-db";
import { createWorkspace, createRun, createRunTurn } from "../../../test/factories";
import { installTestBackendRuntime } from "../../../test/backend-runtime";
import type { DatabaseInstance } from "../../db/types";
let db: DatabaseInstance, cleanup: () => void, restore: () => void, root: string;
vi.mock("../../db/client", () => ({ getDb: () => db }));
import { runsService } from "./runs.service";
import { claimRunResponse } from "./run-lifecycle";
import { runsRepo } from "./runs.repo";
import { fileExplorerService } from "../fileExplorer";
import { runSessionRegistry } from "./run-session-registry";
import type { RunSession } from "./run-session";
import { gitService } from "../git";
import { openGitFlow, shutdownGitFlow } from "../gitFlow/gitFlow.lifecycle";

const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
let turnId: number;
beforeEach(async () => {
  ({ db, cleanup } = createTestDb());
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mains-turn-change-"));
  restore = installTestBackendRuntime({ getPath: (name) => path.join(root, name) });
  git("init", "-b", "main"); git("config", "user.name", "Turn Test"); git("config", "user.email", "turn@example.test");
  fs.writeFileSync(path.join(root, "file.txt"), "before\n"); git("add", "."); git("commit", "-m", "Initial");
  fs.writeFileSync(path.join(root, "file.txt"), "after\n");
  createWorkspace(db, { id: "workspace", rootPath: root });
  createRun(db, { id: "run", workspaceId: "workspace", status: "succeeded" });
  turnId = createRunTurn(db, { runId: "run", status: "completed" }).id;
  const snapshot = await gitService.captureDiffSnapshot(root, git("rev-parse", "HEAD"));
  await runsRepo.insertTurnChanges({ runId: "run", turnId, diffText: snapshot.diffText,
    files: snapshot.files.map((file) => ({ path: file, status: "modified" as const, additions: 1, deletions: 1, binary: false, shared: false })), additions: 1, deletions: 1, truncated: false });
});
afterEach(async () => { for (const session of [...runSessionRegistry.active()]) runSessionRegistry.unregister(session.runId); await shutdownGitFlow(); openGitFlow(); vi.restoreAllMocks(); restore(); cleanup(); fs.rmSync(root, { recursive: true, force: true }); });

describe("turn Undo ownership", () => {
  it("refuses legacy changes without verified ownership before touching Git", async () => {
    const stored = (await runsService.getTurnChangesDiff("run", turnId))!;
    const legacyTurnId = createRunTurn(db, { runId: "run", status: "completed", turnIndex: 1 }).id;
    await runsRepo.insertTurnChanges({ runId: "run", turnId: legacyTurnId, diffText: stored.diffText,
      files: stored.files.map((file) => ({ ...file, shared: undefined })), additions: stored.additions,
      deletions: stored.deletions, truncated: false });
    const apply = vi.spyOn(gitService, "applyPatch");
    await expect(runsService.undoTurnChanges("run", legacyTurnId)).rejects.toThrow(/cannot be safely attributed/);
    expect(apply).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(root, "file.txt"), "utf8")).toBe("after\n");
    expect((await runsService.getTurnChangesDiff("run", legacyTurnId))?.undoneAt).toBeNull();
  });

  it("joins duplicate Undo requests before a second reverse patch can start", async () => {
    const gate = deferred(), entered = deferred(), apply = gitService.applyPatch.bind(gitService);
    const native = vi.spyOn(gitService, "applyPatch").mockImplementation(async (...args) => { entered.resolve(); await gate.promise; return apply(...args); });
    const first = runsService.undoTurnChanges("run", turnId); await entered.promise;
    const second = runsService.undoTurnChanges("run", turnId);
    let results!: PromiseSettledResult<unknown>[];
    try { await new Promise<void>((resolve) => setTimeout(resolve, 30)); expect(native).toHaveBeenCalledTimes(1); }
    finally { gate.resolve(); results = await Promise.allSettled([first, second]); }
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(fs.readFileSync(path.join(root, "file.txt"), "utf8")).toBe("before\n");
    expect((await runsService.getTurnChangesDiff("run", turnId))?.undoneAt).not.toBeNull();
  });
  it("retries only the completion marker after native Undo succeeded, preserving later user edits", async () => {
    const native = vi.spyOn(gitService, "applyPatch");
    vi.spyOn(runsRepo, "markTurnChangesUndone").mockRejectedValueOnce(new Error("Metadata unavailable"));
    await expect(runsService.undoTurnChanges("run", turnId)).rejects.toThrow("Metadata unavailable");
    expect(fs.readFileSync(path.join(root, "file.txt"), "utf8")).toBe("before\n");
    fs.writeFileSync(path.join(root, "file.txt"), "Later user edits\n");
    await expect(runsService.undoTurnChanges("run", turnId)).resolves.toMatchObject({ undoneAt: expect.any(Date) });
    expect(native).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(path.join(root, "file.txt"), "utf8")).toBe("Later user edits\n");
  });

  it("holds workspace and run ownership against editor saves and Continue until native Undo finishes", async () => {
    const gate = deferred(), entered = deferred(), apply = gitService.applyPatch.bind(gitService);
    vi.spyOn(gitService, "applyPatch").mockImplementationOnce(async (...args) => { entered.resolve(); await gate.promise; return apply(...args); });
    const undo = runsService.undoTurnChanges("run", turnId); await entered.promise;
    try {
      await expect(fileExplorerService.writeFileText({ workspaceId: "workspace", filePath: path.join(root, "file.txt"), content: "racing editor" })).rejects.toThrow(/progress|archived|response/i);
      await expect(runsService.continueRun({ runId: "run", accountId: "default", message: "Continue" })).rejects.toThrow();
      expect(fs.readFileSync(path.join(root, "file.txt"), "utf8")).toBe("after\n");
    } finally { gate.resolve(); await undo; }
  });

  it.each([false, true])("refuses Undo while another run owns the same checkout (alias: %s)", async (alias) => {
    if (alias) { const location = path.join(root, "alias"); fs.symlinkSync(root, location, "dir"); createWorkspace(db, { id: "alias-workspace", rootPath: location }); }
    createRun(db, { id: "peer", workspaceId: alias ? "alias-workspace" : "workspace", status: "running" });
    runSessionRegistry.register("peer", { runId: "peer", phase: "active" } as RunSession);
    const apply = vi.spyOn(gitService, "applyPatch");
    await expect(runsService.undoTurnChanges("run", turnId)).rejects.toThrow("workspace runs");
    expect(apply).not.toHaveBeenCalled();
    expect((await runsService.getTurnChangesDiff("run", turnId))?.undoneAt).toBeNull();
  });

  it("refuses Undo while a peer response is preparing before session registration", async () => {
    createRun(db, { id: "preparing-peer", workspaceId: "workspace", status: "running" });
    const release = claimRunResponse("preparing-peer"), native = vi.spyOn(gitService, "applyPatch");
    try { await expect(runsService.undoTurnChanges("run", turnId)).rejects.toThrow("workspace runs"); expect(native).not.toHaveBeenCalled(); }
    finally { release(); }
  });

});
