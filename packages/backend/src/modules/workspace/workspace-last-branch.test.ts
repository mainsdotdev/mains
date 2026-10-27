import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb } from "../../../test/setup-db";
import { createAccount, createWorkspace } from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";

let db: DatabaseInstance;
let cleanup: () => void;

vi.mock("../../db/client", () => ({ getDb: () => db }));

import { workspaceRepo } from "./workspace.repo";
import { workspaceService } from "./workspace.service";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });

describe("last known workspace branch for other Bridge devices", () => {
  let repo: string;
  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    createAccount(db, { id: "default" });
    repo = mkdtempSync(join(tmpdir(), "mains-last-branch-"));
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.email", "test@example.com"); git(repo, "config", "user.name", "Test");
    writeFileSync(join(repo, "README.md"), "hello\n");
    git(repo, "add", "."); git(repo, "commit", "-q", "-m", "init");
  });
  afterEach(() => {
    workspaceService.stopGitStateWatchers();
    cleanup(); rmSync(repo, { recursive: true, force: true });
  });

  it("records the checked-out branch on owned workspaces, including switches made while closed", async () => {
    createWorkspace(db, { id: "owned", rootPath: repo, metadata: JSON.stringify({ isGitRepo: true, tracking: "origin/main" }) });
    const before = (await workspaceRepo.findById("owned"))!.updatedAt;

    expect(await workspaceService.listGitStates()).toEqual([{ workspaceId: "owned", pathExists: true, branch: "main" }]);
    await vi.waitFor(async () => expect((await workspaceRepo.findById("owned"))?.metadata?.lastBranch).toBe("main"));
    // Existing metadata is preserved and the hint does not reorder recent workspaces.
    const saved = (await workspaceRepo.findById("owned"))!;
    expect(saved.metadata).toMatchObject({ isGitRepo: true, tracking: "origin/main", lastBranch: "main" });
    expect(saved.updatedAt).toEqual(before);

    git(repo, "checkout", "-q", "-b", "feature/x");
    await workspaceService.listGitStates();
    await vi.waitFor(async () => expect((await workspaceRepo.findById("owned"))?.metadata?.lastBranch).toBe("feature/x"));
    expect(await workspaceRepo.recordLastBranch("owned", "feature/x")).toBe(false);
  });

  it("never writes another device's workspace", async () => {
    createWorkspace(db, { id: "replica", rootPath: repo, ownerBackendId: "other-device", metadata: JSON.stringify({ lastBranch: "main" }) });
    expect(await workspaceRepo.recordLastBranch("replica", "feature/x")).toBe(false);
    expect((await workspaceRepo.findById("replica"))?.metadata).toEqual({ lastBranch: "main" });
  });
});
