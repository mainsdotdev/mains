import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createTestDb } from "../../../test/setup-db";
import { createWorkspace } from "../../../test/factories";
import { installTestBackendRuntime } from "../../../test/backend-runtime";
import type { DatabaseInstance } from "../../db/types";
let db: DatabaseInstance, cleanup: () => void, restore: () => void, root: string;
vi.mock("../../db/client", () => ({ getDb: () => db }));
import { captureWorkspaceDiff, openWorkspaceDiffs, shutdownWorkspaceDiffs } from "./workspace-diff-lifecycle";
import { workspaceService } from "./workspace.service";
import { gitFlowService } from "../gitFlow";
import { openGitFlow, shutdownGitFlow } from "../gitFlow/gitFlow.lifecycle";
import { gitService } from "../git";
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  ({ db, cleanup } = createTestDb()); root = fs.mkdtempSync(path.join(os.tmpdir(), "mains-workspace-diff-"));
  restore = installTestBackendRuntime({ getPath: (name) => path.join(root, name) });
  git("init", "-b", "main"); git("config", "user.name", "Diff Test"); git("config", "user.email", "diff@example.test");
  fs.writeFileSync(path.join(root, "file.txt"), "initial\n"); git("add", "."); git("commit", "-m", "Initial");
  fs.writeFileSync(path.join(root, "file.txt"), "first\n"); createWorkspace(db, { id: "workspace", rootPath: root });
});
afterEach(async () => { await shutdownWorkspaceDiffs(); await shutdownGitFlow(); openWorkspaceDiffs(); openGitFlow(); vi.restoreAllMocks(); restore(); cleanup(); fs.rmSync(root, { recursive: true, force: true }); });

describe("workspace diff capture ownership", () => {
  it("coalesces another refresh into a follow-up capture and never leaves the older snapshot current", async () => {
    const head = git("rev-parse", "HEAD"), capture = gitService.captureDiffSnapshot.bind(gitService);
    const older = await capture(root, head);
    fs.writeFileSync(path.join(root, "file.txt"), "newest\n"); const newer = await capture(root, head);
    vi.spyOn(gitService, "getHeadSha").mockResolvedValue(head);
    const gate = deferred(), entered = deferred();
    const native = vi.spyOn(gitService, "captureDiffSnapshot").mockImplementationOnce(async () => { entered.resolve(); await gate.promise; return older; }).mockResolvedValue(newer);
    const first = workspaceService.resyncDiff("workspace"); await entered.promise;
    const second = workspaceService.resyncDiff("workspace");
    try { await new Promise<void>((resolve) => setImmediate(resolve)); }
    finally { gate.resolve(); await Promise.all([first, second]); }
    expect(native).toHaveBeenCalledTimes(2);
    expect((await workspaceService.getLatestDiff("workspace"))?.diffText).toContain("+newest");
  });
  it("preserves the last valid diff when reading HEAD fails", async () => {
    await workspaceService.resyncDiff("workspace");
    const before = await workspaceService.getLatestDiff("workspace");
    vi.spyOn(gitService, "getHeadSha").mockRejectedValue(new Error("Repository temporarily unavailable"));
    await expect(workspaceService.resyncDiff("workspace")).rejects.toThrow("Repository temporarily unavailable");
    expect((await workspaceService.getLatestDiff("workspace"))?.diffText).toBe(before?.diffText);
  });

  it("waits for an admitted capture and fences new refreshes during backend shutdown", async () => {
    const capture = gitService.captureDiffSnapshot.bind(gitService), gate = deferred(), entered = deferred();
    vi.spyOn(gitService, "captureDiffSnapshot").mockImplementationOnce(async (...args) => { entered.resolve(); await gate.promise; return capture(...args); });
    const pending = workspaceService.resyncDiff("workspace"); await entered.promise;
    let closed = false; const closing = shutdownWorkspaceDiffs().then(() => { closed = true; });
    try { await expect(workspaceService.resyncDiff("workspace")).rejects.toThrow("shutting down"); expect(closed).toBe(false); }
    finally { gate.resolve(); await pending; await closing; }
    openWorkspaceDiffs(); await expect(workspaceService.resyncDiff("workspace")).resolves.not.toBeNull();
  });

  it("recaptures after an external commit moves HEAD while the previous diff is being read", async () => {
    const capture = gitService.captureDiffSnapshot.bind(gitService), gate = deferred(), entered = deferred();
    const native = vi.spyOn(gitService, "captureDiffSnapshot").mockImplementationOnce(async (...args) => { const snapshot = await capture(...args); entered.resolve(); await gate.promise; return snapshot; });
    const pending = workspaceService.resyncDiff("workspace"); await entered.promise;
    try { git("add", "."); git("commit", "-m", "External commit"); }
    finally { gate.resolve(); await pending; }
    expect(await workspaceService.getLatestDiff("workspace")).toBeNull();
    expect(native).toHaveBeenCalledTimes(2);
  });

  it("does not lose a refresh arriving exactly as the previous worker finishes", async () => {
    const calls: string[] = []; let follow: Promise<void> | undefined;
    await captureWorkspaceDiff("handoff", async () => {
      calls.push("first");
      queueMicrotask(() => queueMicrotask(() => { follow = captureWorkspaceDiff("handoff", async () => { calls.push("newest"); }); }));
    });
    await follow;
    expect(calls).toEqual(["first", "newest"]);
  });

  it("does not publish a pre-mutation capture after a native commit whose own refresh failed", async () => {
    await workspaceService.resyncDiff("workspace"); const before = await workspaceService.getLatestDiff("workspace");
    fs.writeFileSync(path.join(root, "file.txt"), "captured before commit\n");
    const capture = gitService.captureDiffSnapshot.bind(gitService), gate = deferred(), entered = deferred();
    vi.spyOn(gitService, "captureDiffSnapshot").mockImplementationOnce(async (...args) => { const snapshot = await capture(...args); entered.resolve(); await gate.promise; return snapshot; });
    const pending = workspaceService.resyncDiff("workspace"); await entered.promise;
    vi.spyOn(workspaceService, "resyncDiff").mockRejectedValueOnce(new Error("Projection offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    try { await gitFlowService.commit({ workspaceId: "workspace", message: "Commit captured work" }); }
    finally { gate.resolve(); await pending; }
    expect((await workspaceService.getLatestDiff("workspace"))?.diffText).toBe(before?.diffText);
    expect(git("diff")).toBe("");
  });

});
