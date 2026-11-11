import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTestDb } from "../../../test/setup-db";
import { createAccount } from "../../../test/factories";
import { installTestBackendRuntime } from "../../../test/backend-runtime";
import type { DatabaseInstance } from "../../db/types";
let db: DatabaseInstance, closeDb: () => void, restore: () => void, root: string, repo: string;
vi.mock("../../db/client", () => ({ getDb: () => db }));
import { workspaceService } from "./workspace.service";
import { projectsService } from "../projects/projects.service";
import { appSettingsService } from "../appSettings/appSettings.service";
import { gitService } from "../git";
vi.setConfig({ testTimeout: 30_000 }); // Each case uses real Git and temporary SQLite.

beforeEach(async () => {
  ({ db, cleanup: closeDb } = createTestDb());
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mains-workspace-intake-"));
  restore = installTestBackendRuntime({ getPath: (name) => path.join(root, name), getAppPath: () => root });
  createAccount(db, { id: "account" }); createAccount(db, { id: "other" });
  await appSettingsService.updateSettings({ enableWorktrees: false });
  repo = path.join(root, "source"); await fs.mkdir(repo);
  execFileSync("git", ["init", "-b", "main"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Intake Test"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "intake@example.test"], { cwd: repo });
  await fs.writeFile(path.join(repo, "README.md"), "keep me\n");
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-m", "Initial"], { cwd: repo, stdio: "ignore" });
});
afterEach(async () => { vi.restoreAllMocks(); workspaceService.stopGitStateWatchers(); restore(); closeDb(); await fs.rm(root, { recursive: true, force: true }); });

describe("workspace intake registration", () => {
  it("shares project creation when different checkouts of the same origin arrive concurrently", async () => {
    const second = path.join(root, "second"); await fs.cp(repo, second, { recursive: true });
    vi.spyOn(gitService, "isGitRepo").mockResolvedValue(true);
    vi.spyOn(gitService, "importLocalRepoDirect").mockImplementation(async (sourcePath) => ({ sourcePath, branchName: "main", baseBranch: "main", tracking: null, ahead: 0, behind: 0, originUrl: "https://example.test/shared.git" }));
    const [first, other] = await Promise.all([repo, second].map((location) => workspaceService.createFromSource({ accountId: "account", source: { kind: "folder", path: location } })));
    expect(first.projectId).toBe(other.projectId);
    expect(await projectsService.listByAccount("account")).toHaveLength(1);
    expect(await workspaceService.listByAccount("account")).toHaveLength(2);
  });

  it.each(["folder", "clone", "init", "worktree"] as const)("registers %s through the shared intake owner", async (kind) => {
    let projectId = "";
    if (kind === "worktree") projectId = (await workspaceService.createFromSource({ accountId: "account", source: { kind: "folder", path: repo } })).projectId;
    if (kind === "clone") vi.spyOn(gitService, "cloneRepo").mockResolvedValue({ clonedPath: repo, defaultBranch: "main", originUrl: "https://example.test/source.git" });
    const source = kind === "folder" ? { kind, path: repo }
      : kind === "clone" ? { kind, cloneId: "successful-clone", url: "https://example.test/source.git", targetPath: root }
        : kind === "init" ? { kind, name: "fresh", parentPath: root } : { kind, projectId };
    const workspace = await workspaceService.createFromSource({ accountId: "account", source });
    expect(workspace.accountId).toBe("account");
    expect(workspace.baseBranch).toBe("main");
    expect((await projectsService.listByAccount("account"))).toHaveLength(1);
    expect((await workspaceService.listByAccount("account"))).toHaveLength(kind === "worktree" ? 2 : 1);
    expect(await gitService.isGitRepo(workspace.rootPath)).toBe(true);
    expect(workspace.metadata?.worktree?.enabled).toBe(kind === "worktree");
  });

  it("holds a picked folder through database registration instead of creating duplicate records", async () => {
    let entered!: () => void, release!: () => void;
    const registering = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const create = workspaceService.create.bind(workspaceService);
    vi.spyOn(workspaceService, "create").mockImplementationOnce(async (input) => { entered(); await gate; return create(input); });
    const payload = { accountId: "account", source: { kind: "folder" as const, path: repo } };
    const pending = workspaceService.createFromSource(payload);
    await registering;
    try { await expect(workspaceService.createFromSource(payload)).rejects.toThrow("already in progress"); }
    finally { release(); await pending; }
    expect(await workspaceService.listByAccount("account")).toHaveLength(1);
    expect(await projectsService.listByAccount("account")).toHaveLength(1);
  });

  it("preserves a successful clone after registration failure and retries only registration", async () => {
    const acquire = vi.spyOn(gitService, "cloneRepo").mockResolvedValue({ clonedPath: repo, defaultBranch: "main", originUrl: "https://example.test/source.git" });
    vi.spyOn(workspaceService, "create").mockRejectedValueOnce(new Error("Database unavailable"));
    const source = { kind: "clone" as const, cloneId: "service-registration-retry", attemptId: "first", url: "https://example.test/source.git", targetPath: root };
    await expect(workspaceService.createFromSource({ accountId: "account", source })).rejects.toThrow("Database unavailable");
    expect(await workspaceService.listByAccount("account")).toEqual([]);
    await fs.writeFile(path.join(repo, "user.txt"), "User data after clone");
    const workspace = await workspaceService.createFromSource({ accountId: "account", source: { ...source, attemptId: "retry" } });
    expect(workspace.rootPath).toBe(repo);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(await workspaceService.listByAccount("account")).toHaveLength(1);
    expect(await projectsService.listByAccount("account")).toHaveLength(1);
    expect(await fs.readFile(path.join(repo, "user.txt"), "utf8")).toBe("User data after clone");
  });

  it("recovers its own committed workspace if failure arrives after the row was inserted", async () => {
    const acquire = vi.spyOn(gitService, "cloneRepo").mockResolvedValue({ clonedPath: repo, defaultBranch: "main", originUrl: "https://example.test/source.git" });
    const create = workspaceService.create.bind(workspaceService);
    const registration = vi.spyOn(workspaceService, "create").mockImplementationOnce(async (input) => {
      await create(input); throw new Error("Reply failed after insert");
    });
    const source = { kind: "clone" as const, cloneId: "committed-registration", url: "https://example.test/source.git", targetPath: root };
    await expect(workspaceService.createFromSource({ accountId: "account", source })).rejects.toThrow("Reply failed after insert");
    const existing = await workspaceService.listByAccount("account"); expect(existing).toHaveLength(1);
    const retried = await workspaceService.createFromSource({ accountId: "account", source });
    expect(retried.id).toBe(existing[0].id);
    expect(acquire).toHaveBeenCalledTimes(1); expect(registration).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("reuses the prepared worktree after registration failure (committed: %s)", async (committed) => {
    await appSettingsService.updateSettings({ enableWorktrees: true });
    const acquire = vi.spyOn(gitService, "cloneRepo").mockResolvedValue({ clonedPath: repo, defaultBranch: "main", originUrl: "https://example.test/source.git" });
    const prepare = vi.spyOn(gitService, "importLocalRepo");
    const create = workspaceService.create.bind(workspaceService);
    vi.spyOn(workspaceService, "create").mockImplementationOnce(async (input) => {
      if (committed) await create(input);
      throw new Error("Registration failed");
    });
    const source = { kind: "clone" as const, cloneId: `worktree-retry-${committed}`, url: "https://example.test/source.git", targetPath: root };
    await expect(workspaceService.createFromSource({ accountId: "account", source })).rejects.toThrow("Registration failed");
    const worktreePath = (await prepare.mock.results[0].value).worktreePath;
    await fs.writeFile(path.join(worktreePath, "user.txt"), "Worktree edits");
    const originalPath = `${worktreePath}.original`;
    await fs.rename(worktreePath, originalPath); await fs.mkdir(worktreePath);
    await fs.writeFile(path.join(worktreePath, "replacement.txt"), "Replacement edits");
    await expect(workspaceService.createFromSource({ accountId: "account", source })).rejects.toThrow("Prepared workspace directory changed");
    expect(await fs.readFile(path.join(worktreePath, "replacement.txt"), "utf8")).toBe("Replacement edits");
    await fs.rm(worktreePath, { recursive: true }); await fs.rename(originalPath, worktreePath);
    const retried = await workspaceService.createFromSource({ accountId: "account", source });
    expect(retried.rootPath).toBe(worktreePath);
    expect(acquire).toHaveBeenCalledTimes(1); expect(prepare).toHaveBeenCalledTimes(1);
    expect(await workspaceService.listByAccount("account")).toHaveLength(1);
    expect(await fs.readFile(path.join(worktreePath, "user.txt"), "utf8")).toBe("Worktree edits");
  });

  it("rejects a non-repository folder without project records or user file changes", async () => {
    const folder = path.join(root, "not-git"); await fs.mkdir(folder); await fs.writeFile(path.join(folder, "keep.txt"), "User file");
    await expect(workspaceService.createFromSource({ accountId: "account", source: { kind: "folder", path: folder } })).rejects.toThrow("Not a git repository");
    expect(await projectsService.listByAccount("account")).toEqual([]);
    expect(await workspaceService.listByAccount("account")).toEqual([]);
    expect(await fs.readFile(path.join(folder, "keep.txt"), "utf8")).toBe("User file");
  });

  it("keeps committed workspace registration successful when initial diff capture fails", async () => {
    vi.spyOn(gitService, "getHeadSha").mockRejectedValueOnce(new Error("Diff unavailable"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const workspace = await workspaceService.createFromSource({ accountId: "account", source: { kind: "folder", path: repo } });
    expect((await workspaceService.listByAccount("account")).map((row) => row.id)).toEqual([workspace.id]);
  });

  it("rejects another account's worktree before filesystem or project mutation", async () => {
    const workspace = await workspaceService.createFromSource({ accountId: "account", source: { kind: "folder", path: repo } });
    const acquire = vi.spyOn(gitService, "importLocalRepo");
    await expect(workspaceService.createFromSource({ accountId: "other", source: { kind: "worktree", projectId: workspace.projectId } }))
      .rejects.toThrow("Project does not belong to this account");
    expect(acquire).not.toHaveBeenCalled();
    expect(await projectsService.listByAccount("other")).toEqual([]);
    expect(await workspaceService.listByAccount("other")).toEqual([]);
  });
});
